# Boop Sites Design

## Goal

Add a second product area, Sites, beside the existing private todo/list app. A signed-in user can paste or upload a single HTML file, get a memorable `*.boop.ad` URL, and later connect a domain they own. Each site has a portable `did:webvh` identity whose SCID survives migration from the boop subdomain to a custom domain.

## Discovery Summary

- The app is Bun + Vite + React with Convex, not Postgres.
- Railway currently runs `bunx serve dist -s -l $PORT`, which cannot route by `Host` header.
- `@originals/sdk` is already installed and includes WebVH helpers through `DIDManager.createDIDWebVH()` and `DIDManager.updateDIDWebVH()`.
- `didwebvh-ts` is already present and exposes `createDID`, `updateDID`, `resolveDID`, and JSONL-compatible DID logs.
- Existing WebVH code exists for users/lists, but current creation uses `portable: false`; sites need `portable: true`.
- No DI-Wings code was found.
- No Cloudflare for SaaS config, env vars, wrangler config, Terraform, or custom hostname integration was found in this repo.
- Existing todo/list flow lives in `src/pages/Home.tsx`, `src/components/CreateListModal.tsx`, `convex/lists.ts`, and `convex/items.ts`; it should stay behaviorally untouched.

## Architecture

Sites are implemented as a hosting subsystem with a parallel Convex-backed product area. The SPA gains `/sites` and `/sites/:siteId` routes behind the existing auth guard, plus a small top-level nav with `Todos` and `Sites`.

Railway should run a small Bun server instead of static `serve dist -s`. The server has two responsibilities:

1. Serve the built React app from `dist` for app hostnames such as `boop.ad`.
2. Inspect the `Host` header for hosted site hostnames, look up the hostname through Convex HTTP endpoints, and serve the hosted HTML or DID log.

This avoids introducing a separate service while preserving the current SPA deployment model.

Long-term, this boundary can move to a Cloudflare Worker without changing the product UI or Convex metadata model. The important part is that host routing is explicit and testable, rather than hidden behind static SPA serving.

## Data Model

Add Convex tables equivalent to the prompt's schema:

- `siteFiles`: HTML bytes stored as UTF-8 text for v1, content type, SHA-256, byte length, created timestamp.
- `sites`: owner DID, SCID, primary hostname id, file id, created timestamp.
- `siteHostnames`: site id, hostname, kind (`boop_sub` or `custom`), status (`pending`, `active`, `redirected`), redirect target, primary flag, created timestamp.
- `siteDidLogEntries`: site id, version id, entry JSONL line, signed timestamp.
- `siteKeys`: site id, key type, public key multibase, encrypted private key, created timestamp.

Convex table names avoid collisions with existing list publication tables.

## Site Creation Flow

The `/sites` page accepts pasted HTML or one `.html` file. On submit:

1. Validate that the payload is non-empty HTML and within a v1 size limit.
2. Generate a memorable subdomain in the form `{adjective}-{noun}-{2digits}.boop.ad`.
3. Check uniqueness against `siteHostnames`.
4. Generate a custodial Ed25519 keypair server-side.
5. Encrypt the private key with a per-environment `SITE_KEY_ENCRYPTION_SECRET`.
6. Use existing WebVH helpers to create a portable genesis log for the boop subdomain.
7. Persist the site, file, hostname, encrypted key, SCID, and DID log entry.
8. Return the site id and public URL to the client.

The success/detail page shows the link, copy action, iframe preview, custom domain CTA, and a collapsed "your identity" disclosure.

## Host Serving

The Bun server handles hosted-site requests:

- `GET /` on a known active site hostname serves the stored HTML.
- `GET /.well-known/did.jsonl` serves the site's DID log as JSON Lines.
- Unknown hostnames receive a friendly 404 page.
- If a boop subdomain is marked `redirected`, it redirects permanently or temporarily to the primary custom domain depending on stored config.

Hosted HTML responses use:

`Cache-Control: public, max-age=300, s-maxage=86400`

## Custom Domain Flow

The domain wizard is modal-based:

1. Ask for "the domain you own".
2. Show CNAME instructions to a configured target hostname, e.g. `sites.boop.ad`.
3. Poll DNS via a Convex HTTP endpoint or server endpoint.
4. Register the custom hostname through a Cloudflare client interface.
5. Append a portable WebVH update entry using the site's custodial key and the new domain.
6. Mark the custom hostname active and primary; mark the boop subdomain as redirected.

Cloudflare for SaaS is stubbed for v1 because this repo has no detectable setup. The stub should return a clear "not configured" state unless env vars are provided. Apex domains should default to a `www.` primary-domain path with copy explaining apex redirects, because non-Enterprise apex support is not confirmed.

## DID Portability Proof

The integration proof lives in `scripts/webvh-portability-proof.mjs`. It validates the core promise locally:

- create a portable genesis log on `brisk-paper-07.boop.ad`
- append a migration entry to `www.forexample.com`
- keep the same SCID
- resolve the two-entry log with `didwebvh-ts`

One important implementation detail: `didwebvh-ts` `updateDID` needs the new DID passed as `controller` during domain migration. Passing `domain` alone does not update the DID id in the current library behavior.

## Recovery Bundle

Add `/api/sites/:id/recovery-bundle` or a Convex-backed equivalent that returns a zip containing:

- full DID log
- public key
- decrypted private key
- hosted HTML
- a short README explaining how to host the DID log elsewhere

This is intentionally custodial for v1 but preserves the "you can leave anytime" promise.

## Testing

Add focused tests for pure helpers first:

- memorable hostname format and uniqueness retry behavior
- HTML validation and SHA-256 calculation
- DID log JSONL serialization for site logs
- host routing decisions for app host vs site host vs unknown host

Then run TypeScript build and lint where possible. Full acceptance criteria involving Cloudflare, DNS propagation, HTTPS, and a third-party resolver require production-like infrastructure and cannot be fully verified locally.
