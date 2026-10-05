# Private-sharing verification evidence (#262)

This is bounded local evidence for parent #255, not a release attestation or full
closure of #262. Baseline: `888a980c754030be1c3350955c3211e0e6e79423`.
The verification change adds tests and documentation only. No production handlers, rollout policy,
build gates, live data, deployments or signing configuration were changed.

## Contract and authorization matrix

Lists and notes share the list authorization boundary. A private link alone never
grants access. Accepted access belongs to the authenticated account, not to whoever
later receives the invitation URL. API keys intersect that account's current
permissions with each operation's scope; wildcard scope never grants ownership.

| Actor/state | Private reads, titles and attachments | Content writes | Rename/delete/publish/access management |
| --- | --- | --- | --- |
| Owner | Yes | Yes | Yes |
| Accepted editor | Yes | Yes; note saves require the current base | No |
| Accepted viewer | Yes | No | No |
| Pending recipient / wrong account / outsider | No | No | No |
| Anonymous | No | No | No |
| Revoked / left recipient | No future private access | No; denied queues cannot replay | No |
| Editor downgraded to viewer | Reads retained | Writes denied | No |
| Public reader | Published list reads remain available | Explicit editor/owner authority still required | Owner only |
| API key | Matching account permission plus read scope | Matching account permission plus write scope | Ownership plus management scope; invitation acceptance requires a verified session |

`private-sharing.test.mjs` executes direct, internal, HTTP and legacy public-link
handlers for these roles, including notes, items, comments, tags, presence,
assignments, anchors, owner roster, copying and notifications. Public publication
and accepted grants remain independent: unpublishing removes public access without
removing private grants; revocation alone does not hide intentionally public data.

## Current executable evidence

Paths below are relative to `scripts/`. The first nine suites were executed together
for this assignment. UI suites listed separately are existing coverage references,
not newly claimed browser/device results.

| Surface / acceptance requirement | Executable evidence | Limit |
| --- | --- | --- |
| Roles, resource and cross-resource identifiers, scopes, legacy direct requests | `private-sharing.test.mjs`, `auth-boundary.test.mjs`; new `private-sharing-verification.test.mjs` substitutes a grant from another resource owned by the same owner and requires no mutation | Handlers run with signed JWTs/hashed keys against an in-memory DB; no Convex validator/OCC proof |
| Titles, list discovery, previews, denied responses | New suite compares full HTTP status/body/headers for private vs missing list IDs, private attachment existence vs missing IDs/keys; tests API discovery scope and removal of revoked titles despite stale bookmarks | No timing side-channel claim; discovery is list index/Shared with me, not an independently deployed search service |
| Invitation preview/inbox/mail privacy for lists and notes | New suite asserts exact preview and mail-payload projections before acceptance; explicit acceptance reveals title/kind; revocation removes discovery/read access | Mail payload seam is checked; actual mail delivery is not |
| Wrong email/forwarding, expiry/revoke/resend/replay, current role, account binding | `invitations.test.mjs` exercises verified signed email, seven-day expiry, old versions, deletion and leave/reinvite | Sequential retry/idempotency tests do not establish concurrent Convex transaction behavior |
| Delivery failures and abuse controls without a paywall or recipient cap | `invitations.test.mjs`: generic mail/provider idempotency, failure visibility/obsolete jobs, owner/recipient budgets, recipient daily budget across owners | Stubbed provider; real transport/rate-limit contention still needs observation |
| Revocation, downgraded writes, old broker URL, substituted attachment keys/scopes | `revocation.test.mjs`: exact pre-revocation broker locator, permission recheck during storage I/O, leave/delete, public/unpublish, client credential destination checks; new suite confirms no storage read on denied existence probes | Stubbed bytes; does not invalidate old presigned storage URLs |
| Notifications | New suite executes real scheduled list/per-user push actions with only the web-push transport stubbed; positive owner/editor/viewer delivery, no pending/outsider delivery, and no revoked delivery despite bookmarks | Revocation after token lookup can still race external delivery; APNs/Web Push/Android device delivery not proven |
| Offline caches/queues/recovery | `revocation.test.mjs`, `sync-auth.test.mjs`: unopened caches, stale writers, downgrade, account separation, denied dependency chains, regrant, ambiguous legacy queues | Fake IndexedDB, no device networking or live subscriptions |
| Public read and old-client behavior | `private-sharing.test.mjs`, `shared-list-auth.test.mjs`: public read preserved, no implicit public edit, unpublish, session-bearing writes, 401/403 rollback | Old deployed versions and installed-client inventory remain unverified |
| Stale note saves | `note-concurrency.test.mjs`: competing saved bases, empty initialization, omitted legacy bases, current authority and API scopes | Sequential handler execution; live OCC and device draft downloads remain unverified |
| Authentication rollout record checker | `authentication-cutover.test.mjs` tests the optional checker | Historical test names mention production blocking; they do not prove builds/deployments invoke it |

Existing complementary UI/client suites: `invitations-ui.test.mjs`,
`shared-with-me-ui.test.mjs`, `invitation-destination.test.mjs`,
`sharing-publication-ui.test.mjs`, `note-sharing-controls.test.mjs`,
`note-view-recovery.test.mjs`, `item-note-recovery.test.mjs`. Mounted components and
mocked Capacitor events are useful regression coverage, not installed native or
live browser/server evidence.

## Product privacy limits to retain in sharing copy

- Invitations default to viewer, expire after seven days, and require explicit
  acceptance by the matching verified email. Resend supersedes the old version;
  acceptance replay cannot restore revoked/left access. Editors change contents;
  only the owner manages access and resource settings. Recipients see their own
  role; only the owner sees the complete roster.
- Invitation mail identifies the inviter by an explicitly chosen eligible public
  name, omitting resource title/body/attachments and inviter email. Pending inbox
  and preview contain no resource metadata. A provider's `sent` result means
  provider acceptance, not delivery/read confirmation.
- Personal copies/exports are independent and cannot be recalled. List copies
  inherit neither grants nor publication; current list-copy support rejects
  attachments, and note copying remains unsupported. Do not promise those flows.
- Revocation prevents future private server access. Offline devices cannot receive
  revocation until reconnect; already downloaded/copied/exported content cannot
  be recalled. Ambiguous legacy queued fields without a proven baseline remain
  quarantined, hidden and unexportable rather than falsely claimed erased.
- Private sharing is available to all accounts. Current abuse budgets are 30 sends
  per owner/hour, 3 per owner-recipient/hour, 10 per recipient/day across owners,
  and 120 new request IDs per owner/hour. These are not a paid gate or lifetime
  recipient cap. See [invitation details](private-invitations.md).

## Platform and live evidence still required

| Platform/seam | Exact prerequisite and exercise | Evidence to record |
| --- | --- | --- |
| Web | Designated owner/editor/viewer/outsider accounts in an authorized environment; real login/restore, invitation sign-in continuation/explicit accept, live role/revoke/unpublish, two tabs and offline reconnect | Environment/backend commit, browser/client/worker versions, observed title/preview/cache removal and rejected writes, artifacts |
| iOS | Associated Domains enabled for `ad.boop.app`; compatible `match AppStore ad.boop.app` profile with `com.apple.developer.associated-domains`; signed installed build | Installed version/profile, warm/cold invitation link and sign-in continuation, web fallback, offline recovery, attachment fetch/download, revoke/downgrade |
| Android | Actual release-signing certificate fingerprint replaces the checked-in placeholder in assetlinks through an authorized release; deployed HTTPS association and signed installed build | Verified App Link association, warm/cold continuation and fallback, installed version, offline/attachment/revocation results |
| API/older clients | Inventory active API keys/integrations and supported old browser/native versions; designated test credentials | Read/write/management scope denial, revoked key, legacy assertion-only denial, legacy JWT behavior and required upgrade UX |
| Convex | Authorized staging backend with schema/functions together, operational expiry scheduler; real subscriptions and overlapping acceptance/save transactions | Exactly one accepted grant, no role/revocation resurrection, stale-save rejection, subscription removal and clock/scheduler behavior |
| Mail/push | Authorized provider configuration and designated test mailboxes/tokens | Generic invitation delivery/failure/resend, no title/body/attachment leakage, queued notification recipient filtering; characterize lookup-to-delivery race |
| Storage/proxies | Actual configured S3-compatible bucket, broker origin/CORS and proxy/cache behavior | Credentialed no-store bytes, no redirect, key substitution denial, exact pre-revocation locator rejected after revoke, old signature expiry evidence |

Unsigned iOS simulator and Android debug builds cannot establish release signing or
link association. Fixture route tests cannot establish that an installed app opens
a production link. See [sharing UI prerequisites](private-sharing-ui.md).

## Deployment prerequisites and safe compatibility order

`release/authentication-cutover.json` still has null approval, staging evidence and
supported-version evidence for every client. [Authentication rollout](authentication-rollout.md)
explicitly records removal of automatic build/deployment checks. This document does
not restore that gate or change the release owner's policy. Pending fields are
missing evidence, not a current-code vulnerability or an assertion of failed live
behavior. No launch-readiness claim follows from local tests.

For a separately authorized release, retain this order:

1. Inventory supported/deployed clients and integrations, confirm the authentication
   boundary and reauthentication/update path, and prepare designated staging users.
   Do not retire compatibility operation names based solely on this suite.
2. Deploy compatible schema and secured backend together before matching clients:
   sessions, current grants/invitations, expiry tasks, stale-save protection, and
   attachment broker/URL issuer. Never enable a client flow against an older
   authority implementation or restore asserted-DID/public-edit authorization.
3. Stop every old private storage GET issuer before claiming immediate attachment
   revocation. Legacy signatures were issued for 600 seconds; wait out the last
   actual lifetime across issuers/proxies, or obtain separate authorization for
   storage-side invalidation and verify it. The broker cannot revoke an already
   issued signature. See [revocation cutover](private-revocation.md).
4. Deliver compatible web/worker/native clients and required native associations;
   validate the live matrix above, including stale tabs/old clients and concurrent
   operations. Record actual releases/results and remaining limits.
5. If validation fails, keep private access restricted and repair forward, require
   an update, or provide maintenance behavior. A rollback must retain authorization,
   accepted-grant/publication separation, invitation replay protection and the
   broker boundary; it must not restore broad public editing or private bearer URLs.

These are prerequisites for substantiating security guarantees, not new automated
release gates. No deployment, credential invalidation, signing change or production
validation is authorized or performed by this assignment.

## Local execution record

The following focused checks passed during implementation and independent review:

```sh
node --test scripts/private-sharing-verification.test.mjs
bun test scripts/private-sharing-verification.test.mjs
node --test scripts/private-sharing-verification.test.mjs scripts/private-sharing.test.mjs scripts/invitations.test.mjs scripts/revocation.test.mjs scripts/note-concurrency.test.mjs scripts/auth-boundary.test.mjs scripts/shared-list-auth.test.mjs scripts/sync-auth.test.mjs scripts/authentication-cutover.test.mjs
```

Results: 7/7 new tests under both Node and Bun; 175/175 in the combined focused
Node run. No vulnerability reproduced within these checks. Expected anonymous
HTTP requests log authentication denials. No live services or credentials were
used by the tests; production credential verification runs with a fixture secret.

Separate local static/build checks also passed (no Convex codegen):

```sh
node_modules/.bin/tsc -p tsconfig.app.json --incremental false
node_modules/.bin/tsc -p tsconfig.node.json --incremental false
node_modules/.bin/tsc -p convex/tsconfig.json --noEmit
SENTRY_AUTH_TOKEN= VITE_CONVEX_URL=https://placeholder.convex.cloud node_modules/.bin/vite build --outDir tmp/boop-262-a927-vite
```

The Vite build used an isolated output directory and disabled Sentry uploads;
large-chunk warnings remain. It is not a live-service check.

PR #274 at `5334063` was then validated in an isolated checkout: 664/664 Bun
tests, 116/116 browser tests, and E2E typechecking passed. An initial local unit
run timed out in the existing offline-compaction stress test while browser tests
ran concurrently; a serialized rerun passed without code changes. CI unit tests
and the web build also passed on that revision. See the PR for later CI results.
