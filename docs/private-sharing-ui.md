# Private sharing controls and discovery (#258)

ShareModal embeds the same owner invitation controls used by `/invitations`.
The controls default to viewer, retain retry keys, show pending/expired/revoked/
accepted status and delivery failure, and manage accepted roles. A historical
accepted invitation whose grant no longer exists is labeled “Access ended
(revoked or left)”. Sending another invitation requires an explicit owner resend.
Named sharing and public publication remain independent, visibly separate choices.
The complete invitation email roster and accepted account roster remain owner-only.

`/shared` (Shared with me) subscribes to `listGrants.getSharedWithMe`. The endpoint
uses the authenticated account's accepted grants, excludes missing resources and
owned resources, and returns an explicit projection: resource ID/title/kind, own
role, consented owner display name (or “Owner”), public status and acceptance time.
It returns no recipient emails, roster, invitation locator or resource body. Lists
and notes appear after acceptance without bookmarks. Role changes, revocation,
leave, publication and resource deletion update this subscription. The shared read
authorization predicate also hides resources immediately when owner deletion starts,
before asynchronous cleanup removes the rows.

Recipients open lists or notes from this page, review their role and owner, and
confirm Leave. Failure keeps the entry and permits retry. Leave uses the existing
account-bound `leaveList` operation: it neither deletes owner data nor other grants,
and invitation replay cannot restore it. Public reading may remain. Resource pages
link to this access view. Note editors can edit content; only owners see sharing,
rename, category and delete controls. Delete warns that everyone loses access.
Sharing and discovery explain that independent copies/exports cannot be recalled
and do not inherit recipients or publication settings. Copy/signing internals are
unchanged; current note-copy and attachment-copy restrictions still apply.

## Invitation continuation and native configuration

Email uses the existing HTTPS `/invitations/:id/:version` URL. Web visitors sign in
in place and explicitly accept; revoked/expired/unavailable links disclose no
resource details and point to Shared with me or a new owner invitation. Capacitor
handles warm and cold launch URLs, preserving path/query/fragment for continuation.
The native listener lifecycle is independent of router navigation; the cold launch
is consumed once, and aborted/unmounted setups remove their listeners.
Malformed URLs and origins other than `https://boop.ad` are ignored.

The Apple association adds invitation paths for the existing app identifier;
iOS build configurations now reference an associated-domains entitlement. Android
registers verified HTTPS invitation intents. **Android's checked-in assetlinks.json
still contains a placeholder release-certificate fingerprint.** A release operator
must supply the actual signing fingerprint and deploy the association to establish
verified Android App Links. This task does not change production association files,
provisioning, signing credentials, or deploy anything. Until native association is
verified, the HTTPS link supports the normal web sign-in/acceptance fallback.

## Verification and remaining acceptance gaps

Local handler tests cover list/note acceptance-to-discovery, privacy projection,
missing resources, current role/public status and leave/replay without deleting
owner data or other grants. Existing invitation tests exercise owner, viewer,
editor, pending, expired, revoked and delivery-failure states. Mounted React tests
cover discovery roles/routes, loading/empty states, confirmation, failure/retry,
reactive removal, publication separation and the reused owner controls. Native
routing tests use a mocked Capacitor bridge, including cold launch and web fallback.

An isolated browser fixture mounts production discovery and owner controls with
mock transport. Desktop and 390px mobile checks exercised leave/removal, found no
page errors or horizontal overflow, and captured screenshots. T3 preview status
and open were attempted; navigation reported no automation host, so the permitted
headless Playwright fallback was used. No live Convex, OTP, email or data was used.

App/backend/E2E TypeScript and a direct Vite build passed without codegen. Full
bun tests passed after retrying initial ENOSPC failures. Focused ESLint passed.
The coordinator owns the baseline OfflineAccessMonitor crash fix and full-app E2E
fixture repairs; these files were not modified here. Native device builds, signed
universal/App Link installation, real OTP/mail delivery, Convex subscription timing
and concurrent transaction behavior remain unverified integration requirements.
