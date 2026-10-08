# Authenticated operations rollout

The authenticated boundary was merged in PR #241. The release owner requested removal of the automatic deployment gate on 2026-09-14 and selected the existing dev environment for staging validation. The client inventory and staging results below remain pending; removing the build check does not attest that they passed. Do not retire compatibility names until supported client versions and usage have been confirmed. Merely retaining a function name does not make an old unauthenticated client compatible.

## Client evidence required

| Client | Evidence in this checkout | Deployed evidence still required |
|---|---|---|
| Browser | package version 1.0.0; this branch adds the session adapter | Railway release commit, cached service-worker versions, and confirmation that authenticated direct calls are in use |
| iOS | marketing version 1.0, build 3 | App Store/TestFlight versions, supported installed versions, and minimum-version/update policy |
| Android | versionName 1.0, versionCode 1 | Play/internal-track releases, supported installed versions, and minimum-version/update policy |
| HTTP/agents | JWT and X-API-Key adapters retained | Active integrations and confirmation whether any bypass HTTP and call Convex directly |

Local version strings are not evidence of deployed or active versions. No release inventory or production verification was available in this task. Record actual confirmation as rollout validation proceeds. Unauthenticated direct callers must upgrade; there is no safe fallback that accepts an asserted identity.

## Boundary and compatibility

- Browser/Capacitor establish the existing signed JWT with `actorSession.establish` before subscribing. Reactive calls carry `authToken`; HTTP calls continue using Bearer/cookie JWT or X-API-Key. HTTP registers valid pre-rollout JWTs automatically.
- `accessSessions` stores only token hashes, subjects, expiry and revocation. Scheduled expiry, a bounded indexed cleanup sweep, and logout change database state, invalidating private query caches. A revoked token cannot establish another session. Existing verified account records and legacy DID associations remain intact.
- Every protected operation resolves current/legacy identity from server records. Each operation declares its resources and required scope. Internal HTTP registrations use the same authenticated boundary and recheck key revocation in the data transaction.
- Public operation names remain, with optional legacy assertion fields accepted only when matching the authenticated account. These fields confer no authority. Shared business handlers receive authenticated context and declared business arguments only.
- OTP/session storage helpers retain rejecting public compatibility names; the verified login HTTP flow uses internal registrations. The public account lookup is limited to the signed-in account. New identity links cannot be established by asserting another current or legacy DID.
- Public list/resource reads require an active publication. Published lists remain readable without login; editing requires ownership or an accepted editor grant, intersected with API-key scopes when applicable (see the #256 foundation cutover below). Bookmarks stop exposing a list when it is unpublished.
- Site uploads now bind pending object keys to the authenticated account. Finish or restart any pre-cutover pending site uploads; existing stored site files remain readable through authenticated ownership checks. Attachment and site upload references reject path traversal.
- The generated browser operation registry uses typed Convex references. After adding/renaming an authenticated operation, run `node scripts/generate-auth-client.mjs`; verify with `--check`.

## Coordinated rollout

1. Confirm the inventory above, including old mobile builds and stale browser tabs. Choose the supported client floor and user update/reauthentication messaging.
2. In staging, deploy the schema/functions together, then the matching browser/native clients. Verify scheduling is operational for session expiry. A frontend deployed against the previous backend will not find `actorSession.establish`; an old frontend against the secured backend cannot make unauthenticated direct calls. Coordinate the cutover or enforce an update window.
3. Validate OTP login/new-account DID setup, session restore, logout/expired-session invalidation, private list reads, shared edit/unpublish, attachment upload/read/removal, publishing and migrated accounts on web/iOS/Android. Test old valid JWT HTTP clients and current/legacy-owner API keys, then revoke keys and test insufficient scopes. Use designated test accounts and lists.
4. Record the results and any remaining gaps for the release owner. Production deployment no longer waits on this record. Remove old public names/assertion validators only in a later release after usage and supported versions demonstrate they are unused.

## Release evidence and manual checks

`release/authentication-cutover.json` retains the rollout evidence and approval record. It is intentionally pending: fill in the deployed/supported versions and evidence for browser, iOS, Android and integrations, link the staging results, and record owner approval only when it is actually given. Evidence must identify actual releases and exercised behavior; source version strings alone are insufficient. If a platform has no supported deployments, record the inventory evidence establishing that fact.

The Convex workflow and Railway build no longer invoke `scripts/check-authentication-cutover.mjs`. The checker remains available as an optional manual completeness check; run `node scripts/check-authentication-cutover.mjs` when validating the record. It will report missing evidence until the record is complete. Local, dev, preview, and production builds do not depend on its result.

The record is an auditable release attestation, not proof of who approved it. On 2026-09-09, GitHub reported `main` as unprotected, no repository rulesets, and no `CODEOWNERS` file. This change does not configure required owner review or change live repository policy.

The removal lifts the automatic block on all configured production builds and Convex deployments, including unrelated hotfixes. It does not change authentication, resource authorization, API scopes, migrated-account access, or compatibility retirement requirements. Use the existing dev environment for staging checks with designated test accounts; record observed results rather than filling the evidence fields merely to satisfy the checker.

## Compatibility retirement follow-up: AUTH-COMPAT-RETIREMENT

Owner: Brian (`brianorwhatever`). Review date: 2026-09-16. Status: pending deployed-client inventory.

Retain the old operation names and matching-identity argument validators during this cutover. Retire them in a separate PR only when the owner has confirmed the supported-version inventory and recorded 14 consecutive days with no compatibility calls or legacy assertion fields from supported clients. Record the observation window and evidence alongside the inventory; absent telemetry means the retirement condition is unmet. This follow-up covers rejecting OTP helper names and the self-authenticated `upsertUser` alias as well as the assertion validators.

The unused client `startOtp(..., legacyDid)` parameter has been removed. Existing server-owned legacy associations continue to resolve; new account linking requires a separately verified ownership flow and cannot use an asserted DID.

## Post-Deploy Monitoring & Validation

Release owner: Brian (`brianorwhatever`, PR author). Observe continuously for the first 30 minutes and review again at 24 hours.

- Convex logs: search `Authentication required`, `Invalid or expired token`, `Invalid API key`, `Missing scope`, `Not authorized`, and unknown-function/argument-validation errors. Check `actorSession.establish`, `actorSession.expire` and scheduled-function failures.
- Watch login success, private query failures, offline sync retries and HTTP 401/403 rates, broken down by release/platform where available. Healthy behavior: test-account login/restore works; revoked/forged requests fail; no anonymous private reads; expiry removes access; supported releases produce no new unknown-function errors.
- Failure trigger: legitimate supported clients cannot login/read/write, scheduling fails, or any private bypass succeeds. Pause rollout, keep access restricted, and repair/update clients or provide a maintenance response. Do not restore DID-only authorization as an automatic rollback.

## Evidence limits

Regression tests exercise real signed JWT verification, database-owned identities, handler business behavior and HTTP-to-internal dispatch against in-memory fixtures. React provider tests exercise restore acceptance, rejection cleanup, and logout/login serialization; adapter tests cover token changes and long-session expiry. Convex code generation/type analysis, TypeScript and the application build validate integration statically. The repository lint baseline and any new diagnostics are checked separately. These do not prove live OTP delivery, WebSocket cache invalidation timing, bucket upload completion or deployed native behavior. Those checks remain part of the rollout validation checklist above.

## Local validation

- `node --test scripts/*.test.mjs`: 228 passed.
- `bun test`: 252 passed, including browser component and authentication lifecycle tests.
- `npx convex codegen --typecheck enable`, `npx tsc -b`, and `npx vite build`: passed. Code generation performs deployment analysis without completing a deployment. The build retains existing large-chunk warnings.
- `npm run lint` does not pass: it includes existing source errors, nested checkouts and generated test bundles. A comparison restricted to `src` and `convex` reports 49 errors versus 51 on the pre-change baseline, with no new error diagnostics. This change does not claim a clean repository lint baseline.
- The completed `ce-code-review` run (`20260908-223043-d36023ea`) reports no actionable findings after fixes. Ten local review passes and independent validation completed; the external cross-model pass timed out, so no cross-model corroboration is claimed.

The originally reported anonymous handler reproduction is now a regression test. Actual React provider tests additionally cover expiry of a mounted 30-day session, logout/login ordering and credential cleanup; server tests cover idempotent establishment and premature expiry callbacks.

PR preparation replayed the authorization change on `024144f` from `main`, preserving the canonical account-selection and duplicate-email signup protections from PR #235. The combined login and authorization tests pass; an independent conflict review found no issues.

Review follow-up adds regression coverage for bounded restore/OTP verification, authenticated shared-list writes and visible failures, bookmark removal after unpublishing, expiry sweep limits and revoked tombstones, production-serialized access errors preserving offline edits, and deployment approval enforcement. The five review findings are addressed in code; deployed client evidence and live staging checks remain pending in the release record.

The follow-up review distinguishes session failures from resource denials. Missing and inaccessible resources have the same structured `FORBIDDEN` response (single-list reads return `null` for either). Offline resource denials do not stop later edits; each denied edit uses the existing five-retry budget, then is discarded with a warning. Session failures preserve all remaining edits and retry counts. Regression tests cover permanent denial, restored access, production RPC response equality, and migrated bookmark-ID enumeration.

## Persistent mobile sessions

New OTP logins from the iOS and Android apps request a persistent session. The server signs `sessionType: mobile_persistent`, a unique `jti`, and `iat`, with no `exp`. Web logins and clients that omit the platform keep the 30-day token and cookie. The platform is a client preference, not device attestation; all clients still need successful OTP verification before token issuance. Native clients store the bearer token through the existing storage adapter, and the verification response clears the auth cookie instead of putting the persistent token in it.

`accessSessions.expiresAt` is optional for persistent sessions. They have no expiry job, but private reads still check the database record and reject revoked tokens. Retain persistent revocation records indefinitely so a logged-out token cannot be established again. Ordinary JWTs without `exp` remain invalid unless they carry the signed persistent mobile claims.

On mobile, session restoration retries unexpected server/connection failures every five seconds while keeping the saved credentials. Private queries stay signed out and the loading state remains active until the server accepts the session. Explicit invalid-token/account rejections clear the saved login.

Deploy the schema and backend before distributing updated native builds. Existing tokens retain their original expiry; users receive a persistent token on their next login in the updated app. Old native builds continue receiving 30-day sessions. This change has been validated locally with the auth boundary/provider/client and DID-log auth scripts (43 tests), frontend/backend TypeScript checks, and lint on the changed source files. Native device and live deployment checks are still needed when releasing.

## Bounded #236 follow-up: public attribution and auth budgets

`users.getUsersByDids` intentionally remains public for attribution. Its response
contains only `displayName`: names equal to the account email local part and
unnamed accounts return `null`; other stored public names are preserved. Unknown
DIDs retain the existing shortened-DID label. The query
never returns email or derives a fallback from email. ItemAttribution,
ItemDetailsModal, and both ProvenanceInfo consumers read only `displayName`.
New OTP signups no longer pass an email-derived name, and new-account storage
uses the neutral default `boop user`. The welcome email may still use a private
local-part greeting. Historical email-derived names are masked at public read
time without a production data migration. Exact local-part matches are masked
even if deliberately chosen; other public attribution names remain unchanged.
Authenticated self-profile email and stored names remain intact, including on
returning logins.

Auth HTTP initiation and verification dispatch to
`rateLimits.checkAndIncrementInternal`. Counter inspection and expired-record
cleanup also have internal registrations; the old public names reject without
reading or changing budgets, following the OTP-helper compatibility convention.
Any trusted cleanup integration using the old public name must move to
`cleanupExpiredInternal`. There are no cleanup/status callers in this checkout.
Compatibility retirement still requires the deployed-client inventory above.
The existing production-only limiting policy and fixed windows remain unchanged:
10 initiate attempts per IP and 5 verify attempts per session per minute.

Local regressions cover the HTTP new-signup path, neutral storage defaults,
historical name masking, authenticated self-profile preservation,
anonymous/unrelated public DID lookups, rejecting direct
counter access, internal registration visibility, HTTP dispatch, the final allowed
attempt, 429/Retry-After responses, and exact window expiry. HTTP tests run the
production router branch with in-memory budget storage and stubbed OTP providers;
they do not contact a deployed backend or prove live proxy IP-header trust.

This is a bounded follow-up, not full closure of #236. The action revocation race
between an authorization check and a later action side effect remains a separate
follow-up; this change does not address it. Deployed-client inventory, staging
validation, and rollout evidence remain pending. No deployment is included.

Validation for this follow-up: focused auth/rate-limit boundary tests 40 passed;
full `bun test` 311 passed; `tsc -b`, `tsc -p convex/tsconfig.json`,
`node scripts/generate-auth-client.mjs --check`, and `vite build` passed. The
build used checked-in Convex declarations and local tooling without deployment
codegen or live credentials. Vite reported large chunks; the explorer-filter test
reported a React `act(...)` warning. Generated image test artifacts were reverted.

Review correction for PR #251 comment 4172648564: the original fallback removal
still exposed signup-derived stored names. The new-account default and historical
read-time masking above address that gap. Revalidation: 54 focused auth boundary,
rate-limit boundary, and login-account tests passed; full `bun test` passed 314
tests; frontend/backend TypeScript and the generated auth registry check passed.
The existing React `act(...)` warning remains. Test-generated icon/splash changes
were reverted. No live signup, production data migration, or deployment was run.

Review correction for PR #251 comment 4172706903: masking now uses the shared
`convex/lib/publicDisplayName.ts` helper in all three anonymous stored-name
projections: `users.getUsersByDids`, `publication.getPublicList.list.ownerName`,
and `publication.getPublicList.items[].createdByName`. Published-list attribution
retains `Unknown` for masked/missing names, including contributors resolved by
legacy DID; DID lookup retains `null` for masked names. Genuine non-email names
remain public. The generated Convex module declaration includes the new helper;
it adds no callable operation or authenticated-client registry entry.

The Convex attribution audit searched display-name reads and user-record lookups,
then checked registrations and return values. Raw account queries in `auth.ts`
are internal or authenticated self reads. The HTTP name response follows verified
OTP login. Signup storage and the internal welcome-email greeting remain private.
DID resource/log endpoints do not project stored user names. Other account reads
in billing, referrals, quotas, permissions, session resolution, admin/dev helpers,
and migrations are authenticated/internal or return no display name. The new
boundary regression checks anonymous and unrelated callers, historical owner and
creator names, migrated legacy-DID contributors, deliberately public names, and
unchanged stored profiles across both public attribution queries.

Validation after the shared-helper correction: 55 focused auth/rate-limit/login
boundary tests and 315 full Bun tests passed; frontend/backend TypeScript and the
authenticated-client registry check passed. The existing React `act(...)` warning
remains. Test-generated icons/splashes were restored. These are local handler and
static checks, not deployed validation; the #236 limitations above still apply.


## #256 private-sharing authorization foundation (incomplete acceptance)

This foundation changes backend authorization immediately when deployed. It is
not the complete private-sharing release, does not complete #256 or #259, and
includes no deployment, live codegen, migration, or historical auto-grants.
Coordinate release with #257–#262 and the deployed-client inventory above.

### Authority and internal integration

- `listGrants` holds **accepted** viewer/editor roles against stable `users._id`
  recipients and the existing list boundary (including notes). Owner identity
  remains on the list. Pending invitations must use separate state and never
  enter this table until verified explicit acceptance. Neither a bookmark,
  public link, item authorship, nor an old collaborator record grants editing.
- `actorQuery` defaults to read authority; `actorMutation` and `actorAction`
  default to content-edit authority. Rename, whole-resource delete, publication,
  account-level list categorization and anchoring writes explicitly require
  owner authority. Anchor verification explicitly requires read authority and
  `items:read` scope; it neither signs nor writes. Copy-source reads and public bookmarking explicitly require
  read authority. Presence writes and comments require owner/editor authority;
  a revoked comment author cannot delete comments using the old author exemption.
- API scopes remain necessary in addition to resource authority, including
  internal HTTP registrations and the action authorization checkpoint.
  `canEdit` responses also reflect the credential's `items:write` scope.
  An editor grant never permits owner publication/envelope replacement or access
  to the owner's signing keys. Key custody and provenance signatures are unchanged.
- `getListGrants`, `updateListGrant`, and `revokeListGrant` are owner-only and
  operate only on existing accepted grants. Update/revoke require wildcard (`*`)
  scope, matching publish/unpublish: an owner key with `items:write` alone cannot
  manage access. The owner-only roster retains `lists:read` scope. Browser-owner
  sessions retain their wildcard authority. `getMyListAccess` reveals owner DID
  and the current caller's role; it never reveals other recipients. The backend
  discovery query includes accepted shares; the dedicated sharing UI is #258.
- `convex/lib/listGrants.ts:recordAcceptedListGrant` is a server library helper,
  **not a callable Convex endpoint**. The #257 invitation-acceptance mutation must
  verify the current invitation, expiry, matching verified email/account and
  explicit acceptance in the same transaction, then consume that invitation and
  call the helper. Existing grants are rejected rather than overwritten. Invite
  replay/revocation/role changes must be resolved by that invitation state machine;
  calling this helper alone is not proof of invitation acceptance.
- Grants are read in the same query/mutation as resource authorization. Fresh
  offline replays check access before inspecting resource revisions. Existing
  receipts only acknowledge an already-completed operation. Grant deletion or
  downgrade changes subsequent query results/writes; cached client data and
  live transport invalidation timing are not proven by the local fixtures.
- List deletion removes its accepted grants. Bounded account erasure drains
  both grants on owned resources and grants received by the account. Marking an
  owner for deletion immediately denies recipient reads/writes while cleanup runs.

### Copies: explicit remaining #256 acceptance work

Attachment-free list copies are owned by the copier, private, and grant-free.
They retain independent items with remapped parent/tag IDs, omit the source
owner's private category reference for recipients, and do not alter source
ownership or carry source provenance proofs. They survive source revocation or
resource deletion. A viewer/editor still needs `items:write` scope to create a
server copy; existing readable exports use their normal read scopes.

**Copies containing any attachments are rejected before destination, envelope,
quota-reward, or item writes**, including legacy and mixed attachment arrays.
The error tells the caller attachments must be exported separately and that the
source is unchanged. Empty attachment arrays remain copyable. This is an interim
safety restriction, not satisfaction or reinterpretation of the independent-copy
criterion. Notes copying remains unsupported as before. A complete attachment
copy requires staged physical object copies or a fully versioned, immutable
storage/reference lifecycle. Reusing mutable bucket keys or a small reference
counter is unsafe because old copies and reusable PUT URLs already exist.
Historical copies are not migrated. Removing an attachment whose key belongs to
another item is now rejected before storage deletion. Existing row/list/account
erasure does not physically delete these bucket objects; explicit attachment
removal does. No claim is made that historical copied attachments are independent.

### #259 compatibility cutover

The following inventory describes the original foundation gaps. The #257/#259
client changes supersede the ListView, SharedListResource and ShareModal entries;
see [the current publication/sharing contract and audit](sharing-publication.md).

Existing public reads remain available. **Signed-in public-link visitors lose
editing unless they have an accepted editor grant.** Retained legacy operation
names reject unauthorized writes. The current client capability inventory for
#258/#259 includes:

- `src/pages/ListView.tsx:692` hardcodes `canUserEdit = true` for every visitor
  and passes that value into item/sub-item controls. The separate keyboard
  shortcut path at line 437 hardcodes `canUserEditNow = true`. Both need current
  content-edit authority, including after grant downgrade or revocation; hiding
  buttons alone does not prevent keyboard actions or queue insertion.
- `SharedListResource` promises that signing in permits edits; public read and
  authenticated editing must be distinguished. `ShareModal` still conflates
  sharing with public publication and needs separate owner-managed access and
  publication flows.
- `NoteView` uses content `canEdit` for rename/delete controls. Accepted editors
  may edit bodies, but those resource-management controls require ownership.
  Owner-only controls and content-edit controls must consume distinct capability
  checks (`getMyListAccess` or an appropriately scope-aware server capability).
- `src/lib/permissions.ts` supplies ownership/role presentation helpers, not a
  complete current-access decision. Its stale public-edit header is corrected
  here; that comment correction does not implement the client cutover.
- Existing browser/native mutation paths and offline queue entry points must use
  current capabilities. `src/lib/sync.ts` retries denied edits up to five times,
  then retains them as failed work. The client cutover must prevent unauthorized
  editing/queue creation and coordinate downgrade/revocation handling and saved
  draft/export recovery with #260, including keyboard shortcuts, reconnects,
  stale tabs and supported older native clients. Backend denials alone do not
  deliver that user experience.

Invitation acceptance and owner-facing grant creation are not included here.
**Do not merge this foundation into `main`, bring it into `main` through another
branch, or deploy it before the coordinated client cutover and accepted-grant
migration/acceptance rollout are ready and verified.** Any accepted-grant
migration must preserve verified explicit acceptance; historical bookmarks,
contributors and public collaborators must not be automatically granted access.
No such migration or rollout is performed by this change. The other documented
attachment-copy and release-evidence blockers remain outstanding.

PR #264 is ready for review at the user's request, which is not readiness or
authorization to merge/deploy. #263 has merged and #264 now targets `main`.
A push to `main` triggers `.github/workflows/deploy-convex.yaml`, which runs
`npx convex deploy`; the Railway deployment uses `railway.json`'s `npm run build`
(the script also invokes Convex codegen) for the web app. Main's automatic
deployment paths make merging a release action, not a harmless staging step.
The old authentication cutover checker is not an enforced deployment gate.
Release coordination must account for backend and web/native timing before any
merge; review status or green CI does not satisfy these gates. Do not restore
implicit public editing as a compatibility fallback.

### Attachment and notification limits (#260 / authentication action follow-up)

Attachment fetches authorize the current resource before issuing URLs, and new
upload/removal actions require current edit authority and scope. The internal
attachment checkpoints reauthenticate. Already-issued GET/PUT URLs remain bearer
capabilities for up to 600 seconds; this foundation does not revoke them. There
is still a gap between an action's authorization query and external storage I/O.
A test explicitly demonstrates revocation after byte deletion rejecting the final
metadata write while the external deletion has already happened. Resolving this
requires the separate action/storage protocol; these checks are not atomic.

Notification recipient lookup now filters current read access at scheduled send
lookup, including grants, migrated accounts, and historical bookmarks after
unpublishing. Bookmark-generated per-user notifications carry a list ID so they
receive the same check. A revocation after token lookup can still race external
push delivery. Client cache clearing, queued-draft recovery, invitation mail,
unsent-work UX, and stale-save changes belong to the dependent issues.

### Local verification scope

The private-sharing suite calls real exported direct/legacy, internal, HTTP and
action handlers with signed fixture JWTs and hashed API keys. It covers the
owner/editor/viewer/outsider/anonymous matrix (plus pending-only accounts), metadata,
notes/cards, attachment checks, ID substitution even across two authorized lists,
API scope intersection, grant changes, copies, notification lookup and erasure.
Storage signing/deletion is stubbed; no network side effects or live credentials
are used. Fixture re-execution and observed grant-index reads demonstrate query
logic and dependencies, not live WebSocket behavior. Convex schema validation/OCC,
presigned URL revocation, actual bucket/push operations and web/iOS/Android
cross-platform release behavior still need isolated integration/staging evidence.

Grant-management regressions cover denial without writes for item-write API keys,
owner wildcard and browser-session success, non-owner wildcard denial, and
unchanged roster read scope. Run the private-sharing suite, full Bun suite,
frontend/backend TypeScript checks, generated auth registry check, changed-file
lint and an isolated Vite build when changing these boundaries. Keep per-commit
results and review status in the pull request; local fixtures do not satisfy the
integration and release gates above.


Private invitations require the stronger `chosenPublicDisplayName` policy: a valid
name explicitly saved through the session-only `users.setPublicDisplayName` control
on Profile or Invitations. `displayNameChosenAt` records that choice; old stored
names never count as consent. The control explains public visibility and rejects
email addresses, normalized/case-insensitive local-part matches, generic defaults
and hidden characters. Preview, inbox, queued mail and acceptance all enforce this
policy, including historical pending invitations. The account email remains private.
The existing general attribution masking contract above is unchanged.

## #236 closure: inventory, identity binding and remaining direct entry points

[`authenticated-function-inventory.md`](authenticated-function-inventory.md) classifies
every public Convex function. `scripts/public-function-boundary.test.mjs` enforces it
against the real registrations: any new public function must be actor-wrapped or
explicitly classified, and every protected function must reject anonymous, unknown-key
and asserted-identity (current and legacy DID) calls before any read or write.

### Authentication integration: keep the session-record boundary

The boundary from #241 stays: browser and Capacitor send the OTP-issued JWT as
`authToken`, which must match a live `accessSessions` row; agents send `apiKey`. Convex's
built-in `ctx.auth` (`auth.config.ts` custom JWT/OIDC provider) was considered and not
adopted, because:

- it validates asymmetric (RS256/ES256) tokens against a JWKS endpoint, while the
  Turnkey/OTP flow issues HS256 tokens under `JWT_SECRET`. Switching would need new
  signing keys, a published JWKS and a re-login for every session, which is an
  infrastructure decision this change does not need;
- `ctx.auth` identities are stateless. The `accessSessions` record is what makes logout,
  expiry and persistent-mobile-session revocation invalidate reactive queries;
- API keys would still need the argument path, so it would add a second boundary rather
  than replace one.

The session boundary already gives server-derived identity for every caller. If a JWKS
issuer is adopted later, `authenticate()` in `convex/lib/actor.ts` is the single place to
add a `ctx.auth` branch.

### Gaps closed

- **Account DID binding.** `/api/user/remintDid` let an authenticated user move their
  account onto any `did:webvh`, including another user's. Ownership is DID-based, so that
  gave owner access to the victim's lists and keys. Re-mint and `/api/user/updateDID` now
  require a `did:webvh` minted at the caller's own path. `applyRemint` refuses a DID held
  by another account, and its publication prefix rewrite matches only `{oldDid}/…`.
  `updateDID` no longer accepts `did:key`, which only server-side login derives.
- **Publication DID binding.** `publishList` requires `webvhDid` to be
  `{actor current or legacy DID}/resources/list-{listId}` (what every client sends). The
  `/d/*` fallback serves a list under a path only when the publication's controller is the
  list owner's current or legacy DID.
- **Internal operations no longer public.** Anchor record writes, list-wide pushes,
  activity writes, and the Sites/DID resolver lookups (see inventory). None were called by
  any client.
- **Cross-account references.** `createList` and `updateListCategory` accept only the
  actor's own categories. `deleteUserData` declares its account resource at the boundary.
- **HTTP status contract.** Category and billing routes returned 500 for credential
  failures; they now return 401/403 like every other route.

### Credential attribution and PR #277

Every actor-wrapped call resolves `ctx.actor.credential`: the `accessSessions` row or the
specific `agentApiKeys` row, with that key's scopes and revocation checked in the same
transaction (#273).

This change persists it as an optional `credential` field (`{ kind: "session" | "apiKey", id }`)
on:
- activity rows: assignment, unassignment, inherited assignments and presence events;
- comments;
- a new `comment_deleted` activity row, which records only the comment ID (not its
  text or author).

Two keys on one account therefore leave distinguishable history. Credentials are stored
for audit but stripped from every read response (`getListActivity`, `getItemComments` and
the activity HTTP route), because published lists are readable by any signed-in account.
An owner-facing audit view is a possible follow-up.

The shared assignment helpers read the credential from the actor context the wrapper
already provides. That leaves the `items.ts` call sites that PR #277 (#237) restructures
untouched; the branches merge cleanly. Server-originated rows (reconciliation, crons)
and rows written earlier have no credential. #277 adds signed action records binding the
same credential for item and list actions. Agents reading `/api/activity/list` may now see
the additive `comment_deleted` type.

### Rollout order (coordinated with #262)

1. **Deploy Convex first.** Everything here tightens the server. The only schema changes are
   additive: optional `credential` on `activities` and `comments`, and the
   `comment_deleted` activity type. Existing rows satisfy them. There is no
   new client call or public name, and no ordering in which access widens.
2. Then deploy web/native. The only client change is the regenerated session registry,
   which drops four names no UI calls. Older clients keep working because none call the
   removed names, and every client already sends a self-path `did:webvh` and an own-DID
   `webvhDid`.
3. Degradation: a stale or forked client that sends a foreign category, a non-self
   publication DID, or a `did:key` to `updateDID` gets an error; nothing is written. A
   failed re-mint keeps the old DID (the client retries on a later load).
4. Rollback: reverting the backend reopens the gaps. Repair forward instead, as with #241.
5. #262 is unchanged: the deployed-client inventory and staging evidence above remain
   pending, and #262 still requires that evidence before recipient grants are enabled.

**Recommended read-only data checks before or after deploy (not run here):**
- publications whose `webvhDid` controller is neither the list owner's current nor
  legacy DID;
- users sharing a `did`/`legacyDid` value;
- anchors with `status` `inscribed`/`confirmed` not produced by `anchorListState`;
- lists whose `categoryId` belongs to another owner.

Any hits are evidence of earlier misuse and need an owner decision; this change does not
rewrite them.

### Follow-ups found during the audit (outside #236 scope)

- An editor can publish a list's contents as a public template, via `createFromList`
  (`isPublic`), or by saving privately and then `updateTemplate`. Any reader can also
  retype the items into `createTemplate`, so a server rule cannot prevent this by itself.
  Whether shared-list contents may be published as templates is a product decision.
  This change does not redefine template publication.

- Push registration re-binds an existing token or endpoint to whoever presents it, and
  `registerPushToken` accepts any URL for `web`. That URL is later POSTed to server-side.
  Validate push-service hosts and insert rather than re-bind.
- `users.getUsersByDids` has no input cap and scans users per DID.
- Anonymous `publication.getPublicList` does not apply the owner-deletion barrier that
  `canUserViewList` applies.
- An `items:write` key can delete lists it owns (owner authority, write scope). Confirm
  this is intended.
- `/api/attachments/download` does not register a never-used cookie JWT (fails closed).

### Verification for this change

- `bun test`: 697 pass, 0 fail (683 on `main` plus 14 new):
  - 6 exhaustive boundary tests: all 172 public registrations, plus every HTTP route
    queried anonymously, with a forged key, and with a forged bearer token;
  - 8 identity-binding regressions, covering re-mint, `updateDID`, publication DID,
    resolver fallback, categories, persisted session/key attribution (activities and
    comments) and credential resolution.
  - The HTTP pass also fails on any read beyond the credential tables before rejection;
    `/d/*` may additionally read the public resolution tables.
- The boundary test was checked against deliberately reintroduced gaps: a public copy of a
  formerly internal query, and a raw mutation that trusts `checkedByDid`. It fails on both.
  Its HTTP pass found the 500-for-auth responses fixed above.
- Not verified: live Convex deployment and codegen, OTP/login on deployed web/iOS/Android,
  real did:webvh re-mint against production data, and the data checks above.
