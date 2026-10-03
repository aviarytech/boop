# boop — Business Plan & Go-to-Market Strategy

_Last updated: July 2026_

---

## 1. Executive Summary

boop looks like a todo app. It isn't one — and that's the whole strategy.

Under the hood, boop is a **trust layer for human–AI collaboration**: every list,
item, and action is bound to a decentralized identifier (DID), signed with a
verifiable credential (VC), and optionally anchored to Bitcoin. On top of that
substrate sit three product surfaces that already exist in the codebase:

1. **Collaborative lists** — realtime shared todos with roles, invites,
   comments, assignees, templates, offline support, and native iOS/Android apps.
2. **Agent Mission Control** — a REST API (scoped API keys, agent profiles,
   run tracking with heartbeats/retries/artifacts, agent memory sync, run
   dashboards) that lets AI agents work the same lists as humans, with a
   cryptographic record of who — human or agent — did what.
3. **Sites** — one-file HTML publishing to `*.boop.ad` hostnames with portable
   `did:webvh` identity and custom-domain migration that preserves provenance.

The todo market is saturated and the "AI agent" market is exploding — but the
intersection is nearly empty: **there is no mainstream product where humans
and agents share a work queue and every action is verifiable.** As agents take
on real work in 2026, "which of my tasks did the AI actually do, and can I
prove it?" becomes a purchasing question, not a philosophical one. boop is
positioned to own that answer.

**Business model:** freemium SaaS, already built — Free (5 lists, 3
collaborators), Pro ($5/mo or $48/yr), Team ($12/user/mo) — with Stripe
billing, referral credits, and a waitlist in production. This plan adds a
usage-based **Agent tier** as the primary growth engine.

**GTM in one sentence:** land with developers and agent builders through the
Mission Control API (bottom-up, product-led), expand into teams running
human+agent workflows, and use viral loops already in the product (invite
links, shared lists, `*.boop.ad` sites, referral Pro credits) to keep CAC near
zero.

---

## 2. Product: What Exists Today

### 2.1 Core collaboration (shipped)
- OTP auth (Turnkey) → JWT; server-side DID creation and credential signing
- List CRUD, categories, tags, templates, priority focus, notes/markdown
- Roles (owner / editor / viewer), invite links, "shared with me" dashboard
- Realtime sync (Convex), presence, comments, assignees, activity feed
- Offline caching (IndexedDB), push notifications, PWA + Capacitor iOS/Android
- Public list publishing and a credential Explorer/Compare surface

### 2.2 Identity & provenance (shipped — the moat)
- Every user gets a `did:webvh` identity; lists get asset DIDs
- Item actions signed as Verifiable Credentials via `@originals/sdk`
- Bitcoin (signet) anchoring of list state for tamper-evident timestamps
- DID logs served at `/.well-known/did.jsonl`

### 2.3 Agent Mission Control (shipped, pre-launch polish)
- `/api/agent/*` REST endpoints for lists/items
- `/api/v1/*` with scoped API keys (`tasks`, `activity`, `memory`, `agents`,
  `runs`, `dashboard` scopes), zero-downtime key rotation
- Agent profiles, mission runs (heartbeat, transition, retry, artifacts,
  retention), run dashboards with success/intervention/timeout rates
- Agent memory store with sync + conflict policies (OpenClaw integration)

### 2.4 Sites (shipped)
- Paste/upload one HTML file → hosted at a generated `*.boop.ad` hostname
- Replace HTML while keeping the same DID/SCID provenance chain
- Custom domains via Cloudflare Custom Hostnames, with WebVH migration so the
  identity survives the domain move

### 2.5 Monetization plumbing (shipped)
- Stripe subscriptions; plan enforcement in the backend (`requirePlan`)
- Free / Pro / Team gating (lists, collaborators, VC issuance, templates, export)
- Referral codes granting temporary Pro; waitlist; PostHog analytics; Sentry

**Implication:** boop does not need a build phase to start GTM. It needs
positioning, packaging, and distribution.

---

## 3. Market Analysis

### 3.1 The three markets boop touches

| Market | Size / shape | boop's angle |
|---|---|---|
| Task management & collaboration (Todoist, Any.do, Trello, Asana light-end) | Huge, mature, ~$5B+, brutal competition, near-zero differentiation on features | Not the wedge. It's the familiar surface that makes the rest legible. |
| AI agent orchestration & observability (LangSmith, AgentOps, CrewAI, custom harnesses) | Small but fastest-growing dev category of 2025–26; every team running agents is improvising task hand-off | **Primary wedge.** Mission Control is a ready-made human↔agent work queue with audit trail. |
| Verifiable credentials / decentralized identity | Early, standards-driven (W3C VC 2.0, `did:webvh`), demand emerging from AI-content provenance concerns | Differentiator and defensibility, not the pitch. Sell outcomes ("provable"), not acronyms. |

### 3.2 The gap
Teams deploying agents today coordinate them through ad-hoc Markdown files,
GitHub issues, or Slack messages — none of which give: (a) a queue both humans
and agents can read/write with permissions, (b) liveness and run health for
long-running agent work, (c) an attributable, signed record of actions. boop's
own development process (the Ralph/Lisa agent loop in this repo, driven by a
boop list as the feature backlog) is the proof-of-concept: **boop is built by
agents coordinating through boop.**

### 3.3 Competitive positioning
- **vs. todo apps:** they have no agent story and no provenance. boop concedes
  nothing on the basics (realtime, mobile, offline) and adds "your AI works
  here too."
- **vs. agent observability (LangSmith/AgentOps):** they instrument traces for
  developers; they don't give the *human collaborator* a shared workspace.
  boop is the task layer, not the tracing layer — complementary, and stickier.
- **vs. Linear/GitHub Issues + bots:** closest real competitor behavior.
  boop's counter: purpose-built agent API (memory, runs, heartbeats), consumer-
  grade simplicity for non-engineers, and cryptographic attribution neither offers.

### 3.4 Timing
Agent adoption crossed from demo to production in 2025–26; procurement and
compliance questions ("what did the agent do, who authorized it?") are arriving
now. Provenance regulation pressure (AI-content disclosure) is rising. Selling
verifiability before agents mattered was too early; two years from now,
incumbents will bolt it on. The window is now.

---

## 4. Positioning

**Category:** shared task workspace for humans and AI agents.

**One-liner:** *"The todo list your AI agents can use — with receipts."*

**Positioning statement:** For teams that work with AI agents, boop is the
shared workspace where humans and agents plan, execute, and check off work
together — and every action carries cryptographic proof of who did it. Unlike
todo apps that ignore agents, or agent dashboards that ignore humans, boop is
built for both sides of the collaboration.

**Messaging ladder (lead with outcomes, keep crypto in the basement):**
1. "Give your agents a task queue" — utility
2. "See every run: live, stalled, or done" — observability
3. "Know who did what — human or AI — provably" — trust
4. (Only for those who ask) DIDs, VCs, Bitcoin anchoring — mechanism

**Naming note:** keep "boop" (friendly, memorable, ownable); make the agent
surface a named capability — **boop Mission Control** — so dev marketing has a
concrete artifact.

---

## 5. Target Customers

### ICP 1 — Agent builders (land)
Solo devs and small teams running Claude Code, OpenClaw, CrewAI, or custom
loops on real work. Pain: no shared queue between them and their agents; state
scattered across Markdown and Slack. Reached via dev channels; converts via
API. Willing to pay $10–50/mo for something that just works.

### ICP 2 — Hybrid human+AI teams (expand)
5–50 person startups/agencies where agents draft, research, and file work
alongside people. Pain: coordination and accountability ("did the agent do the
compliance checklist or a person?"). Buys Team tier; the run dashboard and
audit trail are the demo moments.

### ICP 3 — Provenance-sensitive niches (later, higher ACV)
Legal ops, compliance, regulated industries, journalism — anyone who needs
attributable checklists (chain of custody, audit prep, editorial verification).
Sales-assisted; anchor pricing well above Team. Do not chase before ICP 1–2
traction; let inbound reveal the strongest vertical.

### Consumer list-sharers (ambient, not a target)
Households and friend groups arriving via shared-list invites. Serve them well
on Free — they are the viral substrate — but don't spend GTM dollars here.

---

## 6. Business Model

### 6.1 Current pricing (keep)
| Tier | Price | Gets |
|---|---|---|
| Free | $0 | 5 lists, 3 collaborators/list |
| Pro | $5/mo or $48/yr | Unlimited lists/collaborators, VC issuance, templates, export |
| Team | $12/user/mo | Pro + team workspace, admin, API |

This is sane, cheap enough to be an impulse buy, and already enforced in code.

### 6.2 Additions (recommended)
- **Agent tier / usage add-on** — the strategic revenue line. Meter what
  agents uniquely consume: API keys, mission runs, memory storage, artifact
  retention. Suggested: Pro includes 1 agent + 500 runs/mo; **Agent Pro
  $19/mo** for 5 agents + 5,000 runs; Team includes Agent Pro per workspace;
  overage per 1,000 runs. Agents work 24/7 — usage-based pricing scales with
  the customer's automation, not their headcount, which is where all SaaS
  pricing is being forced anyway.
- **Sites packaging** — Free: 1 site on `*.boop.ad`; Pro: 5 sites + custom
  domains. Custom-domain connection is a natural paywall already built.
- **Annual-first checkout** for Pro ($48/yr = 20% off) to pull cash forward.

### 6.3 Unit economics posture
Convex + Railway + Turnkey keep marginal cost per free user near zero; the
expensive actions (VC signing, anchoring, agent runs, hosted sites) are all
behind paid gates or meterable. Target: blended CAC ≈ $0 for self-serve via
viral loops; payback < 1 month on Pro, immediate on annual.

### 6.4 Revenue scenarios (illustrative, 18 months post-launch)
| Scenario | Signups | Free→paid | Paying | Mix | MRR |
|---|---|---|---|---|---|
| Base | 20,000 | 3% | 600 | 70% Pro / 20% Agent / 10% Team (3 seats avg) | ~$6.5k |
| Good | 60,000 | 4% | 2,400 | 55/30/15 | ~$30k |
| Breakout | 150,000 | 5% | 7,500 | 45/35/20 | ~$110k |

The lever that moves Base → Good is not more signups; it's the **Agent tier
attach rate**, because agent users convert at developer-tool rates (5–15%),
not consumer-todo rates (1–3%). This is why GTM leads with Mission Control.

---

## 7. Go-to-Market Strategy

### Phase 0 — Sharpen the story (weeks 0–4)
Goal: make the differentiated product legible before spending any attention.

1. **Landing page rewrite.** Current landing is minimal ("boop."). Ship three
   audience paths: *For you* (lists), *For your team*, *For your agents* —
   with a live demo list showing an agent checking items off in realtime.
2. **Docs as product.** Publish Mission Control docs (quickstart: "agent
   completing a task in 5 minutes with curl"), an OpenAPI spec, and an **MCP
   server** so Claude/other agents can use boop natively. The MCP server is
   likely the single highest-leverage build item in this plan: it makes boop
   installable into the tools ICP 1 already uses, in one line.
3. **Instrument the funnel.** PostHog events exist; define the north-star
   (weekly lists with ≥2 active collaborators — human or agent) and the
   activation event (first shared list *or* first successful agent API call).
4. **Meta-story asset.** Write up "this app is built by AI agents that
   coordinate through the app itself" (Ralph/Lisa loop, the backlog-as-boop-list
   in the README). This is the launch narrative — self-demonstrating, unfakeable.

### Phase 1 — Developer launch (months 1–3)
Goal: 1,000 agent-connected workspaces; establish the category association
"agents + tasks = boop."

- **Launch sequence:** Show HN ("boop – a todo list your AI agents can use, built by AI agents using it") → Product Hunt a week later → X/dev-YouTube
  demo clips of an agent working a list live. The meta-story is the hook; the
  5-minute quickstart is the retention.
- **Integration beachheads:** MCP server (Claude Code / Claude Tag), OpenClaw
  memory-sync (already built — co-announce), GitHub Action ("file CI failures
  to a boop list"), CrewAI/LangChain tool wrappers. Each integration is a
  durable distribution channel, not a feature.
- **Content engine (2 posts/wk):** "How we run autonomous dev loops against a
  task queue," "Zero-downtime API key rotation for agents," "What verifiable
  agent actions actually look like." Engineering-credibility content, no
  hype.
- **Community:** small Discord; office-hours livestream of the agent loop
  building boop; respond to every agent-orchestration thread with the
  quickstart, not marketing.
- **Waitlist (already built)** for Mission Control advanced features → early
  users get grandfathered Agent Pro pricing; converts scarcity into activation.

### Phase 2 — Team expansion (months 3–9)
Goal: convert developer workspaces into multi-seat Team accounts; 4%+
free→paid among agent-connected users.

- **In-product expansion loops:** every invite landing shows role of inviter's
  agents ("Ralph checked off 14 items this week — see how"); nudge Pro when a
  user hits 5 lists or 3 collaborators (enforcement is already server-side —
  make the upsell moment gracious, not a wall).
- **Run dashboard as the demo:** success/intervention/timeout rates per agent
  is the screenshot that sells Team to a lead who manages people *and* agents.
- **Referral program (already built):** promote it — give a month of Pro both
  ways; agents can even post referral links in the artifacts they produce.
- **Templates gallery** as SEO surface: agent-runbook templates (release
  checklist an agent executes, research pipeline, on-call handoff) — each
  template page is a landing page for a use-case query.
- **Case studies:** 3 named teams running human+agent workflows; measurable
  claims (hours saved, intervention rate) pulled from the run dashboard itself.

### Phase 3 — Provenance wedge & verticals (months 9–18)
Goal: first $20k+/yr accounts; defensible category position.

- Productize the audit story: exportable, third-party-verifiable activity
  reports ("boop Receipts") — the VC/anchoring plumbing exposed as a
  compliance artifact.
- Pick the vertical that inbound reveals (likely legal ops or regulated
  fintech ops) and build one lighthouse deployment with design-partner
  pricing.
- Sites grows up: "publish your agent's output with provenance" — reports,
  dashboards, and status pages agents publish to `*.boop.ad` with signed
  lineage. This ties all three surfaces into one loop: agent does work
  (lists) → produces artifact (sites) → with proof (VCs).

### 7.1 Channels ranked by expected CAC
1. Product-led viral (invite links, shared lists, `*.boop.ad` footer) — $0
2. Integrations/marketplaces (MCP registry, GitHub marketplace) — near $0, compounding
3. Launch spikes (HN/PH) + meta-story PR — $0, one-shot but category-defining
4. SEO via templates + docs — slow burn, durable
5. Dev-community sponsorships (newsletters, agent-framework podcasts) — first paid channel, only after organic conversion is proven
6. Outbound/sales — Phase 3 only, for provenance verticals

### 7.2 What we deliberately do NOT do
- No paid consumer acquisition (unwinnable vs. Todoist/Google).
- No feature war on todo basics beyond table stakes.
- No leading with "web5/DID/Bitcoin" vocabulary in mainstream messaging.
- No enterprise sales motion before self-serve engine works.

---

## 8. Metrics & Milestones

**North star:** weekly active collaborative lists (≥2 actors, human or agent, in 7 days).

| Metric | Month 3 | Month 9 | Month 18 |
|---|---|---|---|
| Signups (cumulative) | 5,000 | 25,000 | 60,000+ |
| Agent-connected workspaces | 1,000 | 5,000 | 15,000 |
| Activation rate (share or API call ≤48h) | 25% | 35% | 40% |
| Free→paid (agent-connected cohort) | 3% | 5% | 7% |
| MRR | $2k | $12k | $30k+ |
| Logo case studies | 0 | 3 | 10 |

Guardrails: churn <3%/mo on Pro; API p95 latency and run-monitor reliability
tracked publicly (status page on a boop Site, naturally).

---

## 9. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| "Agent task queue" gets commoditized by Linear/GitHub/Notion adding agent APIs | High | Speed + provenance moat + consumer-grade simplicity; win the MCP/integration shelf space first |
| Crypto/DID branding scares mainstream users | Medium | Outcome-first messaging; mechanism opt-in and invisible by default |
| Convex bundle-size and platform limits (already hit: ModulesTooLarge) | Medium | Keep heavy signing server-side and modular (in progress per IMPLEMENTATION_PLAN); budget for a signing microservice if needed |
| Two-sided cold start (agents need lists worth working) | Medium | Templates + GitHub Action seed real work into new workspaces on day one |
| Solo/small-team execution bandwidth | High | The agent loop is the mitigation — and the marketing. Scope Phase 1 to MCP server + docs + launch, nothing else |
| Turnkey/Stripe/Cloudflare dependency pricing changes | Low | All are usage-priced and swappable at current scale |

---

## 10. 90-Day Action Plan

**Weeks 1–2** — Landing page rewrite (three-audience story + live agent demo);
define activation events in PostHog; write the meta-story post.

**Weeks 3–4** — Ship MCP server; publish OpenAPI spec + 5-minute agent
quickstart; finalize Agent tier pricing and Stripe products.

**Weeks 5–6** — Show HN launch; Discord open; respond-everywhere week;
waitlist → early-access conversions for Mission Control.

**Weeks 7–8** — Product Hunt; ship GitHub Action + one framework integration;
first two content posts from real run-dashboard data.

**Weeks 9–12** — Templates gallery v1 (10 agent-runbook templates); referral
promotion; identify 3 case-study candidates from usage data; decide Phase 2
investment based on agent-cohort conversion (target ≥3%).

**Kill/pivot criteria at day 90:** if agent-connected workspaces < 300 or
agent-cohort activation < 15%, the dev wedge is too early — pivot GTM weight
to the Team collaboration story and keep Mission Control as a differentiating
feature rather than the lead.

---

## Appendix A — Why boop wins (compressed)

1. **Only product where humans and agents share a permissioned work queue.**
2. **Provenance is built-in, not bolted on** — DID/VC/anchoring already in prod.
3. **Self-demonstrating story** — the app is built by agents coordinating in it.
4. **Zero-CAC loops already shipped** — invites, referrals, public lists, hosted sites.
5. **Pricing scales with automation** (agent runs), not just seats — aligned with where work is going.
