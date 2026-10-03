# Deployment Runbook

Checklist-format runbook for deploying and rolling back the boop stack.

**Stack:** React 19 frontend on Railway, Convex backend (cloud-hosted).

---

## 1. Deploy Frontend (Railway)

Railway auto-deploys from `main`. No manual steps needed for normal pushes.

**To trigger manually:**
- [ ] Open [Railway dashboard](https://railway.app) → project → service
- [ ] Click **Deploy** → **Deploy latest commit** (or push to `main`)

**Build command (auto-detected by Railway):**
```
bun install && bun run build
```

**Start command without hosted Sites:**
```
bunx serve dist -s -l $PORT
```

**Start command with hosted Sites:**
```
bun server.ts
```

---

## 2. Deploy Convex Backend

Run from the repo root (`app/`):

- [ ] Ensure `CONVEX_DEPLOY_KEY` is set in environment
- [ ] Run:
  ```
  npx convex deploy --prod
  ```
- [ ] Confirm output shows `Deployed Convex functions` with no errors
- [ ] Check [Convex dashboard](https://dashboard.convex.dev) → Functions tab for any runtime errors

**CI deploy:** The `CONVEX_DEPLOY_KEY` env var must be set in Railway (or CI secrets) for automated deploys.

---

## 3. Rollback Frontend (Railway)

- [ ] Open Railway dashboard → service → **Deployments** tab
- [ ] Find the last working deployment
- [ ] Click **⋯** → **Redeploy** on that deployment
- [ ] Wait for green status indicator

---

## 4. Rollback Convex

Convex does not have a one-click rollback. Deploy from the previous commit:

- [ ] `git checkout <previous-commit-sha>`
- [ ] `npx convex deploy --prod`
- [ ] `git checkout main` (or your current branch)

**Alternative:** Use the Convex dashboard to inspect function history and identify the last stable version.

---

## 5. Environment Variables

### Railway (Frontend — set in Railway service variables)

These are injected at build time as `import.meta.env.*`.

| Variable | Required | Description |
|---|---|---|
| `VITE_CONVEX_URL` | ✅ | Convex deployment URL (e.g. `https://effervescent-jay-955.convex.cloud`) |
| `VITE_CONVEX_HTTP_URL` | ✅ | Convex HTTP actions URL (e.g. `https://effervescent-jay-955.convex.site`) |
| `VITE_WEBVH_DOMAIN` | ✅ | Domain used for did:webvh identity creation (e.g. `boop.ad`) |
| `VITE_SITE_BASE_DOMAIN` | ⚪ | Base domain for generated hosted-site links. Defaults to `VITE_WEBVH_DOMAIN`/`boop.ad` in server code. |
| `VITE_CUSTOM_DOMAIN_CNAME_TARGET` | ⚪ | DNS target shown in the custom domain wizard, e.g. `sites.boop.ad`. |
| `VITE_TURNKEY_AUTH_PROXY_CONFIG_ID` | ✅ | Turnkey auth proxy config ID (from Turnkey dashboard) |
| `VITE_TURNKEY_ORGANIZATION_ID` | ✅ | Turnkey organization ID |
| `VITE_STRIPE_PRO_MONTHLY_PRICE_ID` | ✅ | Stripe price ID for Pro monthly plan |
| `VITE_STRIPE_PRO_YEARLY_PRICE_ID` | ✅ | Stripe price ID for Pro yearly plan |
| `VITE_STRIPE_TEAM_PRICE_ID` | ✅ | Stripe price ID for Team plan |
| `VITE_VAPID_PUBLIC_KEY` | ⚪ | VAPID public key for web push notifications |
| `VITE_POSTHOG_KEY` | ⚪ | PostHog analytics project API key (analytics disabled if unset) |
| `VITE_POSTHOG_HOST` | ⚪ | PostHog ingest host (default: `https://us.i.posthog.com`) |
| `VITE_SENTRY_DSN` | ⚪ | Sentry DSN for error monitoring (disabled if unset) |
| `SENTRY_AUTH_TOKEN` | ⚪ | Sentry auth token for source map upload (build-time only) |
| `SENTRY_ORG` | ⚪ | Sentry org slug (build-time only) |
| `SENTRY_PROJECT` | ⚪ | Sentry project slug (build-time only) |

### Convex (set in Convex dashboard → Settings → Environment Variables)

| Variable | Required | Description |
|---|---|---|
| `WEBVH_DOMAIN` | ✅ | Server-side domain for DID creation — must match `VITE_WEBVH_DOMAIN` |
| `TURNKEY_API_PUBLIC_KEY` | ✅ | Turnkey API public key |
| `TURNKEY_API_PRIVATE_KEY` | ✅ | Turnkey API private key |
| `TURNKEY_ORGANIZATION_ID` | ✅ | Turnkey organization ID |
| `JWT_SECRET` | ✅ | Secret used to sign session JWTs — keep long and random |
| `STRIPE_SECRET_KEY` | ✅ | Stripe secret API key (`sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Stripe webhook signing secret (`whsec_...`) — get from Stripe dashboard → Webhooks |
| `STRIPE_TEAM_PRICE_ID` | ✅ | Stripe price ID for Team plan (server-side validation) |
| `RESEND_API_KEY` | ✅ | Resend email API key for OTP delivery |
| `VAPID_PUBLIC_KEY` | ⚪ | VAPID public key for web push (must match `VITE_VAPID_PUBLIC_KEY`) |
| `VAPID_PRIVATE_KEY` | ⚪ | VAPID private key for web push |
| `APNS_BUNDLE_ID` | ⚪ | Apple push notification bundle ID (for iOS push) |
| `APNS_KEY_ID` | ⚪ | Apple push notification key ID |
| `APNS_PRIVATE_KEY` | ⚪ | Apple push notification private key (PEM string) |
| `APNS_TEAM_ID` | ⚪ | Apple developer team ID |
| `SIMULATE_BITCOIN_ANCHOR` | ⚪ | Set `"true"` to skip real Bitcoin anchoring in staging/dev |
| `SITE_BASE_DOMAIN` | ⚪ | Server-side base domain for site creation. Defaults to `WEBVH_DOMAIN` or `boop.ad`. |
| `SITE_KEY_ENCRYPTION_SECRET` | ✅ for Sites | Long random secret used to encrypt custodial site private keys at rest. Rotating this needs a key migration plan. |

### Railway runtime variables for hosted Sites

These are read by `server.ts`, which replaces static `serve dist -s` when Sites host routing is enabled.

| Variable | Required | Description |
|---|---|---|
| `APP_HOSTNAMES` | ✅ | Comma-separated app hostnames that should serve the React app, e.g. `boop.ad,www.boop.ad`. Other hostnames are treated as hosted sites. |
| `CONVEX_HTTP_URL` | ✅ | Convex HTTP actions URL used to resolve hosted-site hostnames. Can match `VITE_CONVEX_HTTP_URL`. |

### Cloudflare for SaaS setup

Cloudflare for SaaS is now wired through `convex/cloudflare.ts` + `convex/siteActions.ts`. To enable in production:

1. **Enable Cloudflare for SaaS on the `boop.ad` zone.** Cloudflare dashboard → boop.ad → SSL/TLS → Custom Hostnames. The product is available on every Cloudflare plan including Free; the first 100 hostnames are included, then $0.10/hostname/month up to 50,000.

2. **Set the fallback origin to `boop.ad`.** In the Custom Hostnames settings, set "Fallback Origin" to `boop.ad`. Customer-domain traffic flows: customer → CF edge (TLS terminated with the per-hostname cert) → CF proxies to `boop.ad` (the existing Railway domain) with the original Host header preserved → `server.ts` Host-header-routes to `serveHostedSite()`.

3. **Generate an API token.** Cloudflare dashboard → My Profile → API Tokens → Create Custom Token. The token only needs one permission, scoped to the `boop.ad` zone:
   - `Zone:SSL and Certificates:Edit`

   The Custom Hostnames API endpoints are gated by this scope — there is no separate "Custom Hostnames" permission. `Zone:Zone:Read` is auto-included by Cloudflare when you save a zone-scoped token.

4. **Set Convex env vars.**
   ```bash
   npx convex env set CLOUDFLARE_API_TOKEN "<token>"
   npx convex env set CLOUDFLARE_ZONE_ID "<zone-id>"
   ```
   The zone ID is shown on the boop.ad zone overview page in the Cloudflare dashboard, right side panel.

5. **Confirm `VITE_CUSTOM_DOMAIN_CNAME_TARGET` is set.** This is what the modal shows users as the CNAME target. Should be `boop.ad`. Set in Railway service env.

The 60-second `pollPendingCustomHostnames` cron picks up new hostnames and walks them from `pending_dns` → `pending_ssl` → `active`, then triggers the WebVH migration automatically.

### CI/CD (GitHub Actions / Railway build)

| Variable | Required | Description |
|---|---|---|
| `CONVEX_DEPLOY_KEY` | ✅ | Convex production deploy key (`prod:...`) — from Convex dashboard → Settings → Deploy keys |

---

## 6. Post-Deploy Verification

- [ ] Open `https://boop.ad` — landing page loads
- [ ] Sign in with OTP — auth flow completes
- [ ] Create a list, add items — real-time sync works
- [ ] Open Convex dashboard → **Logs** — no error spikes
- [ ] Check Sentry — no new error spike in last 5 minutes
- [ ] Check PostHog → Live events — events flowing
- [ ] Stripe test: initiate a Pro subscription checkout — Stripe checkout page opens
- [ ] Open `/health` if health endpoint exists — returns 200

**If errors spike after deploy:** roll back immediately (see sections 3–4), then debug in staging.
