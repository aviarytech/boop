# Plan 001: Agents can authenticate with API keys and read + write boop lists over HTTP

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8d96f80..HEAD -- convex/http.ts convex/itemsHttp.ts convex/listsHttp.ts convex/lib/auth.ts convex/lib/jwt.ts convex/schema.ts convex/auth.ts convex/items.ts convex/lists.ts API.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L (steps 1–4 are M; step 5 is optional and adds S)
- **Risk**: MED (touches the shared HTTP auth path; mitigated by keeping the
  existing JWT path untouched and adding API keys as an alternate resolver)
- **Depends on**: none
- **Category**: direction / feature
- **Planned at**: commit `8d96f80`, 2026-07-08
  (`markdown-editor` tip; identical to `origin/main` for every in-scope
  `convex/*` file — verified. Execute against `origin/main`.)

## Corrections applied after code review

A Macroscope review of the first implementation flagged four issues, all fixed
in a follow-up commit. If you re-run this plan, apply these from the start:

1. **Read authorization (Step 4).** Wrapping `getList` + `getListItems` directly
   is an IDOR — any `items:read` key could read any list by ID. Fixed: the read
   endpoint calls a new authorized query `api.lists.getListWithItemsForViewer`
   (owner-by-DID/legacy or actively-published check via `canUserViewList`),
   returning `null` → 404 when access is denied.
2. **legacyDid (Step 3b).** Dropping `legacyDid` entirely regressed migrated
   users (mutations still authorize via `canUserEditList(..., legacyDid)`).
   Fixed: `resolveActor` carries `legacyDid` on the **JWT path only** and write
   handlers forward it; API keys remain legacy-free (`legacyDid` undefined).
3. **Scope validation (Step 2c).** `createApiKey` trusted caller-supplied
   `scopes`, so a user could mint a `"*"` key. Fixed: `sanitizeScopes()` strips
   `"*"`/unknown scopes before persisting; empty → 400.
4. **CORS (Step 2d).** The OPTIONS routes use `convex/http.ts`'s *own* local
   `getCorsHeaders` (not `lib/httpResponses.ts`) — that one now advertises
   `GET, POST, DELETE, OPTIONS` and `X-API-Key`.

A second review round flagged more:

5. **API-key store must be internal.** `convex/apiKeys.ts` functions were public
   `query`/`mutation` — so any client could call `createKey` directly with an
   arbitrary `ownerDid` (mint a key for any user → account takeover) or probe
   `getByHash`. Fixed: all four are `internalQuery`/`internalMutation`, reached
   only from the JWT-authed HTTP layer via `internal.apiKeys.*`. Same for the new
   `getListWithItemsForViewer` (server-only → `internalQuery`).
A landing pass found two more:

7. **Table name collides with dead Mission Control data.** Deployments still
   hold orphaned rows from the `apiKeys` table removed in `90b6d7b` (old shape:
   `keyPrefix`, rotation fields). Re-defining `apiKeys` fails schema validation
   at `convex deploy`, blocking the whole deploy. Fixed: the new table is
   `agentApiKeys`. The orphaned `apiKeys` rows stay unvalidated (no schema entry)
   and can be dropped separately.
8. **Handlers leaked Convex stack traces.** Every `*Http.ts` catch echoed
   `error.message`, so a mutation authorization throw returned 500 with internal
   file paths and line numbers. Fixed: `handlerErrorResponse()` in
   `lib/httpResponses.ts` maps "not authorized" throws to a clean 403 and
   everything else to a generic 500 (details still logged server-side).

6. **Ownership must use `did`, not the agent DID.** Writes and `createList` used
   `actor.actorDid`, which would own/authorize against the *agent* once Step 5
   lands. Removed `actorDid` from `ResolvedActor`; handlers use `actor.did`
   (owner) for all authorization/ownership. Distinct agent attribution is Step 5
   and must split authz-vs-attribution inside the mutations themselves.

## Why this matters

boop just repositioned around an **agent-first** GTM (see `docs/business-plan.md`
and `src/pages/ApiQuickstart.tsx`, both merged 2026-07-08). The pitch: agents
use the same lists as humans, over an API. The stack already has a live,
JWT-authed REST surface (`/api/lists/*`, `/api/items/*`, `/api/assignees/*`,
`/api/activity/list`) — so agents can technically POST today. But two gaps
stop an agent from actually running unattended:

1. **No durable credential.** The only auth is email-OTP → short-lived JWT
   (`convex/lib/jwt.ts`). An agent can't sit in an email loop. It needs a
   long-lived **API key**.
2. **No way to read the queue.** Every `/api/*` route on `main` is a POST
   mutation. There is no `GET` to *pull* lists/items, so an agent can write but
   can't see what to work on. (The old read endpoints lived in `convex/agentApi.ts`,
   deleted in `90b6d7b "remove mission control"`.)

Closing these two gaps — plus an optional third (attribution) — makes the
already-shipped landing page honest and lets agents genuinely use the current
stack, **without** resurrecting the ~5,900-line Mission Control removal. This is
the minimal, low-risk path to "agents can use boop."

## Current state

**The auth chokepoint every write handler already uses** — this is where API
keys slot in. From `convex/itemsHttp.ts:31-59` (`addItem`, representative of all
handlers in `itemsHttp.ts` and `listsHttp.ts`):

```ts
export const addItem = httpAction(async (ctx, request) => {
  try {
    const auth = await requireAuth(request);                    // JWT verify
    const user = await ctx.runQuery(api.auth.getUserByTurnkeyId, {
      turnkeySubOrgId: auth.turnkeySubOrgId,                     // → user.did
    }) as UserInfo;
    if (!user) return errorResponse(request, "User not found", 404);
    const { listId, name } = (await request.json()) as { listId: string; name: string };
    const itemId = await ctx.runMutation(api.items.addItem, {
      listId: listId as Id<"lists">, name,
      createdByDid: user.did, legacyDid: user.legacyDid, createdAt: Date.now(),
    });
    return jsonResponse(request, { itemId });
  } catch (error) { /* AuthError → 401; else 500 */ }
});
```

- `convex/lib/auth.ts` — `requireAuth(request): Promise<AuthTokenPayload>`
  (throws `AuthError`), `tryAuth`, and the CORS response helpers. **Add the new
  `resolveActor` here.**
- `convex/lib/jwt.ts:92` — `extractTokenFromRequest(request)` reads the
  `Authorization: Bearer …` header, falling back to the `auth_token` cookie.
  The API-key header (`X-API-Key`) is separate and unhandled today.
- `convex/auth.ts:111` — `getUserByTurnkeyId({ turnkeySubOrgId })` query returns
  the `users` row (has `.did`, `.legacyDid`).
- `convex/http.ts` — route table. Routes are registered in pairs: the POST/GET
  handler **and** an `OPTIONS` → `corsHandler`. Example (`convex/http.ts:360-361`):
  ```ts
  http.route({ path: "/api/items/add", method: "POST", handler: addItem });
  http.route({ path: "/api/items/add", method: "OPTIONS", handler: corsHandler });
  ```
  Handlers are imported from `*Http.ts` modules (see `convex/http.ts:10-31`).
- `convex/schema.ts:47-66` — `users` table with indexes `by_did`,
  `by_turnkey_id`, `by_email`, `by_legacy_did`. **Add the new `apiKeys` table
  near here.**
- Read queries to wrap (already exist — do NOT rewrite their logic):
  - `convex/lists.ts:213` — `getUserLists({ userDid, legacyDid?, walletDid? })`.
  - `convex/items.ts:507` — `getListItems({ listId })`.
  - `convex/lists.ts:203` — `getList({ listId })`.
- `convex/items.ts:11` — the item-authorship VC proof is a **placeholder**
  (`proof: JSON.stringify(fullVc)`), not a signature. See Step 0.

**Repo conventions to match:**
- **Pure logic in `src/lib/*.ts`, tested from `scripts/*.test.mjs`.** The test
  esbuild-bundles the `src/lib` module to `tmp/…` and asserts with
  `node:assert/strict`. Exemplar: `scripts/sites.test.mjs` (tests
  `src/lib/sites.ts`) and `scripts/note-editor.test.mjs`. **Follow this exactly.**
- Test runner is `bun test` (config: `bunfig.toml`). There is no `test` npm
  script — invoke `bun test <file>` directly.
- **No legacy threading in new code.** Per project rule: do not add `legacyDid`,
  migration shims, or `walletDid` to any *new* code. The new agent path resolves
  to a single current `did` and passes only that to existing mutations/queries
  (their `legacyDid`/`walletDid` args are optional — omit them). The existing
  JWT handlers keep their current `legacyDid` usage untouched.
- **No browser/E2E tests** (no Playwright/Cypress). Unit tests only.
- Web Crypto (`crypto.subtle.digest`, `crypto.getRandomValues`) is available in
  the Convex runtime — `convex/authInternal.ts` already uses raw Web Crypto.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Regenerate Convex types after adding functions | `npx convex dev --once` | exit 0; `convex/_generated/api.d.ts` updated with new modules |
| Typecheck | `npx tsc -b` | exit 0, no errors |
| Unit test (one file) | `bun test scripts/api-keys.test.mjs` | all assertions pass |
| Unit tests (all) | `bun test` | all pass |
| Lint (changed files only) | `npx eslint convex/apiKeys.ts convex/apiKeysHttp.ts convex/agentReadHttp.ts convex/lib/apiKeyHelpers.ts src/lib/apiKeys.ts` | exit 0 |
| Full build | `bun run build` | exit 0 |

> ⚠️ `bun run build` runs `npx convex codegen 2>/dev/null` which **hides codegen
> failures**. Always run `npx convex dev --once` (no output suppression) after
> adding Convex functions and confirm it exits 0 — otherwise
> `convex/_generated/api.d.ts` silently goes stale and `tsc` fails on
> `api.apiKeys.*`.

## Scope

**In scope** (create unless noted):
- `src/lib/apiKeys.ts` (create) — pure key format/hash/scope helpers.
- `scripts/api-keys.test.mjs` (create) — tests for the above.
- `convex/schema.ts` (modify) — add `apiKeys` table + `items.agentDid` (step 5).
- `convex/apiKeys.ts` (create) — Convex queries/mutations for key CRUD.
- `convex/apiKeysHttp.ts` (create) — JWT-only HTTP handlers to create/list/revoke keys.
- `convex/lib/actor.ts` (create) — `resolveActor()` shared resolver.
- `convex/agentReadHttp.ts` (create) — `GET` list/items handlers.
- `convex/itemsHttp.ts`, `convex/listsHttp.ts` (modify) — swap the inline
  `requireAuth + getUserByTurnkeyId` block for `resolveActor` so writes accept
  API keys too.
- `convex/http.ts` (modify) — register the new routes (+ OPTIONS pairs).
- `API.md` (modify, step 6) — document only endpoints that exist.

**Out of scope** (do NOT touch):
- The full Mission Control surface — mission runs, heartbeats, retries,
  artifacts, memory sync, dashboards, `/api/v1/runs*`, scoped-key rotation.
  Explicitly deferred; not needed for agents to use boop.
- **VC/proof signing.** Do not attempt to make item VCs cryptographically
  signed here (that is a separate follow-up blocked on the DID-signing work).
- The React app UI. No key-management UI in this plan (agents create keys via
  the HTTP endpoint using a JWT). A settings page is a later plan.
- `convex/authInternal.ts`, the OTP/JWT flow — leave the human auth path alone.
- Any `legacyDid`/`walletDid` handling in existing handlers.

## Git workflow

- Branch: `feat/agent-api-keys` off `origin/main`.
- Conventional commits, one per step (repo style, e.g.
  `feat(agent-api): add api key auth resolver`). See `git log --oneline`.
- Do NOT push or open a PR unless the operator asks.

## Steps

### Step 0: Confirm the VC-signing reality (read-only, do not fix)

Before building, verify the provenance claim so nobody over-promises. Read
`convex/items.ts` around line 9–57.

**Verify**: `grep -n "placeholder proof\|JSON.stringify(fullVc)" convex/items.ts`
→ matches exist. This confirms item VCs are **structurally present but
unsigned**. Record this in your final report: "agent writes produce an unsigned
VC placeholder; cryptographic signing is out of scope (separate follow-up)." Do
not change signing behavior. Proceed.

### Step 1: Pure API-key helpers + tests (TDD — write the test first)

Create `src/lib/apiKeys.ts` with **pure, dependency-free** functions:

- `generateApiKey(): string` — returns `pa_live_` + 40 chars of `[A-Za-z0-9]`
  from `crypto.getRandomValues`. (Prefix `pa_live_` is the display convention.)
- `formatKeyPrefix(rawKey: string): string` — first 12 chars (e.g.
  `pa_live_ab12`), for safe display in listings.
- `hashApiKey(rawKey: string): Promise<string>` — lowercase hex SHA-256 via
  `crypto.subtle.digest("SHA-256", …)`. **Only the hash is ever stored.**
- `hasScope(granted: string[], required: string): boolean` — true if `granted`
  includes `required` or the wildcard `"*"`.
- `export const AGENT_SCOPES = ["lists:read", "items:read", "items:write"] as const;`

Write `scripts/api-keys.test.mjs` **first**, modeled structurally on
`scripts/sites.test.mjs` (esbuild-bundle `src/lib/apiKeys.ts` into `tmp/…`,
then assert). Cover: generated key starts with `pa_live_` and is unique across
2 calls; `formatKeyPrefix` length is 12; `hashApiKey` is deterministic, 64 hex
chars, and differs for different inputs; `hasScope(["*"], "items:write")` is
true; `hasScope(["items:read"], "items:write")` is false.

**Verify**: `bun test scripts/api-keys.test.mjs` → all assertions pass.

### Step 2: `apiKeys` schema table + key-management endpoints (JWT-only)

**2a.** In `convex/schema.ts`, add after the `users` table:
```ts
apiKeys: defineTable({
  ownerDid: v.string(),           // resolved once at creation from the JWT user
  keyHash: v.string(),            // SHA-256 hex of the raw key; raw key never stored
  prefix: v.string(),             // display only, e.g. "pa_live_ab12"
  label: v.string(),              // human/agent label, e.g. "CI agent"
  scopes: v.array(v.string()),    // from AGENT_SCOPES
  agentDid: v.optional(v.string()), // distinct agent identity (step 5); omitted otherwise
  createdAt: v.number(),
  revokedAt: v.optional(v.number()),
})
  .index("by_hash", ["keyHash"])
  .index("by_owner", ["ownerDid"]),
```

**2b.** `convex/apiKeys.ts` — Convex functions (all pure DB, no HTTP):
- `getByHash = query({ args: { keyHash: v.string() }, … })` → the row or null
  (via `by_hash`).
- `listForOwner = query({ args: { ownerDid: v.string() }, … })` → active keys
  (revokedAt undefined), **prefix/label/scopes/createdAt only — never keyHash**.
- `createKey = mutation({ args: { ownerDid, keyHash, prefix, label, scopes, agentDid? }, … })`
  → inserts, returns the new `_id`.
- `revokeKey = mutation({ args: { keyId: v.id("apiKeys"), ownerDid: v.string() }, … })`
  → sets `revokedAt = Date.now()` only if the row's `ownerDid` matches (else throw).

**2c.** `convex/apiKeysHttp.ts` — HTTP handlers, **JWT-only** (use the existing
`requireAuth` + `getUserByTurnkeyId` pattern verbatim from `listsHttp.ts:31-40`;
do NOT use `resolveActor` here — you cannot mint keys with a key):
- `POST /api/v1/keys` — body `{ label, scopes? }` (default `scopes = AGENT_SCOPES`).
  Generate the raw key (`generateApiKey`), hash it, call `createKey`, and return
  `{ id, key: <RAW KEY>, prefix }`. **The raw key is returned exactly once, here.**
- `GET /api/v1/keys` — returns `{ keys: listForOwner(...) }`.
- `DELETE /api/v1/keys/:keyId` — parse `keyId` from the path, call `revokeKey`,
  return `{ success: true }`. (Follow the path-param parsing already used for
  routed handlers; if none exists, read `keyId` from a `?keyId=` query param and
  document that in API.md.)

Import `generateApiKey`/`formatKeyPrefix`/`hashApiKey`/`AGENT_SCOPES` from a
Convex-side copy: create `convex/lib/apiKeyHelpers.ts` re-exporting the same
logic (Convex cannot import from `src/`). Keep it byte-for-byte identical to
`src/lib/apiKeys.ts` and add a comment on both: `// keep in sync with the other apiKeys helper`.

**2d.** Wire routes in `convex/http.ts` (each with its `OPTIONS`→`corsHandler`
pair), importing from `./apiKeysHttp`.

**Verify**:
- `npx convex dev --once` → exit 0, `api.apiKeys.*` present in `_generated`.
- `npx tsc -b` → exit 0.

### Step 3: `resolveActor()` and make writes accept API keys

**3a.** Create `convex/lib/actor.ts`:
```ts
export type ResolvedActor = {
  did: string;        // owner DID — authorization identity
  actorDid: string;   // who acted: agentDid if the key carries one, else did (step 5)
  scopes: string[];   // ["*"] for JWT sessions; the key's scopes otherwise
  viaApiKey: boolean;
};

// Resolve an actor from either X-API-Key or the existing JWT/cookie path.
export async function resolveActor(ctx, request): Promise<ResolvedActor> {
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey) {
    const keyHash = await hashApiKey(apiKey);                 // convex/lib/apiKeyHelpers
    const rec = await ctx.runQuery(api.apiKeys.getByHash, { keyHash });
    if (!rec || rec.revokedAt) throw new AuthError("Invalid API key", "INVALID_TOKEN");
    return { did: rec.ownerDid, actorDid: rec.agentDid ?? rec.ownerDid, scopes: rec.scopes, viaApiKey: true };
  }
  const auth = await requireAuth(request);                    // existing JWT path
  const user = await ctx.runQuery(api.auth.getUserByTurnkeyId, { turnkeySubOrgId: auth.turnkeySubOrgId });
  if (!user?.did) throw new AuthError("User not found", "UNAUTHORIZED");
  return { did: user.did, actorDid: user.did, scopes: ["*"], viaApiKey: false };
}

export function requireScope(actor: ResolvedActor, scope: string) {
  if (!hasScope(actor.scopes, scope)) throw new AuthError(`Missing scope: ${scope}`, "UNAUTHORIZED");
}
```
(`AuthError` and `requireAuth` import from `./auth`; `hasScope`/`hashApiKey`
from `./apiKeyHelpers`.)

**3b.** In `convex/itemsHttp.ts` and `convex/listsHttp.ts`, replace the inline
`const auth = await requireAuth(...); const user = await ctx.runQuery(getUserByTurnkeyId, ...)`
block in each handler with:
```ts
const actor = await resolveActor(ctx, request);
requireScope(actor, "items:write");   // or "items:read"/"lists:read" per handler
```
Then replace `createdByDid: user.did` / `checkedByDid: user.did` /
`userDid: user.did` with `actor.actorDid`, and **drop the `legacyDid: user.legacyDid`
argument entirely** (per the no-legacy rule — the mutation arg is optional).
Keep the surrounding `try/catch` (AuthError → 401) unchanged.

Scope per write handler: `add`/`reorder` → `items:write`; `check`/`uncheck`/
`remove` → `items:write`; list `create`/`delete` → treat as `items:write` for
now (no `lists:write` scope in this slice — note it in API.md).

**Verify**: `npx tsc -b` → exit 0. Existing JWT callers still compile and behave
identically (JWT path returns `scopes: ["*"]`, so `requireScope` never rejects
a session).

### Step 4: Read endpoints (pull the queue)

Create `convex/agentReadHttp.ts` with handlers using `resolveActor` +
`requireScope`:
- `GET /api/v1/lists` — `requireScope(actor, "lists:read")`; returns
  `{ lists: await ctx.runQuery(api.lists.getUserLists, { userDid: actor.did }) }`
  (omit `legacyDid`/`walletDid`).
- `GET /api/v1/lists/:listId/items` — `requireScope(actor, "items:read")`;
  parse `listId` from the path; return
  `{ list: await ctx.runQuery(api.lists.getList, { listId }), items: await ctx.runQuery(api.items.getListItems, { listId }) }`.
  If path params aren't supported by the router, accept `?listId=` and document it.

Wire both routes (+ OPTIONS pairs) in `convex/http.ts`.

**Verify**: `npx convex dev --once` → 0; `npx tsc -b` → 0; `bun run build` → 0.

### Step 5 (OPTIONAL — the attribution/"receipts" part; P2)

Only do this if the operator wants agent actions distinguishable from the
owner's (the business-plan "prove who did it — human or AI" claim). It is
self-contained and can be a separate PR.

- `convex/schema.ts`: add `agentDid: v.optional(v.string())` to the `items`
  table definition.
- `convex/items.ts`: add `agentDid: v.optional(v.string())` to the `addItem`,
  `checkItem`, `uncheckItem`, `removeItem` mutation args and persist it on
  writes (store `agentDid` alongside `createdByDid`). Authorization still keys
  off the owner DID; `agentDid` is attribution only.
- Key creation (`POST /api/v1/keys`): accept optional `agentDid` in the body,
  store it on the key. When set, `resolveActor` already surfaces it as
  `actor.actorDid` (step 3a). Pass `agentDid: actor.viaApiKey ? actor.actorDid : undefined`
  into the mutations from the write handlers.

**Verify**: `npx tsc -b` → 0; add a case to `scripts/api-keys.test.mjs` asserting
that a key created with an `agentDid` surfaces it (test the pure helper only —
DB behavior is verified manually per "Manual smoke test" below).

### Step 6: Make the docs honest

Update `API.md` so the documented surface matches what now exists: the API-key
auth mode (`X-API-Key`), the `POST/GET/DELETE /api/v1/keys` endpoints, and the
`GET /api/v1/lists` + `GET /api/v1/lists/:listId/items` read endpoints. **Remove
or mark "not yet available"** any documented endpoint this plan did not build
(the entire "Mission Control REST v1 (P1)" runs/memory/dashboard section — it
does not exist on `main`). Do not touch `src/pages/ApiQuickstart.tsx` in this
plan (UI copy is a separate concern; just note any mismatch in your report).

**Verify**: `grep -n "X-API-Key\|/api/v1/keys\|/api/v1/lists" API.md` → matches.

## Test plan

- **New unit tests** in `scripts/api-keys.test.mjs` (model: `scripts/sites.test.mjs`):
  key prefix, uniqueness, hash determinism/length, scope checks, and (if step 5)
  agentDid passthrough. Run with `bun test scripts/api-keys.test.mjs`.
- **No DB/HTTP integration test framework exists** and browser/E2E is out of
  bounds — so the Convex query/mutation and route behavior is validated by
  **the manual smoke test below**, not automated. State this explicitly in your
  report (do not claim end-to-end coverage that doesn't exist).
- Full suite: `bun test` → all pass, including the new file.

### Manual smoke test (record the output in your report)

Against a dev deployment (`npx convex dev` running), with a valid session JWT
in `$JWT` and the deployment URL in `$URL`:
```bash
# create a key
curl -s -X POST "$URL/api/v1/keys" -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" -d '{"label":"smoke"}'     # → {id, key: pa_live_..., prefix}
KEY=pa_live_...   # from the response
# read the queue with the KEY (no JWT)
curl -s "$URL/api/v1/lists" -H "X-API-Key: $KEY"                 # → {lists:[...]}
# write with the KEY
curl -s -X POST "$URL/api/items/add" -H "X-API-Key: $KEY" \
  -H "Content-Type: application/json" -d '{"listId":"<id>","name":"from agent"}'  # → {itemId}
# revoked key is rejected
curl -s -X DELETE "$URL/api/v1/keys/<id>" -H "Authorization: Bearer $JWT"
curl -s "$URL/api/v1/lists" -H "X-API-Key: $KEY"                 # → 401 Invalid API key
```

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx convex dev --once` exits 0; `convex/_generated/api.d.ts` contains `apiKeys`.
- [ ] `npx tsc -b` exits 0.
- [ ] `bun test` exits 0; `scripts/api-keys.test.mjs` exists and its assertions pass.
- [ ] `bun run build` exits 0.
- [ ] `grep -rn "X-API-Key" convex/lib/actor.ts convex/apiKeysHttp.ts` returns matches.
- [ ] `grep -n "legacyDid" convex/lib/actor.ts convex/agentReadHttp.ts` returns **nothing** (no legacy threading in new code).
- [ ] No raw key is ever persisted: `grep -rn "generateApiKey" convex/` shows it feeding `hashApiKey` before any `db.insert`.
- [ ] Manual smoke test output pasted into the report (create → read-with-key → write-with-key → revoked-key-401).
- [ ] Only in-scope files modified (`git status`).
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report (do not improvise) if:

- The drift check shows any in-scope file changed since `8d96f80` and the
  "Current state" excerpts no longer match the live code.
- `requireAuth`/`getUserByTurnkeyId` no longer have the signatures quoted above
  (the auth model changed).
- `npx convex dev --once` fails with a **bundle-size / `ModulesTooLarge`** error
  (a historical repo hazard, see `IMPLEMENTATION_PLAN.md` warnings). This slice
  adds little code, so it shouldn't — if it does, the cause is pre-existing and
  outside this plan.
- The Convex router turns out not to support `:param` path segments AND there is
  no existing routed handler to copy the pattern from — fall back to query
  params, but flag it.
- Making writes accept API keys would require changing the `items`/`lists`
  **mutation authorization** logic (it should not — authz keys off the DID you
  pass, and you pass the owner's DID). If it does, stop: attribution design
  (step 5) needs a decision first.

## Maintenance notes

- **For the reviewer**: scrutinize (1) that only `hashApiKey(rawKey)` is stored,
  never the raw key; (2) that `resolveActor` leaves the JWT path behaviorally
  identical (sessions get `scopes:["*"]`); (3) that `requireScope` is applied to
  every agent-reachable handler.
- **Two copies of the key helpers** (`src/lib/apiKeys.ts` and
  `convex/lib/apiKeyHelpers.ts`) exist because Convex can't import from `src/`.
  If one changes, change both (both carry a sync comment).
- **Deferred out of this plan, on purpose**: scoped-key rotation/grace periods,
  a key-management UI, `lastUsedAt` tracking (would require a write-on-read
  mutation), rate limiting per key, and the full Mission Control surface (runs,
  memory sync, dashboards). Each is a later plan if the agent GTM gains traction.
- **VC signing** remains a placeholder (Step 0); the "provable who-did-what"
  claim is only as strong as that follow-up. Attribution (step 5) records *which*
  DID acted but does not *sign* the record.
