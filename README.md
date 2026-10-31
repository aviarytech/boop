# boop

A collaborative list-sharing app with decentralized identifiers (DID) and verifiable credentials (VCs) built using Originals.

## Features Backlog

**The source of truth for features is the app itself:**  
👉 **[https://boop.ad/list/js77strp35s0br8deqf30bvrxh80pm4t](https://boop.ad/user-20ed9d43-2d31-44/resources/list-k172r0frhyxtm5dj6cqx1mh48h81k6wp)**

Check that list for what needs to be built. Mark items done when you ship them.

## Tech Stack

- **Frontend**: React 19 + Vite + TypeScript + TailwindCSS v4
- **Backend**: Convex (realtime DB + HTTP actions)
- **Auth**: Turnkey OTP + JWT (via @originals/auth)
- **Identity**: DIDs (did:webvh + did:key)
- **Credentials**: Verifiable Credentials (via @originals/sdk)
- **Deploy**: Railway (frontend) + Convex Cloud (backend)

## Originals

Each list and note is an Original under `@originals/sdk` 5: a `did:vh` asset
log signed by its owner's `did:webvh`, with the list's state (or a note's body)
as its resource. Entries are signed with the owner's Turnkey assertion key
through their own Turnkey session, never by boop.
Convex is the shared host (`convex/originalsHost.ts`): it appends an entry only
when it extends the accepted head and verifies against the owner's DID history,
so two devices racing get one append and a stale-parent answer, not a fork.

A list gets its Original when its owner first opens it while signed in
(`src/hooks/useListOriginal.ts`); `lists.assetDid` is set then. The signer is
`turnkeyListAuthorSource` (`src/lib/authorIdentity.ts`), installed in
`src/main.tsx`. Originals 5 needs the signing key to be in the owner DID's
`assertionMethod`, to not be one of its update keys, and each verification
method's `controller` to be the DID itself; #286 PR b mints author DIDs that way.

Nothing written under CEL (`did:cel`) is read. A list made before Originals 5
is re-minted from its current state when its owner opens it (a blocking
prompt); its old history is not carried over, and its `listEnvelopes` row is
kept, unread, until that data is dropped.

Local development: SDK 5 accepts an author DID only on a dotted domain, so a
DID minted for plain `localhost` can't sign. Run the app at `localhost` (Turnkey
needs a secure context) but mint DIDs for a dotted name that resolves locally:
`VITE_WEBVH_DOMAIN=lvh.me:5173 npm run dev`, with `WEBVH_DOMAIN=lvh.me:5173` set on
the dev Convex deployment.

Focused verification: `node --test scripts/originals-v5.test.mjs scripts/originals-turnkey-lists.test.mjs`.

## Sites

boop also includes **Sites**, a public publishing surface alongside private and
shared todo lists. Signed-in users can paste or upload a single HTML file,
publish it to a generated `*.boop.ad` hostname, replace the HTML later, and
connect a custom domain while preserving the site's portable `did:webvh`
identity.

See [`docs/sites.md`](docs/sites.md) for the product flow, architecture,
identity model, deployment settings, and focused verification commands.

## Development

```bash
# Install dependencies
bun install

# Run locally (requires .env.local with Convex/Turnkey config)
bun dev

# Deploy frontend to Railway
railway up

# Deploy Convex functions
npx convex deploy
```

## Tests

Run unit tests with `bun test`. Browser tests use the `e2e` runner
installed for this project (Node 22.12+), with Playwright as its browser engine:

```bash
npx playwright install chromium
bun run test:e2e:typecheck
bun run test:e2e
```

The runner collects only `tests/**/*.e2e.ts` and starts and stops its own Vite
server and isolated Convex protocol fixture on free loopback ports. All 113
tests from the deleted Playwright browser suite have been ported, alongside
the three existing public-page tests. They cover auth, lists/items, sharing,
onboarding, offline indicators, settings, accessibility, profile, pricing,
and legal pages. No live backend, account, Stripe key, or AI API key is needed.

`npx e2e list` lists the tests without starting a browser.
`bun run test:e2e tests/items.e2e.ts` runs one file. See
[`docs/e2e-migration.md`](docs/e2e-migration.md) for the legacy coverage map,
fixture design, and what these mocked browser tests do not verify.

CI runs this same suite and uploads `.e2e/` reports, logs, and failure artifacts.
The configured AI agent is available for future flows; only tests that use
`agent.*` need `AI_GATEWAY_API_KEY`.

## Domains

- **Production**: https://boop.ad
- **Railway**: https://pooapp-frontend-production.up.railway.app
- **Convex HTTP**: https://pooapp-http.aviarytech.com
