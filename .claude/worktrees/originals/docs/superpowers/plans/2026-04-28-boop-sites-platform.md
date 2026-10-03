# Boop Sites Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the durable hosting and portable-identity substrate required for boop Sites, then layer the product UI on top.

**Architecture:** Treat Sites as a hosting subsystem, not just a React page. The system has four boundaries: hosted-origin routing, site storage/metadata, portable `did:webvh` identity, and custom-domain provisioning.

**Tech Stack:** Bun, Vite, React 19, React Router, Convex, `didwebvh-ts`, `@originals/sdk`, Cloudflare for SaaS API, Web Crypto/Node Crypto.

---

## Track 1: Prove DID Portability

**Files:**
- Create: `scripts/webvh-portability-proof.mjs`

- [x] Create portable genesis on `brisk-paper-07.boop.ad`.
- [x] Append migration entry to `www.forexample.com`.
- [x] Verify the SCID is unchanged.
- [x] Resolve from the migrated log using `didwebvh-ts`.
- [x] Capture integration detail: `updateDID` needs explicit `controller` for domain migration.

## Track 2: Pure Hosting Helpers

**Files:**
- Create: `src/lib/sites.ts`
- Create: `scripts/sites.test.mjs`

- [x] Test hostname generation and uniqueness retry behavior.
- [x] Test HTML validation.
- [x] Test SHA-256 hashing.
- [x] Implement helpers.

## Track 3: Convex Site Backend

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/siteInternals.ts`
- Create: `convex/siteActions.ts`
- Create: `convex/sites.ts`

- [ ] Add `siteFiles`, `sites`, `siteHostnames`, `siteDidLogEntries`, and `siteKeys`.
- [ ] Add a Node action for site creation: validate HTML, generate key, encrypt private key, create portable DID genesis, and persist rows through an internal mutation.
- [ ] Add owner-scoped list/detail queries.
- [ ] Add domain wizard mutations as explicit stubs that document Cloudflare requirements.

## Track 4: Host Routing

**Files:**
- Create: `convex/sitesHttp.ts`
- Modify: `convex/http.ts`
- Create: `server.ts`
- Modify: `railway.json`
- Modify: `package.json`

- [ ] Add Convex HTTP endpoints for host lookup, HTML content, DID log, and recovery bundle.
- [ ] Add Bun host router that serves app hostnames from `dist`.
- [ ] Route non-app hostnames by `Host` header through Convex.
- [ ] Serve `/`, `/.well-known/did.jsonl`, redirects, and friendly unknown-site 404s.

## Track 5: Product UI

**Files:**
- Create: `src/pages/Sites.tsx`
- Create: `src/pages/SiteDetail.tsx`
- Create: `src/components/sites/ConnectDomainModal.tsx`
- Modify: `src/App.tsx`

- [ ] Add `Todos` / `Sites` nav without changing the existing todo page internals.
- [ ] Build paste/file flow.
- [ ] Build detail page with link copy, iframe preview, identity disclosure, and domain CTA.
- [ ] Build custom-domain wizard shell with honest stub states.

## Track 6: Cloudflare And Production Verification

**Files:**
- Create: `src/lib/cloudflareForSaas.ts` or server-side equivalent
- Modify: `.env.example`
- Modify: `docs/deployment-runbook.md`

- [ ] Document required Cloudflare zone setup.
- [ ] Add client interface for custom hostname registration.
- [ ] Keep implementation stubbed until credentials/config are present.
- [ ] Document apex-domain policy: default to `www.` plus registrar apex redirect instructions.
- [ ] Verify against a third-party resolver after deployment.

## Morning Handoff Checklist

- [ ] `node scripts/sites.test.mjs`
- [ ] `node scripts/webvh-portability-proof.mjs`
- [ ] `bun run build`
- [ ] `bun run lint`
- [ ] Document blockers clearly: Cloudflare config, production DNS, third-party resolver verification.
