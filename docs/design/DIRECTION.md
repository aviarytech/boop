# boop: design direction

## Brief (confirmed by Brian, 2026-10-18)

- **What:** a redesign of both the marketing site (boop.ad landing) and the app (home, list view, note editor), as one system. Start with the landing first screen and the list view as the core app screen.
- **Who:** people who keep shared todo lists with their team, and increasingly hand items to AI agents over the REST API.
- **The one job.** Landing: in ten seconds, a visitor understands that people and agents share one list and every checkmark records who made it, then taps Get boop. App: open a list and get things done in it.
- **Feel:** quick, trustworthy, playful.
- **Keep:** the name, the rounded "boop" wordmark spirit. **Violet is not sacred.**
- **Images:** no photos. Richness comes from the product itself, staged with depth.
- **App access:** local test fixture server (`tests/fixtures/server.mjs`), no live backend.

## Current

Shot 2026-10-18: `shots/before-landing`, `shots/before-home`, `shots/before-list`.

- **Slop faces:** Paper Edition in a violet coat. Warm off-white `#fafaf7`, a heavy Nunito headline with one phrase in the accent, a row of monospace labels, a filled pill next to a ghost pill, and a floating product card below the fold. Geist + Geist Mono + Nunito, none of them chosen for a stated reason.
- **Scan FAILs:** landing has 3 (contrast on footer 2.3:1 and avatar initials 2.8:1; ⚡ emoji as the agent icon). Home has 3 (nav labels 4.39:1, ⌘K hint 2.36:1; 🎯 📁 emoji). List has 1 (8 elements under 4.5:1, "Not anchored" at 2.36:1).
- **App defects seen by eye:**
  - The list view shows two progress bars, one under the title and a second full-width one.
  - On a 390px phone the top nav overflows: sign-out, account and Upgrade are cut off.
  - The DID badges wrap into two-line pills.
  - The core screen is a narrow column floating in empty space at 1440px.
  - Every row is a boxed card with a shadow.
  - The disabled Add button is pale violet and reads as broken.
  - Home leads with a referral banner and a search field before the lists.
- **What works:** the idea "your agents can use it, and it remembers who did what"; the product is the right evidence (a shared list next to an agent run); the name.
- **Copy and signing:** records are stored unsigned today (docs/action-records.md, #244). Brian decided on 2026-10-18 to keep the "signed" copy because signing ships soon.

## Category default refused

Todo and agent-ops tools share: violet or blue for "AI", a white card with checkboxes floating on off-white, a dark terminal pane beside it, Inter/Geist, "supercharge your workflow", three feature cards. boop's current page already wears most of these.

## Explorations (first screen, 390 + 1440)

| | A · Seals | B · Hive | C · Squeeze toy |
|---|---|---|---|
| Concept | boop is a set of personal seals: every tick is stamped by whoever made it | boop is a beehive: people and agents fill the same comb | boop is a squeeze toy: press a box and it boops |
| Family | object | nature | play |
| Ground | light (cool jade-white) | dark (warm brown-black) | colour field (violet) |
| Type | Bricolage Grotesque, narrowed and heavy | Young Serif + Onest | Fredoka + Rethink Sans |
| Accent | jade green | honey yellow | violet field + chartreuse |
| Richness | data (the real list, large) | 3D object (lit comb) | shape (tactile controls) |
| Grammar | scroll-story | poster | tool-first (rut) |
| Motion | seal presses, ring draws on | comb tilts to pointer, a cell fills | spring squash on press |
| Depth | sheet crosses the headline; seal floats over the sheet corner | comb behind headline; live card crosses the comb | card over a giant cropped "boop" (overlap still weak) |

**Pick: A, Seals, taking C's working checkbox as the signature.**

- **A wins** because the concept *is* the product claim. A stamp on a checkmark reads as "this person did it" to a stranger. Round stamps for people and square stamps for agents show state by shape, not hue. It moves straight into the app: each list row carries its stamp. The light ground suits an all-day tool.
- **B lost** on the stranger test and on the app. It's the most striking of the three, but hexagon cells are a bad shape for a list you read every day, and the comb needs explaining.
- **C lost** because it is closest to the current look (violet, rounded) and to the soft-tactile default, and its giant word never locked with the card. Its press-a-box interaction is the best moment of the three, so it comes along as A's signature: press a box and your stamp lands on it.

History check against the current look: A differs on ground, type and accent (3 of 6). Richness stays the same (the product is the evidence) and so does the grammar. Changing the grammar to `document` or `index` would get to 4 of 6.

**Approved by Brian 2026-10-18.** Keep "signed" in copy: signing ships soon.

## Tokens

- **Ground** `oklch(97.4% .007 165)`: the cool white of a seal-maker's counter, a hint of jade. **Sheet/surface** `oklch(99.6% .002 165)`: paper the stamps land on. **Ink** `oklch(21% .02 200)`: stamp-pad black-green. **Ink-2** `oklch(42% .018 200)`: still 4.5:1 on ground. **Rule** ink at 9%.
- **Jade** `oklch(50% .115 163)`, the one accent: the seal's stone and the primary action. It's also the people-stamp ink. Agent stamps use ink, not a second hue.
- **Dark:** ground `oklch(17% .012 190)`, sheet `oklch(21% .014 190)`, ink `oklch(95% .01 165)`, jade lifted to `oklch(72% .12 163)`.
- **Type:** Bricolage Grotesque for everything, because its narrow, heavy cuts look carved, like a seal's letters. The opsz axis lets one family do 124px display and 14px UI. Fragment Mono for DIDs and code only. The current tokens use 4 width/weight steps.
- **Scale (site):** display clamp(54,7.6vw,124) · h2 clamp(36,4.4vw,64) · h3 24 · body 19 · small 16 · meta 14. **App:** title 28 · body 16 · meta 13 (floor).
- **Radius family:** sheet 22, control 12, stamp ring circle, agent square 6. **Spacing:** 4 8 12 16 24 40 64 104 160.

## The signature

Press a box on the landing list. The seal lifts (scale 1.04, 80ms), lands (scale .97, 120ms, spring back), and the ring of your impression draws on (stroke-dashoffset 1→0, 420ms ease-out). Your name and the time are inked in after 140ms. In the app, every check runs the same 600ms motion on the row's stamp. Reduced motion: the stamp simply appears.

## Grammar (landing, scroll-story)

1. **Hero:** what is it, the evidence, the action. The real list is large, the seal floats over its corner, and pressing a box stamps it.
2. **People and agents, one list:** who does the work? A rail of three big stamps (you, Theo, release-bot), each with what it did. Round is a person, square is an agent.
3. **Agents over plain HTTP:** how does an agent use it? A curl call, and its square stamp crossing from the code panel into the list row it checks.
4. **Read the record:** can I trust it? One enormous impression cropped by the frame, with its record set in page type.
5. **Pricing:** what does it cost? Three plans as one comparison table, with the jade row on Pro.
6. **Questions + end:** what's left? Six short answers, then the action and the footer.

## Content

**Nav:** boop · How it works · Agents · Pricing · Docs · Sign in · **Get boop**

**1 Hero**
- H1: Every checkmark says who made it.
- Sub: A shared todo list for you, your team and your AI agents. Each tick is stamped and signed by the person or agent behind it.
- Action: **Start a list, free** · Already using boop? Sign in
- List "Ship boop 0.5", shared with Ines, Theo and release-bot:
  - [x] Run the test suite on staging, ci-runner · 412 passed · 11:20 (square)
  - [x] Update the App Store screenshots, Theo · 13:05 (round)
  - [x] Write the release notes, release-bot for Ines · 14:02 (square)
  - [ ] Email the beta testers, Ines
  - [ ] Bump the version to 0.5.0, release-bot
- Hint under the list: Press a box. Your stamp goes on it.

**2 People and agents**
- H2: One list, whoever does the work.
- Intro: People check things off from their phone. Agents check them off over the API. Everyone's tick looks different, so you always know which was which.
- You: "Lists that keep up." Type, hit return, done. Syncs live across your devices and keeps working offline.
- Your team: "One workspace, no chasing." Share a list in two taps. Everyone sees the same list at the same moment, with a history of who did what.
- Your agents: "Mission Control." Give an agent a list instead of a prompt. You watch items close live, and each one carries the agent's stamp.

**3 Agents over HTTP**
- H2: An agent finishes its first task in five minutes.
- Body: Create an API key, hand it to your agent, and it works the same lists you do with any HTTP client. No SDK to install.
- Code: `curl -X POST https://boop.ad/api/items/check -H "Authorization: Bearer $BOOP_KEY" -d '{"itemId":"k7c2…","list":"Ship boop 0.5"}'`
- Result row: [x] Bump the version to 0.5.0, release-bot · just now
- Link: Read the API quickstart

**4 The record**
- H2: Tap any stamp to read its record.
- Record: Write the release notes · checked 14:02:31 · by release-bot · using API key "release-bot", issued by Ines Moreau · signed with release-bot's key · list Ship boop 0.5
- Line: No one can put your name on a tick you didn't make, and no agent can quietly rewrite what it did.

**5 Pricing** (H2 "Fair, flat, forever.")
| | Free $0 | Pro $5/mo ($48/yr) | Team $12/user/mo |
|---|---|---|---|
| Lists | 5 | Unlimited | Unlimited |
| Collaborators per list | 3 | Unlimited | Unlimited |
| Realtime sync, offline | ✓ | ✓ | ✓ |
| Templates, export, verified sharing | · | ✓ | ✓ |
| Team workspace and admin | · | · | ✓ |
| API access for agents | · | · | ✓ |
Actions: Start free · Go Pro · See full pricing. (✓ and · drawn as glyphs in the type, not emoji.)

**6 Questions** (H2 "Just the honest questions."): the existing six answers, edited down; the "Offline?" question becomes "Does it work offline?". End: "Your next teammate might be an agent." · **Start a list, free** · API quickstart. Footer tag kept: "Made carefully, by humans and agents."

**Cut:** the unattributed pull quote ("an early Mission Control tester"); it can't be checked. The "signed build" footer line.
