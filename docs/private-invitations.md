# Private invitations (#257)

Private invitations are separate from public publication and from accepted account
access. This change is additive to #256: existing `listGrants` APIs, public URLs,
legacy `/join` behavior and referral `/invite/:code` links retain their contracts.
No invitation creates a grant until the recipient explicitly accepts. Lists and
notes use the same invitation operations; note/editor/sync code is unchanged.

## User flow

The authenticated layout links to `/invitations`. Recipients see pending invitations
for their verified sign-in email. Owners choose a list or note they own, send an
invitation, inspect delivery status, change pending roles, resend/revoke, and manage
accepted account roles/revocation. Viewer is the default; editor is explicit.

Email links use `/invitations/:invitationId/:version`. Signed-out visitors sign in
on that same route using the existing embedded OTP login, then review and click
**Accept invitation**. Neither loading the route nor signing in accepts anything.
Invalid, mismatched, expired, superseded and already-accepted links show an
unavailable message; the pending inbox remains accessible. Acceptance opens the
resource through `/list/:id` (the existing ListView redirects notes to `/n/:id`).
ListView uses the server's accepted role for content and owner capabilities. Viewers
and public readers cannot edit rows, comments, details, categories or use modifying
keyboard/batch/drag controls. Editors can edit content; naming, publication, list
deletion and persisted list view preferences remain owner-only. Non-owner view-mode
switches are local presentation changes. Role changes update open details and menus.
Public-link access remains independent; an invitation does not unpublish content.
Broader sharing discovery and Shared with me remain #258.

## Inviter identity and privacy

Sending or resending requires an explicitly chosen, valid public display name.
The shared editor on Invitations and Profile uses `users.setPublicDisplayName`,
a session-only, self-account mutation. It records `displayNameChosenAt`; neither
historical names nor signup defaults imply consent. `users.getMyPublicDisplayName`
returns only the eligible name or null, never prefilling a historical private name.
The client waits for this query before enabling send/resend. Saving a name never
sends an invitation automatically. Revoke and accepted-access management remain
available before name setup.

The editor explains that the name appears publicly in invitations, invitation emails
and shared activity, while the account email stays private. Names are trimmed and
Unicode-normalized, must contain a letter and be 2–80 characters, and cannot contain
email addresses, control/hidden characters or generic defaults (`boop user`, `user`,
`anonymous`, `unknown`). The first part of the stored or signed-session email is also
rejected case-insensitively. URL punctuation (colon and slashes) and domain-shaped
text, including IP addresses, punycode and Unicode dot variants, are rejected after
normalization. Periods must be followed by whitespace or end the name, preserving
spaced initials (`J. Smith`) and suffixes (`Smith Jr.`); apostrophes, hyphens and
multilingual letters/marks remain supported. Invitation emails quote the name as
an account attribute rather than presenting it as a message from boop.
This is an explicit recognizable-name choice, not legal
identity verification. Nicknames and non-Latin names are supported.

Preview, inbox, background mail payload and acceptance use `chosenPublicDisplayName`,
which applies the existing `publicDisplayName` masking policy plus explicit-choice
and validation checks. Old pending invitations stay unavailable and queued mail is
suppressed until the sender saves a valid name; owners can then explicitly resend.
Existing accepted grants are not revoked by name eligibility changes. No inviter
email is returned to recipients or added to mail content or reply-to headers. This
requires the optional schema field and backend deployment before the new UI; no
historical-name migration or automatic consent backfill is performed.

## Client API

Browser/native hooks use `src/lib/authenticatedConvex` and its regenerated local
registry. Credentials follow existing #256 adapters. Internal variants of public
operations use the same transaction authentication and authorization. No new HTTP
route or anonymous invitation-inspection endpoint is introduced.

| Operation (`api.invitations`) | Business arguments | Result / behavior |
| --- | --- | --- |
| `createInvitation` | `listId`, `email`, optional `role`, `requestId` | `{ invitationId, version }`; normalizes whitespace/case, defaults to viewer; no recipient-account lookup |
| `getListInvitations` | `listId` | Owner-only email, intended role, status, expiry, delivery and optional accepted grant ID |
| `updateInvitationRole` | `listId`, `invitationId`, `version`, `role` | Changes current pending role; acceptance uses that role |
| `revokeInvitation` | `listId`, `invitationId`, `version` | Revokes a pending/expired invitation, not an accepted account grant |
| `resendInvitation` | `listId`, `invitationId`, `version`, `requestId` | Increments version, restarts seven days and queues email; all earlier versions stop working |
| `getPendingInvitations` | none | Verified recipient only: locator/version, inviter display name, role, expiry; no resource ID/title/body/attachments/email roster |
| `getInvitation` | `invitationId` string, `version` | Same limited preview, or `null`; malformed IDs also return `null` |
| `acceptInvitation` | `invitationId`, `version`, `accept: true` | `{ listId, grantId, role }` only after matching verified email and explicit acceptance |

Accepted access is managed with existing `api.listGrants.getListGrants`,
`updateListGrant` and `revokeListGrant`. Owner mutations require ownership and `*`
scope; roster queries require ownership and `lists:read`. Recipient operations
require a server-signed, registered and non-revoked session; API keys cannot prove
mailbox ownership. The signed OTP session email is authoritative, not profile email.
No plan checks or product recipient cap apply.

## State, retries and revocation

One invitation row exists per normalized email/resource, using indexed transactional
reads. Repeating create returns the existing locator without sending another email,
reviving a revoked invitation or changing its role. Creation/resend require a caller
request ID (8–128 alphanumeric, underscore or hyphen characters). Reusing an ID with
the same normalized payload returns the original result even after later state
changes; different payloads are rejected. Receipts store a hashed fingerprint and
persist until owner account deletion. UI retries retain keys after uncertain failures.

Acceptance reads invitation state, expiry, account authority and grants in the same
Convex mutation as inserting the grant and marking the invitation accepted. Convex
transaction conflicts serialize competing accepts, revoke, resend and role changes.
Repeated acceptance returns only the same account's still-existing grant and its
**current** role; it never recreates a deleted grant or overwrites a later role.
An existing grant is retained rather than replaced when accepting an invitation.

Account-bound grant-revocation tombstones also reject pending invitations issued
before revocation, even if they had never been accepted. A deliberate owner resend
after revocation provides fresh authorization. Same-millisecond issuance/revocation
ambiguity fails closed: resend on a later tick. An accepted invitation cannot be
resent while its grant still exists. Pending roster/preview also hide invitations
invalidated by a recipient's revocation record.

Seven-day expiry is checked by mutations independently of the scheduler. A scheduled
version-checked expiry mutation also removes expired invitations from reactive
subscriptions. Delayed or obsolete expiry/delivery jobs cannot affect a newer version.
Owner account/resource deletion removes invitation rows; recipient deletion removes
only account-bound accepted invitation rows/revocation records. Pending email
invitations are deliberately **not** deleted using an untrusted profile email.

## Email and abuse limits

The internal mail action reuses the application's Resend endpoint, `RESEND_API_KEY`
and `brian@boop.ad` sender. Email contains inviter display name, generic invitation
instructions and a versioned locator. It contains no resource title, body, identifier
or attachments. The locator is not a bearer credential. Provider idempotency keys
are stable per invitation/version. No email was sent during local verification.

Owner status is `queued`, `sent` (provider accepted the request, not an inbox delivery
or read receipt), or `failed`. Missing configuration, transport errors and non-2xx
responses produce a generic failure. Provider response details are never exposed or
stored. Resend starts a new version and new delivery attempt; it does not create a
grant. An already-in-flight email can still arrive after revocation, but cannot grant
access. No automatic unbounded retry loop is introduced.

Database-backed fixed-window limits are 30 sends/owner/hour, 3 sends/owner-recipient/
hour, 10 sends/recipient/day across owners, and 120 new request IDs/owner/hour.
Recipient budget keys use email hashes. Retries with the same request ID do not
consume budget. These are abuse limits, not a paid feature or lifetime recipient cap.
Creation responses never disclose whether an account exists. Delivery errors are
generic and visible only to the resource owner. Invalid recipient addresses and
rate-limit failures use actionable `ConvexError` strings so the UI preserves the
correction/retry guidance in production.

## Local verification and limits

Handler tests exercise production credential verification and handlers against the
repository's deterministic in-memory fixture. They cover matching/new-account
acceptance, explicit acceptance, forwarded/wrong-email links, spoofed profile email,
API-key rejection, owner scopes, expiry/resend/revoke/replay/current role, pre-existing
grant revocation, mail privacy/failure/idempotency, rate limits and deletion cleanup.
React tests exercise route review, embedded sign-in placement, owner controls,
delivery failure display, request-key retries and explicit acceptance navigation.

Focused regression suites, backend TypeScript, `tsc -b`, focused ESLint and a Vite
build with `VITE_CONVEX_URL=https://placeholder.convex.cloud` run without Convex codegen,
`.env.local`, live deployment access or real mail. `_generated/api.d.ts` adds the two
module registrations to committed generated types without invoking deployment tools.

The handler fixture does not implement Convex schema validation, transactional
rollback/OCC, scheduler timing or reactive subscription transport. Repeated and
ordered handler calls verify state transitions; real simultaneous-request OCC still
needs isolated deployment integration coverage. UI tests mock reactive queries and
mutations; the mounted destination suite additionally runs production invitation
acceptance/read/role handlers and mounts actual ListView rows, menus, keyboard
shortcuts, calendar, details and comments. Device/offline transport is still a
fixture. Real OTP/mail delivery and native universal-link release configuration
remain integration checks. The local collaborative browser exercised the actual
page with fixture data at desktop/mobile widths, with no live backend. Its snapshot
and click automation failed; DOM evaluation and React interaction tests supplied
layout/behavior checks, without claiming screenshot verification.
