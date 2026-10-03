# Sites

Sites adds a second product surface to boop: a signed-in user can publish a single HTML file to a memorable `*.boop.ad` URL, then optionally connect their own domain without losing the site's portable identity.

The feature is deliberately separate from collaborative todo lists. Lists remain private or shared app data; Sites are public, host-routed HTML documents with their own `did:webvh` log and hostname lifecycle.

## What users can do

- Open the **Sites** tab from the authenticated boop header.
- Paste HTML or upload a `.html` file to create a hosted page.
- Receive a generated hostname such as `brisk-paper-07.boop.ad`.
- Preview and copy the public site URL from the site detail page.
- Replace the site's HTML file while preserving the same site record, hostname, DID, and SCID.
- Start a custom-domain connection flow that registers and polls Cloudflare Custom Hostnames.

## Why Sites exist

Sites turns boop into a small provenance-aware publishing system. The hosted HTML is useful on its own, but the important identity property is portability: every site receives a portable `did:webvh` identity and stores its DID log, so a future move from a boop subdomain to a custom domain can keep the same SCID-backed provenance chain.

## Architecture

### React app

The authenticated layout includes a top-level switch between **Todos** and **Sites**. The Sites UI lives in:

- `src/pages/Sites.tsx` for creation and the user's site list.
- `src/pages/SiteDetail.tsx` for preview, metadata, replace-HTML, and custom-domain entry points.
- `src/components/sites/ConnectDomainModal.tsx` for DNS and Cloudflare hostname status.

### Convex backend

Sites use their own tables in `convex/schema.ts`:

- `siteFiles` stores storage id, content type, byte size, and SHA-256.
- `sites` stores owner DID, site DID, SCID, primary hostname, and current file.
- `siteHostnames` tracks generated boop subdomains and custom domains.
- `siteDidLogEntries` stores the site's JSONL DID log.
- `siteKeys` stores the site's encrypted Ed25519 key material.

The main server functions are:

- `convex/siteActions.ts` for creating sites, replacing HTML, registering custom hostnames, polling Cloudflare, and migrating verified domains.
- `convex/sites.ts` for owner queries and public hostname resolution.
- `convex/sitesHttp.ts` for the public HTTP lookup consumed by the host router.

### Host router

Railway runs `bun server.ts` instead of a plain static server when hosted Sites are enabled. The router checks the request hostname:

- App hostnames from `APP_HOSTNAMES` serve the React app in `dist`.
- Known site hostnames resolve through Convex and serve the stored HTML.
- `/.well-known/did.jsonl` on a site hostname returns that site's DID log.
- Redirected hostnames issue an HTTPS redirect to their replacement hostname.

## Identity and domain migration

Site creation generates a custodial Ed25519 key, creates a portable WebVH DID, stores the genesis DID log entry, and encrypts the private key with `SITE_KEY_ENCRYPTION_SECRET`.

When a custom hostname becomes active in Cloudflare, the migration flow appends a WebVH update entry for the new domain, marks the custom hostname as primary, and redirects the previous primary hostname. This keeps the public site URL movable while preserving the site's provenance history.

## Configuration

Sites require these runtime settings:

- `SITE_BASE_DOMAIN` or `WEBVH_DOMAIN` for generated boop subdomains.
- `SITE_KEY_ENCRYPTION_SECRET` in Convex for encrypted site keys.
- `APP_HOSTNAMES` in Railway so app traffic is not treated as hosted-site traffic.
- `CONVEX_HTTP_URL` in Railway so `server.ts` can resolve site hostnames.
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` in Convex for custom domains.
- `VITE_CUSTOM_DOMAIN_CNAME_TARGET` so the UI can show DNS setup instructions.

See `docs/deployment-runbook.md` for deployment details and Cloudflare setup.

## Verification

Use these focused checks when changing Sites code:

```bash
node scripts/sites.test.mjs
node scripts/cloudflare.test.mjs
node scripts/webvh-portability-proof.mjs
npx tsc -b
npx vite build
```

`npm run build` also runs the production build path, but its Convex codegen step currently redirects codegen errors to `/dev/null`, so run codegen directly when investigating generated API changes.
