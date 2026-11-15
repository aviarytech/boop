# PWS zCap spike: findings

Issue #286, plan 002 decision D5 (spike gates D5a, form D5b). Branch
`spike/pws-agent-zcap`, off `main` at `c4ec8b1`. Never merged. Run on
2026-11-15; all three gates were answered in one sitting, so the spike stopped
well inside its 3-day box.

## Result

| Gate | Question | Result |
|---|---|---|
| 1 | `#orig-1`, signing only as "sign these bytes" through a Turnkey session, can sign an `eddsa-jcs-2022` zCap delegation to an agent did:key | **PASS**, with a local key behind the Turnkey backend interface. The live Turnkey check is an owner action. |
| 2 | Convex can verify an HTTP-signature zCap invocation and its chain | **PASS**, in an HTTP route on the default V8 runtime and in a `"use node"` action, on a local backend. |
| 3 | An agent-signed record that embeds the zCap verifies offline after expiry or revocation, given a receipt time | **PASS**, with no network call, by two independent verifiers. |

**Recommendation: zCap.** No gate blocks it. The price is a DID change for
every user who approves an agent, which cannot ship before the tolerant builds
of P2 are adopted (D13), and about 80 kB gzipped of new library code on the
client and in the Convex bundle. If agents have to launch before P2 adoption,
take D5c instead; that is the one decision this leaves for the owner (see
[Recommendation](#recommendation)).

Nothing here was run against a real Turnkey session, the shared dev deployment
`basic-bloodhound-21`, prod, or any user DID.

## What was built

All of it is throwaway, in `spike/pws-zcap/`, with its own `package.json` so
the root lockfile is untouched.

| File | What it is |
|---|---|
| `lib/common.mjs` | Local keys behind `AuthorKeyBackend.sign`'s shape, the `{id, sign({data})}` signer, an offline DID document loader |
| `lib/userDid.mjs` | A user did:webvh minted the way `mintAuthorDid` does, then updated to list `#orig-1` under `capabilityDelegation` |
| `gate1-delegate.mjs`, `gate1b-webvh-interop.mjs` | Gate 1 |
| `convex/` (`zcapVerify.ts`, `http.ts`, `nodeVerify.ts`), `gate2-invoke.mjs` | Gate 2: a standalone Convex project and the agent that calls it |
| `lib/agentRecord.mjs`, `gate3-offline.mjs` | Gate 3: the record sketch and two offline verifiers |
| `size/measure.mjs` | Bundle-size probes |
| `evidence-*.txt` | Full output of each script as run |

To run it again:

```
bun install                      # repo root: the scripts import shared/ and didwebvh-ts from it
cd spike/pws-zcap && npm install
bun gate1-delegate.mjs
bun gate1b-webvh-interop.mjs
CONVEX_AGENT_MODE=anonymous npx convex dev --typecheck disable   # local backend, no account; needs Node 22 or 24 on PATH
bun gate2-invoke.mjs             # in another shell; refuses any non-local Convex URL
bun gate3-offline.mjs
node size/measure.mjs
```

Library versions: `@interop/zcap` 11.4.0, `@interop/ezcap` 7.5.4,
`@interop/http-signature-zcap-invoke` 6.3.0,
`@interop/http-signature-zcap-verify` 12.2.7, `@interop/pws-client` 0.109.0,
`@interop/ed25519-signature` 7.2.5, `@interop/data-integrity-proof` 3.4.8,
`@interop/jsonld-signatures` 11.9.0, `@interop/did-method-webvh` 5.20.0,
`convex` 1.50.0, `didwebvh-ts` 2.8.0 (the repo's). The spike used the
`@interop/*` packages throughout, since `@interop/pws-client` depends on them;
the Digital Bazaar `http-signature-zcap-invoke`/`-verify` originals they are
forked from were not exercised.

## Gate 1: `#orig-1` signs a zCap delegation — PASS (local key)

`bun gate1-delegate.mjs`, full output in `evidence-gate1.txt`.

The signer the libraries want is `{ id, sign({ data }) }`. `remoteZcapSigner`
in `lib/common.mjs` builds one from a `signBytes(bytes)` callback, which is the
same callback `remoteKeySigner` takes in `src/lib/originalsSigning.ts`. In the
spike the callback calls a local stand-in with the exact signature of
`AuthorKeyBackend.sign(subOrgId, address, message)`. `ZcapClient.delegate` and
`PwsClient.fromSigner({ signer }).grant(...)` both accept it.

```
OK signed bytes == sha256(JCS(proof options)) || sha256(JCS(zcap)), using boop's own canonicalize
OK proofValue is #orig-1's Ed25519 signature over those bytes
OK chain verifies: root (controller = user did:webvh) -> agent did:key, #orig-1 under capabilityDelegation
OK a tampered zCap does not verify
OK PwsClient.fromSigner({signer}).grant(...) signs through the same remote signer and verifies
```

What that shows:

- **One signature per delegation.** The backend was called once, on the
  `#orig-1` account, with 64 bytes.
- **Those 64 bytes are the ones boop already sends to Turnkey for Originals
  entries**: `sha256(JCS(proof options)) || sha256(JCS(document))`. Turnkey
  sees a raw 64-byte Ed25519 request it cannot tell apart from an Originals
  signature. That is why a local key is a fair stand-in, and why the live check
  is expected to pass.
- The delegated zCap, as produced:

```json
{
  "@context": ["https://w3id.org/zcap/v1", "https://w3id.org/security/data-integrity/v2"],
  "id": "urn:uuid:cc9e9547-dc9d-432d-8bac-f55c23d34de3",
  "controller": "did:key:z6MkgJ3vjfc1GEKU6e1h7D2RkJftaxyM9qmvXtxjDz399Lnf",
  "parentCapability": "urn:zcap:root:https%3A%2F%2Fboop.example%2Flws%2F",
  "invocationTarget": "https://boop.example/lws/",
  "expires": "2026-12-15T19:48:35Z",
  "allowedAction": ["item.created", "item.completed", "item.reopened", "list.created", "list.renamed"],
  "proof": {
    "type": "DataIntegrityProof", "cryptosuite": "eddsa-jcs-2022",
    "created": "2026-11-15T19:48:35Z",
    "verificationMethod": "did:webvh:QmXe…:spike.boop.test:u-spike#orig-1",
    "proofPurpose": "capabilityDelegation",
    "capabilityChain": ["urn:zcap:root:https%3A%2F%2Fboop.example%2Flws%2F"],
    "@context": ["https://w3id.org/zcap/v1", "https://w3id.org/security/data-integrity/v2"],
    "proofValue": "z5qPqwk…"
  }
}
```

### The DID change it implies

PWS-AUTHZ 5.1 requires the delegating key under `capabilityDelegation`, and
the libraries enforce it. The same zCap checked against today's DID state
fails:

```
Verification method "did:webvh:…#orig-1" not authorized by controller for proof purpose "capabilityDelegation".
```

So each user's did:webvh needs one more log entry that adds

```json
"capabilityDelegation": ["#orig-1"]
```

and changes nothing else. `capabilityInvocation` is not needed: the user never
invokes, only delegates. It is one DID update per user, signed by `#key-0`
through Turnkey, not one per agent. This is where it stops being cheap:

1. **`main` rejects such a DID.** `authorDidProblems` on the updated state
   returns `["capabilityDelegation must be empty"]`, and `authorLogProblems`
   rejects the whole log from that version on. An account whose DID is updated
   breaks on every device running a build without P2. This is exactly the D13
   case: P2 has to be released and adopted first.
2. **didwebvh-ts 2.8.0 cannot write the update cleanly.** `updateDID` has
   overrides for `authentication`, `assertionMethod` and `keyAgreement`, but
   none for the capability relationships. The only way in is a verification
   method's `purpose`, which it then leaves in the document:
   `#orig-1` ends up with `id, type, controller, publicKeyMultibase, purpose`,
   and `authorDidProblems` adds `"#orig-1 carries purpose"`. P5 has to either
   build that log entry by hand (hash, sign with `#key-0`, append), or move to
   a library that takes a whole next document. P2 should not learn to tolerate
   `purpose`.
3. **`proofHashData` on `main` refuses a zCap proof**:
   `PROOF_UNKNOWN_MEMBER: proof member "capabilityChain" is not defined by Data Integrity`.
   Its allowlist is right for Originals. P5 needs its own small signer for
   delegations (the spike's `remoteZcapSigner` is 10 lines) rather than a
   wider allowlist in the Originals signer.

### Is a did:webvh controller accepted by the libraries?

Yes, with one adapter. `bun gate1b-webvh-interop.mjs`, `evidence-gate1b.txt`:

```
OK   interop resolver accepts boop's genesis log (didwebvh-ts 2.8.0)
OK   interop resolver accepts the didwebvh-ts-written update
OK   interop updateDID({ didDocument }) writes a clean update over boop's log
OK   didwebvh-ts 2.8.0 (boop's resolver) accepts that update
     authorDidProblems (main): ["capabilityDelegation must be empty"]
```

- The zCap libraries do not resolve DIDs. They call a `documentLoader` the
  caller supplies, so any DID method works if boop resolves it. On the server
  that loader reads `didLogs`; nothing is fetched.
- **The loader must make key references absolute.** didwebvh-ts writes
  `"capabilityDelegation": ["#orig-1"]`. jsonld-signatures compares the proof's
  absolute `did:webvh:…#orig-1` against that list as plain strings, so the
  document as stored fails with the same "not authorized" error as a DID with
  no `capabilityDelegation` at all. `absolutizeDidDocument` in
  `lib/common.mjs` is the fix, and it has to be applied before every
  verification. It is easy to forget and fails closed.
- The resolver the PWS stack itself uses (`@interop/did-method-webvh`) accepts
  boop's logs, and boop's resolver accepts an update that library wrote, so the
  two did:webvh implementations agree on boop's log format. Its
  `updateDID({ didDocument })` takes the whole next document and writes the
  update with no stray member, which is one way out of point 2 above.

## Gate 2: Convex verifies an invocation and its chain — PASS

`bun gate2-invoke.mjs` against `CONVEX_AGENT_MODE=anonymous npx convex dev`
(a local backend on `127.0.0.1:3210`, no Convex account). Full output in
`evidence-gate2.txt`.

`convex/zcapVerify.ts` has no `"use node"`. `convex/http.ts` calls it directly
from an `httpAction` (V8 isolate) and through `convex/nodeVerify.ts` (a
`"use node"` internal action). The owner's DID document comes from a Convex
table through `ctx.runQuery`, standing in for `didLogs`. The agent signs with
`signCapabilityInvocation` and sends a plain `fetch`.

```
OK   V8 route: agent invokes zCap delegated by #orig-1: 200 v8 verified=true 10ms
OK   "use node" action: the same verifier module: 200 node verified=true 5ms
OK   zCap rooted at /node/lws/ invoked on the /lws/ route: 403 (Actual root capability … does not match expected root capability …)
OK   another key invokes the agent's zCap: 403 (The capability controller does not match the verification method (or its controller) used to invoke.)
OK   action outside allowedAction: 403 (Capability action "item.deleted" is not allowed by the capability; …)
OK   action signed differs from the action the route performs: 403 (Capability action "item.created" does not match the expected action of "list.renamed".)
OK   body changed after signing (digest): 403 (The request body does not match the signed Digest header.)
OK   zCap tampered after delegation: 403 (Invalid signature.)
OK   zCap delegated by a key that is not the owner's: 403 (The capability controller does not match the verification method (or its controller) used to delegate.)
OK   zCap delegated by the owner's #key-0 (not under capabilityDelegation): 403 (… not authorized by controller for proof purpose "capabilityDelegation".)
OK   expired zCap (expired an hour ago): 403 (The invoked capability has expired.)
OK   replayed request (verifier clock 31 days on): 403 (The signature has expired.)
OK   zCap longer than the 31-day TTL cap: 403 (A delegated capability in the delegation chain has a time to live that is too long.)
OK   narrowed zCap used inside its target: 200
OK   narrowed zCap used outside its target: 403 (Invocation target (…/lws/lists/xyz/items) does not match capability target (…/lws/lists/abc/).)
```

- **Runtime.** The whole stack bundled and ran in the V8 isolate with no
  polyfill, shim or bundler setting. Warm, verification took 10 ms in V8 and
  5 ms in the Node action (the saved run). The first request after a push was
  slower, 166 ms in V8 and 258 ms in Node on an earlier run that is not in the
  evidence file. The V8 route is enough; the Node action buys nothing.
- **Scope maps cleanly.** `allowedAction` carries boop's action types
  (`item.created`, …) and `invocationTarget` narrows to a list by URL prefix.
  `maxDelegationTtl` enforces D12's 30 days on the server.
- A request carries about 1.4 kB of signature headers, most of it the gzipped
  zCap in `Capability-Invocation`.

### Problems found

1. **The library does not check the body.** `verifyCapabilityInvocation`
   requires the `Digest` header to be under the signature when there is a
   `Content-Type`, and never reads the body. The first run accepted a changed
   body with `verified=true`. The route has to compare the body with the
   `Digest` header itself (`verifyHeaderValue` from
   `@interop/http-digest-header`; done in `zcapVerify.ts`). Easy to miss, and
   it fails open.
2. **Sign bytes, not objects.** With `json:` the invoker hashes its own
   serialization. The spike signs the exact bytes it sends (`body:` plus an
   explicit `content-type`) so the server-side digest check is unambiguous.
3. **No replay protection beyond a time window.** An invocation is valid for
   600 seconds by default and carries no nonce. A captured request can be
   replayed inside that window. Boop's mutations would need to be idempotent
   for agents or keep a short-lived table of seen signatures.
4. **Local dev needs Node 22 or 24** for `"use node"` deploys. With Node 26
   on PATH the local backend refused the push
   (`DeploymentNotConfiguredForNodeActions`). This is a property of the local
   backend, not of the zCap code, and the repo already has `"use node"` files.
5. **Narrower grants must be parented on the owner's root.** ezcap's default
   for `delegate({ invocationTarget })` is a root derived from that target, so
   a list-scoped zCap came out rooted at the list and was refused. Passing
   `capability: rootId` with the narrower `invocationTarget` is the working
   form (pws-client's `spaceRooted` does the same).
6. **Cavage draft 12.** The wire format is the expired HTTP Signatures draft.
   PWS says RFC 9421 is the future direction, and the libraries do not offer it
   yet. Agents written against this will need a second signer at some point.

Not tested: the real boop Convex project (its auth wrappers, schema and rate
limits), and the Digital Bazaar originals of the two HTTP-signature packages.

## Gate 3: offline verification after expiry — PASS

`bun gate3-offline.mjs`, full output in `evidence-gate3.txt`. `fetch` is
replaced with a function that counts and throws; the count stayed at 0.

### Record shape (sketch)

Version 3 of the action record. `payload` is what the agent signs, over
`SHA-256("boop.action-record/v3") || SHA-256(payload)` as in version 2. The run's record, with long values shortened
(`delegation.digest` is the SHA-256 of the canonical zCap):

```json
{
  "schema": "boop.action-record", "version": 3,
  "action": "item.created", "subject": { "listId": "k17abc" }, "after": { "name": "oat milk" },
  "author": { "did": "did:key:z6Mkm3eb…", "verificationMethod": "did:key:z6Mkm3eb…#z6Mkm3eb…" },
  "onBehalfOf": { "did": "did:webvh:QmNNF1MU…:spike.boop.test:u-spike" },
  "delegation": { "id": "urn:uuid:c917a3b4-ac0b-4c4d-80bf-f6a6416ffbf5", "digest": "85b1205e…fab52a" },
  "signedAt": 1794772583400
}
```

Stored beside it, not signed by the agent:

| Field | Content |
|---|---|
| `signature` | The agent's Ed25519 signature, multibase |
| `delegation` | The zCap chain after the root, tail last. One zCap: owner to agent |
| `receipt` | `{ payload, signature }` from Boop's service DID: `{ schema: "boop.action-receipt", version: 1, recordDigest, receivedAt, signer }`. P3 owns the real shape; the spike uses a local key |

Sizes as run: payload 603 B, zCap 1214 B, receipt 347 B. The payload signs
the zCap's digest, not the zCap, so one stored zCap can serve every record made
under it and a record cannot be re-pointed at a wider grant.

Design points the sketch settles:

- **`author` is the agent and has no `versionId`.** A did:key is its own key.
- **`onBehalfOf` has no `versionId` either.** The verifier takes the owner's
  DID state in force at the receipt time (the last log entry whose
  `versionTime` is not after `receivedAt`). An agent-chosen version would let a
  record point at whichever version suits it.
- **The root has to name the owner.** A root zCap is implied, not signed: in
  PWS the server knows who controls a URL. Offline nobody does. The spike uses
  `https://<boop>/lws/<owner DID, percent-encoded>/` as every owner's root, and
  the verifier derives the root's controller from that path segment and
  requires it to equal `onBehalfOf.did`. Without a rule like this an offline
  verifier cannot tell whose authority a zCap carries. This is boop's addition,
  not PWS.
- **The receipt time decides, not the wall clock and not `signedAt`.**

### What the verifier checks

1. Payload is canonical and matches its digest.
2. The agent's signature, with the key read from `author.did`.
3. The zCap supplied is the one the payload names (id and digest), its
   `controller` is the author, its root names `onBehalfOf.did`, its target is
   inside that root, and the action is in `allowedAction`.
4. The receipt is signed by a Boop service key the caller trusts and is for
   this record's digest.
5. `receivedAt` is not before the delegation was created, not after it
   expires, and before any revocation time the caller knows of.
6. The owner's DID at `receivedAt` lists the delegating key under
   `capabilityDelegation`, and the zCap's proof verifies with it.

Two verifiers share checks 1–5 and differ in 6:
`verifyAgentRecordWithLibs` hands the zCap to `@interop/zcap` with
`date: receivedAt`; `verifyAgentRecordMinimal` checks the `eddsa-jcs-2022`
proof by hand with `@noble` and boop's `canonicalize`. They agreed on all 16
cases.

```
== offline verification (zCap expires 2026-12-15T19:56:23Z; owner DID drops the key at 2026-11-15T19:56:26.000Z)
OK   received inside the delegation: verified
OK   verified 400 days after the zCap expired: verified
OK   …and after the owner revoked it, receipt earlier than the revocation: verified
OK   received after the revocation: received_after_revocation
OK   no receipt (D10: fails): no_receipt
OK   backdated: signedAt inside the window, received after expiry: received_after_expiry
OK   received after the owner's DID dropped the delegating key: delegation_proof: … not authorized by controller for proof purpose "capabilityDelegation".
OK   received before the DID listed the key under capabilityDelegation: delegation_proof: …
OK   payload changed after signing: digest_mismatch
OK   signed by a key that is not the author's: bad_signature
OK   another agent presents this agent's zCap: delegation_not_for_author
OK   action the zCap does not grant: action_not_delegated
OK   zCap widened after delegation: delegation_mismatch
OK   receipt from a key the verifier does not trust: bad_receipt
OK   receipt lifted from another record: receipt_for_another_record
OK   zCap for the owner's root signed by someone else: delegation_proof: …
network calls during verification: 0
```

(Each line appears twice in the evidence file, once per verifier.)

### Limits

- **This departs from PWS on purpose.** PWS-AUTHZ 5.1 verifies against the
  signer's DID document "as resolved at the time of verification", so a
  delegation stops verifying the moment its key leaves the DID. That is the
  right rule for a server deciding whether to serve a request and the wrong one
  for history: under it every agent record would fail once the owner rotated a
  key. Gate 3 passes because boop's record verifier asks "as of the receipt",
  which the zCap library allows through its `date` option. A stock PWS verifier
  would not accept these records after expiry.
- **Revocation is only as visible as boop makes it.** PWS does not define one,
  and D12 keeps no public revocation list. An offline verifier can apply a
  revocation time only if someone gives it one. Without it, a record received
  after revocation and before expiry would verify, unless the server refused to
  issue the receipt, which it does (boop enforces revocation at write time). So
  the receipt is doing two jobs: timestamp, and "boop accepted this write".
- **Everything rests on the receipt key.** Whoever holds Boop's service key can
  backdate any record into a delegation window. D11 already puts that key in
  Turnkey.
- **`versionTime` is the owner's own claim.** An owner can write DID history
  that makes their own past delegations look valid or invalid. That only
  affects records made on their own behalf.

## Library and runtime problems, in one place

| # | Problem | Fails | Where it bites |
|---|---|---|---|
| 1 | Body is not checked against the signed `Digest` | open | Convex route (P5/P6) |
| 2 | Relative key references in a did:webvh document do not match | closed | Every document loader |
| 3 | didwebvh-ts 2.8.0 cannot write `capabilityDelegation` without leaking `purpose` | n/a | P5's DID update |
| 4 | `authorDidProblems` / `authorLogProblems` reject the updated DID | closed | Every build before P2 |
| 5 | `proofHashData` refuses `capabilityChain` | closed | P5 needs its own delegation signer |
| 6 | No nonce: a request can be replayed for 600 s | open | Convex route |
| 7 | Root zCaps are not self-describing | n/a | Offline verification needs the owner-in-target rule |
| 8 | PWS verifies against the current key set | n/a | Record verifier must verify as of the receipt |
| 9 | Cavage draft 12 today, RFC 9421 later | n/a | Agent authors |
| 10 | `jsonld-signatures` is CommonJS and pulls `jsonld` in even for JCS | n/a | Bundle size |
| 11 | Churn: `@interop/pws-client` is at 0.109.0, the `@interop/*` forks were published within the last two months | n/a | Pin exact versions |

## Bundle size

`node size/measure.mjs` (esbuild, minified, ESM), `evidence-sizes.txt`:

| What | Platform | Minified | Gzipped | Largest parts |
|---|---|---|---|---|
| Verify an invocation and chain (Convex route) | browser/V8 | 271 kB | 81 kB | jsonld 88, pako 46, zcap 19, jsonld-signatures 17, rdf-canonize 17 |
| Same | node | 813 kB | 252 kB | undici 527 (pulled in by the http client) |
| Sign a delegation in the web app (ezcap + `eddsa-jcs-2022`) | browser | 260 kB | 77 kB | jsonld 88, pako 46 |
| `PwsClient` front door | browser | 326 kB | 97 kB | adds pws-client 63 |
| Sign an invocation (what an agent needs) | browser | 59 kB | 20 kB | pako 46 |

- About a third of the verifier and the delegation bundles is `jsonld`, which
  `eddsa-jcs-2022` never calls. It comes in through `jsonld-signatures`.
- The web app only needs the delegation path on the agent-approval screen, so
  it can be a lazy chunk. Use ezcap directly: `PwsClient` adds 20 kB gzipped of
  storage client that D5d rules out.
- The hand-written offline verifier adds no dependency: `@noble/ed25519`,
  `@noble/hashes` and `canonicalize` are already in `shared/actionRecord.ts`.

## Recommendation

**Use zCap for the delegation (D5), in this shape:**

1. **The delegation is a zCap**: `eddsa-jcs-2022`, `proofPurpose:
   capabilityDelegation`, signed by `#orig-1`, controller the agent's did:key,
   30-day `expires`, `allowedAction` = boop action types, rooted at a per-owner
   target that names the owner DID.
2. **Agents authenticate writes by invoking it over HTTP Signatures**, verified
   in the Convex V8 route with `@interop/http-signature-zcap-verify`, plus the
   body-digest check and a replay guard. This replaces #308's bearer token
   with proof of key possession on every request.
3. **Records are verified by boop's own verifier in `shared/`**, as of the
   receipt time, with the hand-written proof check. Third parties then need
   `@noble` only, not the zCap stack, and the 80 kB stays on the server and on
   one lazy client chunk.
4. **Pin exact versions** of every `@interop/*` package.

Why zCap over D5c, given both would work:

- All three gates pass, which is the bar D5a set.
- `capabilityDelegation` says what the key is doing. D5c signs a delegation
  under `assertionMethod`, the same relationship that signs Originals, and
  relies on boop's verifier to keep the two apart.
- Chain rules (attenuation, expiry inside the parent's, TTL cap, target
  prefixes) come tested from the library on the server instead of being
  written again.
- It is the format PWS, and so B3 and the Originals SDK later (D17), will
  read.

What it costs, compared with D5c:

- **A DID change per user, gated on P2 adoption (D13).** This is the real
  cost. Agents cannot launch until tolerant builds are out and adopted; D5c
  has no such wait.
- P5 has to write the DID update without didwebvh-ts's `updateDID` as it is
  (problem 3), and write a delegation signer (problem 5).
- 77–81 kB gzipped in one client chunk and in the Convex bundle.
- A young, fast-moving library family (problem 11), on an HTTP signature draft
  that will be replaced (problem 9).

**The owner's decision:** whether agents can wait for P2 adoption. If yes,
zCap. If agents must ship first, take D5c now and accept that a later move to
zCap means two delegation formats in the verifier for as long as old records
exist. Shipping D5c "for now" with a plan to migrate is the worst of the
three.

Changes this implies for the plan, if zCap is chosen:

- **P2** as scoped is right and is now on the critical path. It should accept
  `capabilityDelegation: ["#orig-1"]` exactly, and keep rejecting extra
  verification method members such as `purpose`.
- **P5** gains: the per-owner root target convention, the hand-built (or
  library-swapped) DID update, the delegation signer, and the loader that
  makes key references absolute.
- **P6** record version 3 as sketched above; the verifier resolves the owner's
  DID as of the receipt, so `onBehalfOf` carries no `versionId`.
- **P3**'s receipt must bind the record digest and carry `receivedAt`, and
  must only be issued for writes the server accepted (it is the offline stand-in
  for revocation).

## Owner actions

1. **Live Turnkey check for Gate 1.** In a signed-in dev build, call the
   existing `signChecked(backend, subOrgId, keys.assertion, bytes)` path with
   the 64 bytes a delegation produces and confirm the zCap verifies.
   Concretely: build `remoteZcapSigner({ verificationMethod: did + "#orig-1",
   signBytes })` with `signBytes` = the same closure `buildListAuthor` passes
   to `remoteKeySigner`, run `ZcapClient.delegate(...)`, and verify it against
   a copy of the DID document with `capabilityDelegation: ["#orig-1"]` added in
   memory. No DID is changed by this check. It needs a real Turnkey session,
   which the spike did not have.
2. Choose the D5 format (the decision above).
3. If zCap: decide whether P5 hand-builds the DID log entry or adopts a
   did:webvh library with a whole-document update.
