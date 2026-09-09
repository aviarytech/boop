# Authenticated operations rollout

This change is under review in PR #241; Railway has built a PR preview. Production cutover remains unapproved. Do not retire compatibility names or deploy the authorization cutover until the deployed-client inventory below is confirmed. Merely retaining a function name does not make an old unauthenticated client compatible.

## Client evidence required

| Client | Evidence in this checkout | Deployed evidence still required |
|---|---|---|
| Browser | package version 1.0.0; this branch adds the session adapter | Railway release commit, cached service-worker versions, and confirmation that authenticated direct calls are in use |
| iOS | marketing version 1.0, build 3 | App Store/TestFlight versions, supported installed versions, and minimum-version/update policy |
| Android | versionName 1.0, versionCode 1 | Play/internal-track releases, supported installed versions, and minimum-version/update policy |
| HTTP/agents | JWT and X-API-Key adapters retained | Active integrations and confirmation whether any bypass HTTP and call Convex directly |

Local version strings are not evidence of deployed or active versions. No release inventory or production verification was available in this task. The release owner must record confirmation before production deployment. Unauthenticated direct callers must upgrade; there is no safe fallback that accepts an asserted identity.

## Boundary and compatibility

- Browser/Capacitor establish the existing signed JWT with `actorSession.establish` before subscribing. Reactive calls carry `authToken`; HTTP calls continue using Bearer/cookie JWT or X-API-Key. HTTP registers valid pre-rollout JWTs automatically.
- `accessSessions` stores only token hashes, subjects, expiry and revocation. Scheduled expiry, a bounded indexed cleanup sweep, and logout change database state, invalidating private query caches. A revoked token cannot establish another session. Existing verified account records and legacy DID associations remain intact.
- Every protected operation resolves current/legacy identity from server records. Each operation declares its resources and required scope. Internal HTTP registrations use the same authenticated boundary and recheck key revocation in the data transaction.
- Public operation names remain, with optional legacy assertion fields accepted only when matching the authenticated account. These fields confer no authority. Shared business handlers receive authenticated context and declared business arguments only.
- OTP/session storage helpers retain rejecting public compatibility names; the verified login HTTP flow uses internal registrations. The public account lookup is limited to the signed-in account. New identity links cannot be established by asserting another current or legacy DID.
- Public list/resource reads require an active publication. Published lists remain readable without login; editing requires a logged-in human or an appropriately scoped agent. Bookmarks stop exposing a list when it is unpublished.
- Site uploads now bind pending object keys to the authenticated account. Finish or restart any pre-cutover pending site uploads; existing stored site files remain readable through authenticated ownership checks. Attachment and site upload references reject path traversal.
- The generated browser operation registry uses typed Convex references. After adding/renaming an authenticated operation, run `node scripts/generate-auth-client.mjs`; verify with `--check`.

## Coordinated rollout

1. Confirm the inventory above, including old mobile builds and stale browser tabs. Choose the supported client floor and user update/reauthentication messaging.
2. In staging, deploy the schema/functions together, then the matching browser/native clients. Verify scheduling is operational for session expiry. A frontend deployed against the previous backend will not find `actorSession.establish`; an old frontend against the secured backend cannot make unauthenticated direct calls. Coordinate the cutover or enforce an update window.
3. Validate OTP login/new-account DID setup, session restore, logout/expired-session invalidation, private list reads, shared edit/unpublish, attachment upload/read/removal, publishing and migrated accounts on web/iOS/Android. Test old valid JWT HTTP clients and current/legacy-owner API keys, then revoke keys and test insufficient scopes. Use designated test accounts and lists.
4. Approve the production cutover only after those checks and version confirmation. Remove old public names/assertion validators only in a later release after usage and supported versions demonstrate they are unused.

## Enforced production gate

`release/authentication-cutover.json` is the durable approval record. It is intentionally pending: fill in the deployed/supported versions and evidence for browser, iOS, Android and integrations, link the staging results, and have the named release owner record approval and its date in a reviewed commit. Evidence must identify actual releases and exercised behavior; source version strings alone are insufficient. If a platform has no supported deployments, record the inventory evidence establishing that fact.

The Convex production workflow runs `scripts/check-authentication-cutover.mjs` before dependencies or deployment secrets are used. Railway's configured build runs the same check before the production frontend build. Missing or unknown environment names require approval; only `boop-pr-<number>`, `staging`, and `development` bypass the production approval check. Railway provides the environment name during builds ([reference variables](https://docs.railway.com/variables/reference)). Local builds remain available for verification.

The record is an auditable release attestation, not proof of who approved it. On 2026-09-09, GitHub reported `main` as unprotected, no repository rulesets, and no `CODEOWNERS` file. Required owner review is therefore not enforced. The repository owner must configure required review/protected release settings before treating this as an owner-only approval mechanism; this task did not change live repository policy.

These guards cover the repository's configured deployment paths; operators must apply the same check before any manual production deploy.

Until the record is approved, merging this PR intentionally blocks every subsequent production Convex deployment, including unrelated hotfixes, and every production Railway build. A later full deployment includes this authentication change even when its latest commit is unrelated, so filtering by the latest changed files would bypass the cutover gate. Complete the inventory and staging approval before merging; if an urgent unrelated hotfix is needed first, ship it before this PR. Use staging/PR previews to collect the required evidence. No production settings or live client inventory were changed by this review fix.

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

Regression tests exercise real signed JWT verification, database-owned identities, handler business behavior and HTTP-to-internal dispatch against in-memory fixtures. React provider tests exercise restore acceptance, rejection cleanup, and logout/login serialization; adapter tests cover token changes and long-session expiry. Convex code generation/type analysis, TypeScript and the application build validate integration statically. The repository lint baseline and any new diagnostics are checked separately. These do not prove live OTP delivery, WebSocket cache invalidation timing, bucket upload completion or deployed native behavior. Those checks remain staging/production release gates above.

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
