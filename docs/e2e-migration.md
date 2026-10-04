# Browser-test migration

The old Playwright suite was deleted in `1c61e19` (included in `f335424`,
PR #176). It was recovered from `1c61e19^`, the last version before deletion.
PR #248 proposed the new `e2e` runner; merged PR #250 incorporated that setup
and added three public-page smoke tests. Those three tests did not replace
the older suite.

All **113 tests across 15 files** from the pre-deletion suite now run through
`e2e` in `tests/`, with the existing three public-page tests retained:
**116 browser tests total**. Unit/component tests in `scripts/` and `src/`
remain under Bun.

## Coverage map

Each `e2e/<name>.spec.ts` maps to `tests/<name>.e2e.ts`.

| File | Tests | Coverage / adaptations |
| --- | ---: | --- |
| accessibility | 19 | Accessible names, form labels, dialog roles, Escape, settings switches, keyboard input. Removed the old conditional that could silently bypass delete-dialog assertions. |
| delete-list | 6 | Action menu, confirmation, list name, cancel, delete/navigation. |
| identity | 4 | Login form, protected-route redirect, signed-in redirect, session restoration on reload. Fixtures now acknowledge `actorSession.establish`. |
| items | 5 | Empty state, add, check/uncheck, remove, return home. Backend fixture supports the current replay mutations and receipts. |
| landing | 11 | Hero, signup/signin navigation, audience sections, current Free/Pro/Team plans, FAQ, privacy, footer, social image metadata, no fabricated counts/testimonial headings. Copy follows today's marketing page. |
| lists | 5 | Empty state, create, validation, cancellation. Includes today's list-or-note chooser before the template picker. |
| offline | 4 | Offline banner, sync hint, reconnect, retained content. As before, these dispatch browser online/offline events; they do not simulate an actual severed network connection. |
| onboarding | 6 | Demo creation, existing-user bypass, invite nudge/dismissal/persistence. Replaced sleeps and “pending or done” with completed demo creation and persisted-state assertions. |
| profile | 7 | Authenticated route, email, stats, activity, plan/upgrade link, back navigation, DID. |
| rename-list | 7 | Menu, dialog, prefilled name, cancel, validation, submit, Enter. |
| settings | 8 | Open/close, dark mode, feedback form/cancel, profile navigation. A one-line feedback overlay stacking fix replaces the old scripted DOM-click workaround with an actual pointer click. |
| share-modal | 7 | Owner share action, unpublished/published states, publish, share link, stop-sharing control, close, shared badge. |
| sharing | 5 | Share action/dialog, publish control, close, deprecated join-link screen. |
| smoke-upgrade-journey | 13 | Landing/pricing, billing interval, OTP steps, dashboard/create, free-tier rejection/upgrade navigation, checkout request and redirect. Yearly billing is now the default. |
| terms | 6 | Heading, date, sections, contact links, Stripe link attributes, return home. |

Earlier Mission Control phase suites were for a removed feature or lived on
historical development branches; they are not part of the pre-deletion core
suite. This migration does not restore Mission Control, its old seeded
production fixtures, or its performance-helper unit tests.

## Fixture and isolation

`e2e.config.ts` launches `tests/fixtures/server.mjs` using Bun. That process
owns Vite and a small in-memory Convex wire-protocol server, both bound to
`127.0.0.1` with automatically assigned ports. It overrides backend, billing,
identity-domain, and telemetry settings for this process so `.env.local`
cannot point these tests at a real backend. The runner stops it on completion.
No test fixture is imported by the production app.

`tests/fixtures/app.ts` extends the runner's native web fixtures. Each test
gets a fresh browser context and a separate backend account keyed by a
synthetic token. A test-only same-origin bootstrap page seeds localStorage;
the real auth provider still performs session establishment. Reloads keep
that test's state. Account state is removed in fixture teardown, including
after failures.

The fixture implements only the queries/mutations used by these scenarios.
Unexpected calls fail the test rather than silently returning success.
List/item mutations update reactive subscriptions; replay calls return
receipts and a sequence. HTTP OTP and billing responses are intercepted in
the test's browser. The synthetic Stripe destination is fulfilled locally,
and other external HTTP requests are blocked in fixture-backed tests.

These are browser UI tests against a controlled backend, matching the old
suite's scope. They do **not** prove real Turnkey delivery/signature checking,
Convex deployment behavior, Stripe integration, native-device behavior, or
real network-loss recovery. Server authorization and replay/conflict rules
remain covered by the separate unit/integration suites.

## Running

```sh
npx playwright install chromium
bun run test:e2e:typecheck
bun run test:e2e
bun run test:e2e tests/items.e2e.ts
npx e2e list
```

CI checks E2E types, runs the whole browser suite, and uploads JSON/JUnit
reports, traces, screenshots, and app logs under `.e2e/`. No model calls or
AI credentials are used by these deterministic tests.
