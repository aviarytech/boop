# Boop Sites Overnight Handoff

## Built

- Platform-first design and implementation plan:
  - `docs/superpowers/specs/2026-04-28-boop-sites-design.md`
  - `docs/superpowers/plans/2026-04-28-boop-sites-platform.md`
- DID portability proof:
  - `scripts/webvh-portability-proof.mjs`
  - Creates a portable genesis DID on a boop subdomain.
  - Appends a migration entry to `www.forexample.com`.
  - Verifies same SCID and resolves the two-entry log with `didwebvh-ts`.
  - Important finding: current `didwebvh-ts` migration needs the new DID passed as `controller`; `domain` alone does not move the DID id.
- Pure site helpers:
  - `src/lib/sites.ts`
  - `scripts/sites.test.mjs`
  - Covers hostname formatting, uniqueness retry, HTML validation, and SHA-256.
- Convex backend foundation:
  - site tables in `convex/schema.ts`
  - internal persistence in `convex/siteInternals.ts`
  - portable DID site creation action in `convex/siteActions.ts`
  - owner/public queries in `convex/sites.ts`
  - public host resolve endpoint in `convex/sitesHttp.ts`
  - route wired in `convex/http.ts`
  - custom-domain migration primitive in `convex/siteActions.ts` for already-verified domains; it appends a WebVH migration entry and marks the custom hostname primary.
- Host router:
  - `server.ts`
  - Railway start command changed to `bun server.ts`
  - App hostnames serve the built React app.
  - Non-app hostnames resolve through Convex and serve hosted HTML or `/.well-known/did.jsonl`.
- UI shell:
  - `src/pages/Sites.tsx`
  - `src/pages/SiteDetail.tsx`
  - `src/components/sites/ConnectDomainModal.tsx`
  - top nav in `src/App.tsx`
- Docs/env:
  - `.env.example`
  - `docs/deployment-runbook.md`
  - `src/types/originals-sdk.d.ts` updated to expose WebVH methods already present in the installed SDK.

## Verified

- `node scripts/sites.test.mjs` passes.
- `node scripts/webvh-portability-proof.mjs` passes.
- `npx tsc -b` passes.
- `npx vite build` passes.
- `npm run build` passes, but note that its `npx convex codegen 2>/dev/null` step hides codegen failures.
- `server.ts` smoke test:
  - Started with `PORT=4199 APP_HOSTNAMES=localhost,127.0.0.1 CONVEX_HTTP_URL=http://127.0.0.1:1 bun server.ts`.
  - `curl -I http://127.0.0.1:4199/` returned `HTTP/1.1 200 OK`.

## Known Blockers

- Convex codegen still fails when run directly because existing Turnkey/viem dependencies import non-exported `@noble/hashes` paths such as `@noble/hashes/sha256` instead of `@noble/hashes/sha256.js`.
- Because direct codegen is blocked, `convex/_generated/api.d.ts` was manually refreshed for the new site modules. This should be regenerated normally once the dependency/codegen issue is fixed.
- `npm run lint` fails on many existing repo issues outside the new Sites files. No new Sites files appeared in the lint error list.
- Cloudflare for SaaS is not configured in this repo. The domain wizard is therefore an honest stub.
- Recovery bundle is designed but not implemented yet.
- Third-party DID resolver verification against production URLs still requires deployed DNS/HTTPS.

## Next Best Steps

1. Fix Convex codegen/deploy dependency issue around `@noble/hashes` export paths.
2. Set `SITE_KEY_ENCRYPTION_SECRET`, `SITE_BASE_DOMAIN`, `APP_HOSTNAMES`, and `CONVEX_HTTP_URL` in the relevant environments.
3. Deploy Convex functions and Railway server.
4. Configure Cloudflare wildcard and Custom Hostnames.
5. Wire DNS polling and Cloudflare Custom Hostnames before calling `migrateVerifiedCustomDomain`.
6. Implement recovery bundle with decrypted key, full DID log, HTML, and README.
7. Verify with an actual third-party resolver against `https://<site>/.well-known/did.jsonl`.
