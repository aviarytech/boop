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

## Originals SDK compatibility

New lists and notes use `@originals/sdk` 4.0.0 with explicit local Ed25519
signers and version-4 envelopes. The application's `assetDid` field remains
unchanged; the SDK envelope calls this identity `assetId`.

Saved version-1 envelopes from the old prerelease cannot be loaded by the
v4 lifecycle. `originalsLegacy.ts` loads the pinned `@originals/sdk-legacy`
alias only for those archives, preserving their signatures, identities and
existing device keys when verifying or publishing. This intentionally retains
the old SDK for compatibility; do not remove it while those archives remain
in use. No stored histories are rewritten or re-minted by this upgrade.
See the [upstream migration guide](https://github.com/onionoriginals/sdk/blob/main/docs/MIGRATION_4.0.md).

Focused verification:
`bun test scripts/originals.test.mjs scripts/published-version.test.mjs scripts/cel-migration.test.mjs`.

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

Run unit tests with `bun test`. Browser smoke tests use the `e2e` runner
installed for this project (Node 22.12+), with Playwright as its browser engine:

```bash
npx playwright install chromium
bun run test:e2e
```

The runner collects only `tests/**/*.e2e.ts`, starts and stops its own Vite
server on a free local port, and supplies a placeholder Convex URL. The public
landing-page and quickstart tests need no backend, account, or AI API key.
They cover rendered content, the landing-to-docs link, direct docs navigation,
and returning home. `npx e2e list` lists the selected tests without starting a browser.

CI runs this same suite and uploads `.e2e/` reports, logs, and failure artifacts.
The configured AI agent is available for future flows; only tests that use
`agent.*` need `AI_GATEWAY_API_KEY`.

## Domains

- **Production**: https://boop.ad
- **Railway**: https://pooapp-frontend-production.up.railway.app
- **Convex HTTP**: https://pooapp-http.aviarytech.com
