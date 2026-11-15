# Plan 002: Agents sign their own action records — decision record

Issue: #286 (PR d). Supersedes the agent-key-in-owner-DID design in PR #308
(`feat/lws-agent-auth`, head `3fed9ca`, `docs/lws-agent-auth.md`).
Decided in a grilling session on 2026-11-15. Main was at `9934ed8`.

## Goal

Every edit to a Boop list carries a signed record that a third party can
verify, showing whether a human or an AI agent made it. For agents the record
reads **"agent X, delegated by Y"**.

## Facts the decisions rest on (verified 2026-11-15)

- **No server-side signing for users.** The Turnkey parent org can't sign
  inside a user's sub-org (#286 finding 1). Every user signature happens in the
  client, through the user's Turnkey session.
- **#308 adds `#agent-<id>` to the user's did:webvh under `authentication`
  only.** The action-record verifier (`shared/actionRecord.ts:419-429`) needs a
  Multikey in `assertionMethod`, and `recordActions` needs `#orig-1`
  (`convex/lib/actionRecords.ts:86`). On top of that, `/lws/` writes don't pass
  `signed` (`convex/lwsStorage.ts:257-340`). So agent writes are `unsigned`
  today, and `createdByDid` is the owner (`convex/items.ts:98,287`).
- **Agent keys in the DID cause #308's main problems.** Old builds reject such a
  DID, which led to the 426 gate (`convex/http.ts:216`, doc line 172).
  Interrupted approvals strand keys in the DID. Every approve and revoke needs a
  Turnkey-signed DID update. There's a cap of 25 agents per DID.
- **Only 5 action types are recorded:** `item.created`, `item.completed`,
  `item.reopened`, `list.created` and `list.renamed`
  (`shared/actionRecord.ts:39-44`). Edits, deletes and reorders aren't recorded.
- **The verifier resolves the key at the `versionId` the record names, not by
  time.** `signedAt` isn't checked, so a revoked key can backdate
  (`docs/action-records.md:263-280`).
- **`/api/v1` X-API-Key** writes attest `{kind:"apiKey"}`. `agentApiKeys.agentDid`
  can't be set by callers, and there's no `lastUsedAt`.
- **Portable Web Spaces (PWS)** (W3C CCG draft, v0.6 in progress), with
  PWS-AUTHZ v0.1:
  - Delegation uses zCap chains rooted in a controller DID, invoked with HTTP
    Signatures (Cavage draft 12, moving to RFC 9421).
  - `did:key` is required. `did:webvh` is optional, and its delegating key must
    be listed under **`capabilityDelegation`** (and `capabilityInvocation` for
    root invocations). `assertionMethod` doesn't count.
  - `createdBy` is only what the server observed, and `writerId` is a label the
    client declares. Neither gives durable, third-party-verifiable attribution
    of a write.
  - Revocation is not specified. Expiry and key removal are the only levers the
    spec backs.
  - The spec changes fast: about 13 breaking changes in v0.5.
  - `@interop/pws-client` supports browser and React Native. Nobody has tested
    the libraries in Convex's runtime.
- **`@originals/auth@4.0.2`** is Boop's Turnkey-based login package for humans.

## Decisions

| # | Topic | Decision | Why | Rejected |
|---|---|---|---|---|
| D1 | Agent identity | Keep the per-enrollment Ed25519 **`did:key`** and add an optional `agentDid` slot for a lasting DID later. | Ships fast. PWS requires `did:key`, so it fits either protocol. | A lasting agent did:webvh only, or both from day one. Too much friction for agent authors, and twice the resolution and tests. |
| D2 | Who signs | The **agent signs its own records, client-side,** with its did:key. | The proof has to come from the agent, not from Boop saying so. | Boop attesting on the agent's behalf (third parties would only have Boop's word), and agent-signs plus a server countersignature as the core proof. A countersigned *receipt* came back later for timestamps only (D11). |
| D3 | Originals | Agents sign **action records only**. Originals stay human-signed with `#orig-1`. | Keeps the blast radius small, and agent keys never reach `assertionMethod`. | A separately granted Originals scope, and a hard ban in the verifier (unneeded, since agents never get `assertionMethod`). |
| D4 | Where the code lives | Build it in **Boop `shared/` first**, then **move it to `@originals/auth/agent`** (no Turnkey dependencies) as its own PR. | Lets the format settle before it's published. You wanted it in originals/auth eventually. | Starting in `@originals/auth/agent` (releases would gate design iteration), a new `@originals/agent` package, and Boop-only with no portability. |
| D5 | Signing authority | **Take agent keys out of your DID.** The agent's authority comes from a delegation. Which format depends on a 3-day **PWS zCap spike** (S1–S3). | Agent keys in the DID cause the 426 gate, stranded keys, the per-approval DID updates and the cap. "authentication-as-assertion" is non-standard. | A narrow verifier rule that accepts `#agent-*` from `authentication`, keeping #308's DID listing with a VC added, and adding `#agent-*` to `assertionMethod` (agents could sign anything as you). |
| D5a | Spike gates (pass/fail) | (1) `#orig-1` signs an `eddsa-jcs-2022` zCap delegation through Turnkey in the client. (2) Convex verifies an HTTP-signature zCap invocation and its chain. (3) An agent-signed record that embeds the chain still verifies offline after expiry or revocation. | These are the only things that could block PWS for us. | Making old-build tolerance a gate. It's handled by D13 instead. |
| D5b | Spike form | A throwaway `spike/pws-agent-zcap` branch off `main`, **3 days**, never merged. Output: `plans/pws-spike-findings.md`. | Cheap, isolated, and answers the Convex runtime gate. | Building on #308's branch (inherits the design you're dropping), and standalone scripts (can't test Convex). |
| D5c | Fallback | If any gate fails, use a **Boop-native delegation VC**: `#orig-1` signs, under `assertionMethod`, a VC giving the agent's did:key scopes and an expiry. It goes over LWS transport with no DID change. | Works today with existing keys and verifier machinery. | Keeping #308's DID-key design, and waiting for PWS to mature. |
| D5d | Full PWS storage surface | **Not now.** Only the authorization model is being evaluated. | v0.5/v0.6 churn, and PWS has no verifiable write attribution. | Replacing `/lws/` with PWS Spaces and Collections. |
| D6 | Unsigned agent writes | **Reject.** Recorded actions on the agent path need a valid agent signature, or the server returns 4xx. | Nothing is in prod, so there's no compatibility cost, and the guarantee holds from day one. | Accepting and marking them `unsigned`, and a grace window. |
| D7 | Legacy `/api/v1` X-API-Key | **Remove** it in the same release that ships signed agent writes, whatever the protocol. | One attribution model, and an unsigned path doesn't fit the pitch. There's always a replacement when it goes. | Keeping it as a permanent unsigned path, removing it with 30 days' notice, and removing it now (agents would have no way to write). |
| D8 | Scope | Agents sign the **existing 5 types plus new `item.edited` and `item.deleted`**, added for humans and agents **before agents launch**. No reorder. | "The agent deleted my item" is the obvious question the pitch has to answer. | Shipping the existing 5 first with edit/delete later, and every mutation including reorder (noisy, heavy to sign). |
| D9 | Data model | The record's `author` is the **agent's did:key**, with `onBehalfOf` = owner DID and the delegation proof. Items keep **`createdByDid` = owner** and gain **`createdByAgent`** (and `checkedByAgent`). The UI and verifier show "agent X, delegated by Y". | Accurate attribution without breaking ownership and permission queries. | `createdByDid` = agent (breaks ownership queries), and leaving the agent only in the record (the UI would have to join). |
| D10 | Revocation and history | A record stays **valid if Boop's signed receipt time predates revocation**. Later or receipt-less records fail. | Keeps honest history and stops backdating with a leaked key. | Trusting `signedAt` inside the delegation window (backdating possible), and invalidating everything on revoke (wipes honest history). |
| D11 | Receipt signer | A **Boop service did:webvh** with its key in the **Turnkey parent org**. The parent org can sign server-side with its own keys. A Convex action calls Turnkey. | Rotation with history, and no raw key in env. | did:web with an env key, and did:webvh with an env key. |
| D12 | Delegation lifetime | **30 days**, renewed by re-approving (one Turnkey signature). | Limits a leaked key without a revocation list third parties can see. Boop also enforces revocation server-side straight away. | 1 year plus server revocation, and 24 hours with background renewal (needs an active Turnkey session). |
| D13 | Old builds | If the chosen design changes DIDs (for example zCaps need `capabilityDelegation`), **release tolerant builds first,** wait for adoption, then change DIDs. **No 426 gate.** | Doesn't lock out users who haven't updated. | Accepting a 426 gate, and changing DIDs only on first agent approval (breaks that user's other devices). |
| D14 | Enrollment | An agent needs a **one-time code from Settings** in its access request. | Stops strangers posting requests to your DID. Answers #308's request-spam question. | Open requests with a rate limit (#308 today), and an optional code (two paths). |
| D15 | PR #308 | **Convert to draft and park it.** It stays on dev and isn't merged. After the spike, salvage its enrollment, token and UI code into P5 and close it with a link. | No debt lands in prod. Most of its non-DID code is reusable. | Merging as-is (the 426 gate and DID keys reach prod), and closing now (salvaging gets harder). |
| D16 | Parallel work | **Start the protocol-independent PRs now,** alongside the spike. | Starts the release clock for tolerant builds and ships edit/delete for humans sooner. | Only edit/delete now, and nothing until the spike ends. |
| D17 | Reach | Boop first. Formats stay app-neutral so B3 and the Originals SDK can adopt `@originals/auth/agent` after P8. | Follows from D4. | Building a shared library now. |

### What happens to #308's open review threads

- **Request spam** is answered by D14 (enrollment code).
- **The 426 gate** is replaced by D13 (tolerant builds first). The agent-keys
  capability check goes away once agent keys leave the DID. The plaintext-OTP
  part of the gate predates #308 and is out of scope.
- **Stranded key after an interrupted approval** no longer applies (D5), since
  agent keys are never written to the DID.
- **The stray `convex/http.ts.orig`** shouldn't be salvaged.

## Stacked PR plan

Every PR is assigned to its own **Fable 5.2 agent (`claude-fable-5-2`)**. Each
agent works in its own worktree, follows repo conventions, runs
`tsc` / `bun test` / `bun run build`, and reports back with
"PR <url>, head <sha>, checks <state>". Nobody merges to prod without the
owner.

### Track A: start now, in parallel (each off `main`)

| PR | Branch | Agent | Scope | Done when |
|---|---|---|---|---|
| Spike | `spike/pws-agent-zcap` (never merged) | Fable agent A | Prototype gates D5a(1–3) with `@interop/pws-client` and `@interop/zcap`. Write `plans/pws-spike-findings.md` with a pass/fail per gate and a recommendation (zCap or the D5c VC). | Findings doc reviewed by the owner and the D5 format chosen. Time box: 3 days. |
| P1 | `feat/record-edit-delete` | Fable agent B | Add `item.edited` and `item.deleted` to `shared/actionRecord.ts`, `convex/lib/actionRecords.ts` and `convex/items.ts`, human-signed via `#orig-1`. Deleted items keep their records. Update `docs/action-records.md`. | Edits and deletes produce verified records for humans. |
| P2 | `feat/tolerant-did-parsing` | Fable agent C | `authorDidProblems` (`shared/authorDid.ts`) accepts `#orig-1` also listed under `capabilityDelegation` and `capabilityInvocation`. Tests cover it. Ship in the next web and native store builds. **No DID changes.** | The builds are released, and an adoption metric or date is noted. |
| P3 | `feat/boop-service-did` | Fable agent D | Boop service did:webvh with its key in the Turnkey parent org. Convex action `signReceipt(recordHash, receivedAt)`. Receipt schema plus a verifier helper in `shared/`. | A receipt round-trips and verifies offline. |
| P4 | `feat/agent-enrollment-codes` | Fable agent E | Short-lived one-time codes: a table, a Settings UI to mint them, and an internal `redeemEnrollmentCode`. No consumer yet, behind a flag. | Codes mint, expire and redeem once in tests. |

### Track B: after the spike decision (stacked, in order)

| PR | Branch (base) | Agent | Scope |
|---|---|---|---|
| P5 | `feat/agent-delegation` (base `main` after P2–P4) | Fable agent F | Delegation in the chosen format (zCap or VC) in `shared/agentDelegation.ts`. Approval UI signs it with `#orig-1` (30-day expiry, re-approve to renew). Enrollment requires a P4 code. Salvage #308's request, token and UI code **without** DID updates. If zCap: add `capabilityDelegation` to DIDs **only after P2 adoption** (D13). Then close #308 with a link. |
| P6 | `feat/agent-signed-records` (base P5) | Fable agent G | Record version where `author` is the agent's did:key, plus `onBehalfOf` and the delegation proof. Verifier accepts it only for action records. `recordActions` accepts agent signatures, attaches P3 receipts and **rejects unsigned agent writes** (D6). `items.createdByAgent`/`checkedByAgent`. UI and verifier show "agent X, delegated by Y". Covers the existing 5 types plus P1's types. |
| P7 | `chore/remove-api-v1-keys` (base P6) | Fable agent H | Remove the X-API-Key path (`convex/lib/actor.ts`, `convex/apiKeysHttp.ts`, `agentApiKeys`, `API.md`, the matching Settings UI). Ships in the **same release** as P6 (D7). |
| P8 | `feat/agent` in the `@originals/auth` repo, plus a Boop bump PR | Fable agent I | Move `shared/agentDelegation.ts` and the agent record helpers to `@originals/auth/agent` (no Turnkey dependencies). Boop switches imports. Opens the way for B3 and the SDK (D17). |

### Owner actions

1. Convert #308 to draft (D15).
2. Approve and kick off Track A: five Fable 5.2 agents.
3. Review `plans/pws-spike-findings.md` and choose the D5 format.
4. Approve the P2 adoption threshold before any DID change.
5. Any prod deploy or merge of the agent work.
