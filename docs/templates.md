# Agent runbook templates

The public catalog at `/templates` contains ten editorial runbooks in `convex/lib/templateCatalog.ts`. Each has a stable slug, use-case copy, expected outcome, six ordered steps, priorities, and explicit agent/human responsibilities. The existing quick-start templates remain available. Personal and community templates remain in the authenticated `/templates/saved` manager; anonymous landing pages only read the source-controlled catalog, never saved-template records.

## Creation and continuation

“Use this template” sends anonymous visitors to `/login?template=<catalog-slug>`. Both the authenticated login redirect and OTP completion resolve that parameter against the runbook allowlist. Unknown IDs, URLs, and arbitrary redirect parameters fall back to `/d`. Successful authentication returns to `/templates/<slug>/use`; the page waits for canonical identity, enters the existing app-lock boundary before attempting creation, then navigates to the created list. Failure remains on the runbook with an explicit retry and plan-limit guidance. Reloading login retains the selection; the continuation never accepts a private template ID.

`templates.createListFromTemplate` accepts exactly one of `builtinId` and `templateId`. Authentication, saved-template access, name validation, and the existing list quota apply before insertion. The list, ownership proof, optional envelope, and every item are inserted in one Convex mutation: an item failure rejects the transaction instead of acknowledging partial success. First-list referral benefits share the same transaction-local helper as ordinary list creation. Creation does not execute the runbook or grant agent access.

Public-page retries retain the minted asset in sessionStorage, keyed by canonical account DID and catalog slug. An in-flight promise deduplicates local genesis. The backend's indexed asset lookup acknowledges only the same owner and `templateSource`; concurrent/repeated requests cannot create duplicate lists, including when the first request filled the quota. Only an acknowledged completed attempt can be replaced by an explicit new use; pending attempts survive a lost response and reload. An `expectedOwnerDid` business argument rejects an account mismatch even if credentials change, and the page checks current identity before sending and navigating. AppLockGuard waits for the lock preference to resolve, fails closed on read errors, and never mounts activation before successful unlock when enabled. Storage failure prevents the request and presents retry rather than risking an unrepeatable write. Clearing browser session storage ends retry continuity.

## Conversion semantics

Existing consent-gated PostHog capture emits:

- `template_viewed`: a mounted public runbook detail page; `template_id` is a catalog slug. Repeated visits count as views.
- `template_use_clicked`: explicit intent to use a runbook, on the public page or authenticated built-in picker/manager. Automatic continuation does not emit another click. Retry clicks count as attempts.
- `template_activated`: the backend has acknowledged a complete preloaded list. Includes `template_id`, `list_id`, and stable `$insert_id = template_activated:<listId>` for PostHog deduplication on response retries. Genesis, authentication, quota, and item insertion failures emit no activation.

Build a per-template PostHog funnel `template_use_clicked → template_activated`, matching `template_id`, with unique users and a seven-day conversion window. A supplementary `template_viewed → template_use_clicked` funnel measures landing-page interest. Activation here means **complete runbook list created**, not first agent activity, signup, task completion, or the weekly collaborative-list north star. Existing PostHog identification connects consented anonymous activity to an authenticated user. No user-written task names/descriptions or private template IDs enter these events. Declined consent, ad blockers, unconfigured analytics, and lost success responses before a retry undercount; this is a product funnel, not an authoritative billing ledger.

## Indexing and serving

Vite emits `/templates/index.html` and one `/templates/<slug>/index.html` for every runbook, with static use-case copy and steps, unique title/description, canonical URL, social metadata, and links. The generated sitemap adds all eleven URLs. `server.ts` serves directory indexes. Static hosts must serve directory indexes before their SPA fallback. Public pages do not require Convex to render their catalog. Metadata updates on client navigation; arbitrary slugs display a not-found page and are absent from the sitemap.

## Release compatibility

The release owner must make the compatible Convex backend available before the new frontend. The previous backend validator rejects `builtinId`, so releasing the frontend first temporarily breaks quick-start creation. Railway and the Convex workflow run independently; they do not enforce this order. Existing saved-template calls remain compatible. No deployment is performed by this change.

The shared catalog lives under `convex/lib/`, within the existing deployment workflow’s `convex/**` filter, so future catalog-only edits update both frontend previews and backend creation data without changing workflow permissions. Coordinate both releases when adding or changing runbooks.

## Verification

- `bun test scripts/templates.test.mjs scripts/template-continuation.test.mjs scripts/template-app-lock.test.mjs`: catalog completeness; all runbook creation handlers; quota; retries; ownership/source mismatch; invalid selection; rejected insert failures. The in-memory handler fixture does not emulate Convex transaction rollback; atomicity relies on Convex's mutation transaction contract.
- `bunx tsc -b`, `bunx tsc -p convex/tsconfig.json --noEmit`, `bun run test:e2e:typecheck`.
- `SENTRY_AUTH_TOKEN='' bunx vite build`: local HTML generation without live Convex codegen or source-map upload.
- `bunx e2e run tests/templates.e2e.ts`: isolated loopback fixture; public gallery, signup continuation, complete population, quota failure/retry, invalid redirect fallback, and lost-response/reload retry at quota. It never provisions a live account or sends an OTP.

Real OTP delivery, deployed Convex transactions, production crawling, and PostHog ingestion require deployment verification by the owner; local checks do not establish those outcomes. Platform builds, Lighthouse, full browser suite, and automated review remain repository delivery gates managed by the coordinator.

Pending referral codes are redeemed and awaited on the unlocked activation route before first-list creation. Invalid/already-redeemed codes follow the existing backend semantics; transport failures retain the code and block creation until retry, rather than silently losing eligibility. The signup browser regression seeds a pending code and asserts redemption precedes the template mutation.

Generated pages carry the original shell metadata in inert JSON. Client metadata reuses one canonical element, updates social fields, and restores the original shell on exit even when the session began on a prerendered template. `scripts/template-seo.test.mjs` exercises generated HTML and detail-to-detail-to-exit metadata transitions.
