# How CEL handles a large, frequently-mutated text field

Research for [#233](https://github.com/aviarytech/boop/issues/233), part of [#227](https://github.com/aviarytech/boop/issues/227). It lays the factual groundwork for [#229](https://github.com/aviarytech/boop/issues/229), which decides what a note's signature commits to and when it seals. This doc does not make that decision.

**Versions examined:** `@originals/sdk` **3.0.0-next.1** (`package.json:37`; PR #223 moved to next.0 and a later bump moved to next.1) and `@originals/cel` **0.2.0-next.1** (`node_modules/@originals/cel/package.json`). All SDK paths below are relative to `node_modules/@originals/`.

**Legend:** **[cited]** means read in source, with a path and line. **[measured]** means produced by running the real SDK (method in the appendix). **[inferred]** means my reasoning from those facts.

---

## TL;DR

1. **CEL events do not carry content, only hashes.** A post-genesis `update` event is about 720 B whatever the document size: `{resourceId, contentType, previousVersionHash, toHash, toVersion}` plus one Ed25519 proof and a `previousEvent` link. The genesis event is also about 720 B. **[cited + measured]**
2. **The envelope carries the content, and it keeps every version.** `AssetEnvelope.resources` holds the "full resource shape, inline content included", and `addResourceVersion` pushes a new full-content row on each call without pruning old ones. Envelope size is therefore about `Σ(content size of every version) + ~720 B × events`. **[cited + measured]**
3. **With a 20 KB note, every-save sealing breaks Convex's 1 MiB document limit at about 50 saves.** The measured envelope was 1,048,706 B after 50 versions and 4.1 MB after 200. The log part alone is only 146 KB at 200 events. **[measured]**
4. **Hash-only commitment is already supported and verifies.** `loadAsset` treats a resource row without `content` as a "pure reference". Removing content from old versions, or dropping old version rows entirely, still gives `verified: true`. A 200-version envelope shrinks to 166–227 KB. **[cited + measured]**
5. **The log itself cannot be compacted.** The verifier requires `events[0]` to be `create` and walks every event. The `previousLog` chunking field is passed through but never resolved or verified. The SDK has no checkpoints, snapshots, or compaction. Its only mutable-document model is the "immutable resource versions linked by hash" chain in (1). **[cited]**
6. **Today boop appends exactly one kind of event: a publish snapshot.** Genesis happens at create/copy/template. After that, the only append is `recordPublishedVersion` on publish. Item edits, renames, and checks produce no events. boop never calls `publishToWeb`, so publishing does not migrate did:cel to did:webvh. **[cited]**

---

## 1. Structure and byte cost of `AssetEnvelope` / CEL events

### Envelope shape [cited]

`sdk/dist/lifecycle/assetEnvelope.d.ts:17-40`:

| field | content |
|---|---|
| `format`, `version` | `"originals/asset"`, `1` |
| `assetDid` | the did:cel |
| `eventLog: EventLog` | "THE provenance encoding" (line 22) |
| `didDocuments` | did:cel always; did:webvh / did:btco when bound (lines 25-29) |
| `resources: AssetResource[]` | **"Full resource shape, inline content included."** (line 30) |
| `credentials?`, `unverified?` | advisory "honesty section", never trusted (lines 32-39) |

`serialize()` builds it at `sdk/dist/lifecycle/OriginalsAsset.js:179-229`. `resources: this.resources.map(r => ({ ...r }))` (line 222) copies **every** version row, content included.

`AssetResource` (`sdk/dist/types/common.d.ts:98-109`) is `{id, type, url?, content?, contentType, hash, size?, version?, previousVersionHash?, createdAt?}`. `content` is **optional**.

### Event shape [cited]

`cel/dist/types.d.ts:46-55`: `LogEntry = { type, data, previousEvent?, proof[] }`. Event types are `create | update | deactivate | migrate | transfer | rotateKey` (line 42).

For resource updates, the `data` is fixed and reference-shaped (`sdk/dist/lifecycle/OriginalsAsset.js:619-633`):

> "Reference-shaped body (#407 phase 1): the event carries the SIGNED `toHash`, never the bytes. Content lives in the resources array / serialize() envelope blobs (content-addressed store), keyed by hash. This keeps the log byte-light so it can be inscribed cheaply."

The `changes` description is **not** signed (`OriginalsAsset.js`, JSDoc of `addResourceVersion`, "it is NOT part of the signed CEL body").

A real update event produced by boop's `recordPublishedVersion` **[measured]**:

```json
{ "type": "update",
  "data": { "contentType": "application/json",
            "previousVersionHash": "a276…9600", "resourceId": "list-metadata",
            "toHash": "ce76…ee8e", "toVersion": 11 },
  "proof": [{ "type": "DataIntegrityProof", "cryptosuite": "originals-cel-ed25519-jcs-v1",
              "created": "…", "proofPurpose": "assertionMethod",
              "proofValue": "zvqq…", "verificationMethod": "did:key:z6Mk…#z6Mk…" }],
  "previousEvent": "uEiCj7y8…" }
```

A genesis `create` event carries `{controller, createdAt, name, nonce, resources:[{id, mediaType, digestMultibase}]}` plus a proof. It too holds a digest, not content.

### Byte cost [measured]

| quantity | bytes |
|---|---|
| genesis envelope (boop `createListAsset`) | **1,809** |
| of which: genesis event | 719 |
| of which: `didDocuments` | 657 |
| of which: genesis `resources` (≈80 B metadata JSON inline) | 270 |
| one `update` event | **722–724**, constant, independent of content size |
| envelope growth per version | ≈ 720 B (log) **+ full content of that version** (+ ~200 B row metadata + JSON-escaping overhead) |

**Is "~1.8KB at genesis, grows per event" (`convex/schema.ts:159-162`) accurate?** Genesis is accurate (1,809 B). "Grows per event" is true but understates the problem. Each event adds about 0.7 KB to the log **and** a full copy of the new content to `resources`. For today's lists that is small, because publish snapshots are item names. For a note, each event costs about the size of the note.

Growth series for a 20 KB note with small edits between versions:

| versions | envelope | eventLog alone | resources alone |
|---|---|---|---|
| 1 | 22,876 | — | — |
| 10 | 212,211 | — | — |
| 50 | **1,048,706** | 36,917 | 1,010,982 |
| 100 | 2,083,064 | — | — |
| 200 | 4,119,543 | 145,577 | 3,973,159 |

(2 KB note × 10 versions: 32,202 B envelope, 7,963 B log.)

## 2. Committing by hash or reference instead of inline

**Yes, at three levels:**

- **Every event is already hash-only** (see §1). Content integrity is enforced at load time, not in the log. `loadAsset` step 4b (`sdk/dist/lifecycle/LifecycleManager.js:447-477`) binds each version ≥ 2 row to a verified `update` event with the same `resourceId`/`toVersion`, requires `res.hash === toHash`, and, **only if `content` is present**, re-hashes it. Line 472-473: "a resource that omits them is a pure reference and rides on the res.hash↔toHash match above." Genesis rows get the same treatment at lines 436-446 (`if (typeof res.content === 'string')`). **[cited]**
- **CEL `ExternalReference`** (`cel/dist/types.d.ts:21-37`): `{id?, url?[], mediaType?, digestMultibase}`, documented as "Used for large resources that shouldn't be embedded in the log". Helpers `createExternalReference` / `verifyExternalReference` are in `cel/dist/ExternalReferenceManager.d.ts:32,55`. Genesis `data.resources` already uses this shape. **[cited]**
- **`addResourceVersion` itself suggests it** for bytes it cannot inline: "manage the bytes externally and reference them by hash" (`OriginalsAsset.js:482-485, 497-500`). **[cited]**

**Verified empirically [measured]:** starting from a real 200-version envelope, I
- removed `content` from every version except v1 and the latest: 227,083 B, `verifyListEnvelope` → **verified: true**;
- dropped all intermediate version rows entirely: 166,096 B → **verified: true**.

So an envelope can keep the full signed history of *which* content existed (hashes, order, signer, time) while storing the bytes of only the versions you choose. **Caveat [inferred]:** a verifier holding a pure-reference row can confirm that a version with hash H was signed at time T. It cannot reproduce the text unless someone supplies bytes that hash to H.

**Existing hash-commitment patterns in boop [cited]:**
- `items.attachments[]`: `{key, contentType, size, sha256}` with bytes in a Railway bucket (`convex/schema.ts:208-217`).
- `siteFiles` / `siteAssets`: `sha256` alongside a `bucketKey` (`convex/schema.ts:367-371, 451`), computed in `convex/siteActions.ts:237, 570-571`.
- `bitcoinAnchors.contentHash`: the SHA-256 of canonical list state, with an optional `stateSnapshot` (`convex/schema.ts:532-533`, `convex/bitcoinAnchors.ts:198-208`). This is the closest precedent: a separate, hash-only commitment to mutable list state, outside the CEL.
- The genesis resource hash in `src/lib/originals.ts:39-64` (`sha256Hex` over the metadata JSON).

Hash formats differ. `AssetResource.hash` is lowercase hex SHA-256. CEL `digestMultibase` is base64url multihash. The SDK converts between them (`publishResources`, `LifecycleManager.js:1712-1713`).

## 3. How boop creates and appends events today [cited]

`convex/originals.ts` contains no CEL logic. It is a read-only explorer query (`listOwnedOriginals`, lines 10-99). All signing is **client-side**, because only the browser holds the genesis key (`src/lib/celKeyStore.ts`, `convex/lib/listEnvelope.ts:4-6`).

**Genesis (the `create` event):** `createListAsset` (`src/lib/originals.ts:80-95`) calls `sdk.lifecycle.createAsset([buildListResource(name, creatorDid, createdAt)])` and returns `JSON.stringify(asset.serialize())`. Callers: `CreateListModal.tsx:61`, `OnboardingFlow.tsx:98`, `TemplatePickerModal.tsx:61,99`, `Templates.tsx:47,84`, `Home.tsx:117`, and `ProvenanceInfo.tsx:269` (copy). The server persists the envelope via `upsertListEnvelope` (`convex/lib/listEnvelope.ts:13-43`) from `createList` (`convex/lists.ts:144-145`), `copyList` (`lists.ts:222`), and `createListFromTemplate` (`convex/templates.ts:210-211`). The `celAssetDids` migration also wrote geneses (`convex/migrations/celAssetDidsDb.ts:58`).

**Append (the `update` event), the only one:** `recordPublishedVersion` (`src/lib/originals.ts:184-227`) loads the envelope, calls `asset.addResourceVersion("list-metadata", JSON.stringify({name, items:[{name, checked}]}), …)`, and re-serializes. It is called only from `PublishModal.tsx:76`. The result goes to `publishList` (`convex/publication.ts:54-56`) → `upsertListEnvelope`, which **overwrites the whole string** on each write (`listEnvelope.ts:24-32`). The SDK throws "Content unchanged" when an identical snapshot is re-published (`OriginalsAsset.js:583-584`), and boop maps that to a no-op (`originals.ts:214-224`).

**Changes that produce no event:** item add/edit/check/reorder/delete, `renameList` (`lists.ts:279`), category or view-mode changes, aisles, assignees, comments. None of these reference `listEnvelopes` or the SDK (grepping `convex/` and `src/` for `addResourceVersion|upsertListEnvelope` finds only the paths above). `bitcoinAnchors.anchorListState` hashes state separately and does not touch the CEL (`convex/bitcoinAnchors.ts:178-208`). **[inferred]** So a list's log today is `create` plus one `update` per distinct published state. Most lists have exactly one event.

**Per-append cost [measured]:** `recordPublishedVersion` re-runs `loadAsset`, which fully verifies the log, before every append. Append cost therefore grows with log length. 200 sequential 20 KB appends took 13.5 s in total (Node, dev laptop). A full verify of a 201-event log took **128 ms** (31 ms at 51 events, 6 ms at 11), roughly linear.

## 4. Publishing (did:cel → did:webvh) and size ceilings

**boop's publish does not migrate the DID [cited].** `src/lib/originals.ts:175-177`: "Stays on did:cel deliberately: publishToWeb would migrate the asset to did:webvh, changing its DID and moving its public URL to a content-addressed key". The `webvhDid` stored on `publications` is `buildListResourceDid(userDid, listId)`, a resource path under the *user's* DID (`PublishModal.tsx:65`), not an asset migration.

**What SDK `publishToWeb` would do if called [cited]** (`sdk/dist/lifecycle/LifecycleManager.js:1248-1370`):
- It requires `currentLayer === 'did:cel'` (line 1252). It mints a new did:webvh with an `alsoKnownAs` back-link, then appends a signed `migrate` event `{sourceDid, targetDid, layer:'webvh', domain, migratedAt}` (lines 1330-1336). The log continues; nothing is truncated.
- `publishResources` (lines 1689-1740) uploads **every resource row that has inline content** to `<did>/resources/<multibase-hash>` and skips hash-only rows with a warning (lines 1724-1730). A publish of a note with N retained versions would host N copies.
- `hostCelLog` (lines 1616-1630) hosts `cel.json` (the log only, no content) beside `did.jsonl`. `persistCelArtifacts` refreshes it after every later append (lines 1642-1673).
- The envelope gains `didDocuments['did:webvh']` (`OriginalsAsset.js:192-194`).

**Size ceilings:**
- **Convex document: 1 MiB** ([docs.convex.dev/production/state/limits](https://docs.convex.dev/production/state/limits)). `listEnvelopes.envelope` is one string on one document (`convex/schema.ts:166`), so the whole envelope must fit. Measured: a 20 KB note exceeds this at about 50 retained versions. A 100 KB note would exceed it at about 10 **[inferred, linear extrapolation]**. **[cited + measured]**
- **Convex function args / mutation writes: 16 MiB** (Node actions: 5 MiB), same source. `publishList` receives the envelope as a mutation arg, so the 1 MiB document limit binds first. **[cited]**
- **Log-only ceiling [inferred]:** at ≈720 B per event, the log alone reaches 1 MiB at about 1,450 events, with nothing else in the row.
- **Verification cost** is linear in event count (the full walk at `cel/dist/algorithms/verifyEventLog.js:1477`), measured at ~0.6 ms per event. It is paid on every `loadAsset`, including before each append. **[cited + measured]**
- **Bitcoin (if ever used) [cited]:** btco inscriptions carry the head media content plus `celLog` metadata, or a delta since the last inscribed head (`LifecycleManager.d.ts:170-178`, `LifecycleManager.js:2363-2408`). Inscription fees scale with bytes (`estimateCost`, `LifecycleManager.js:1230-1245`).

## 5. Does the SDK model a mutable document?

**Only as a hash-linked chain of immutable versions.** There are no checkpoints, snapshots, or compaction. **[cited]**

- `ResourceVersionManager` (`sdk/dist/lifecycle/ResourceVersioning.d.ts:15`) "manages the versioning of immutable resources". `getResourceVersion` / `getAllVersions` / `getResourceHistory` (`OriginalsAsset.js:510-535`) read that chain. Each version has `previousVersionHash`, and each `update` event signs the `previousVersionHash → toHash` transition.
- `mostRecentResourceHead(log)` (`cel/dist/resourceHead.d.ts:1-35`) derives the current head from the log: the last `update.toHash`, or genesis resource 0.
- **Chunking is declared but inert:** `EventLog.previousLog?: string` ("for chunking long histories", `cel/dist/types.d.ts:60-64`) is only carried forward by `appendEvent` (`cel/dist/algorithms/appendEvent.js:56-57`) and validated as a string by the serializers. `verifyEventLog` never follows it, and it rejects any log whose first event is not `create` (`verifyEventLog.js:1292-1299`). So a truncated or checkpointed log does not verify.
- Every "checkpoint" or "snapshot" string in the SDK refers to something else: `migration:checkpointed` is DID-migration rollback (`sdk/dist/migration/MigrationManager.js:265`), `BatchProgressSnapshot` is batch progress, and the btco "full celLog snapshot" is an inscription payload fallback. None of them is document compaction.
- `addResourceVersion` refuses binary input and suggests an external hash reference instead (`OriginalsAsset.js:490-500`).

## 6. Implications for sealing strategies

Everything below is **[inferred]** from the facts above unless tagged otherwise. It gives costs and what a verifier can conclude; choosing among them is #229's job.

Let C = note size, N = number of sealed versions, and E ≈ 720 B per event.

### A. Seal every save (append an `update` per save, keep inline content)
- **Cost:** the envelope is about Σ C_i + N·E. It exceeds 1 MiB after about 1 MiB / C saves (≈50 at 20 KB, **[measured]**). Autosave cadence (every few seconds) would exceed it within one editing session. Each save also pays a full-log verify plus a whole-envelope rewrite to Convex, and both grow over time. The signing key is device-local, so saves from a second device cannot seal at all (`originals.ts:192-196`, `canAuthorList`).
- **What a verifier learns:** a complete signed timeline of every saved state.
- **Viability:** not viable without dropping inline content (see D).

### B. Seal on explicit action / publish only (today's list model)
- **Cost:** N is small and user-driven. The envelope is about Σ C_i over *sealed* versions. With C = 20 KB it still reaches 1 MiB after about 50 publishes, so a heavily re-published long note has the same ceiling, just further away.
- **What a verifier learns:** "the key holder signed exactly these texts at these times." It learns nothing about drafts in between. Unsealed edits are invisible and unprovable. That is the same guarantee lists give today: item edits are not in the log.
- **Fit:** it matches existing code paths (`recordPublishedVersion`, the `publishList` flow) with almost no new machinery.

### C. Periodic checkpoint (seal every K minutes or on idle)
- **Cost:** A with a lower rate. The log grows about E per checkpoint. Envelope growth depends on retention policy: inline content hits the 1 MiB ceiling, while hash-only content grows only about 0.9 KB per checkpoint. The SDK has no native checkpoint or compaction (§5), so "checkpoint" here just means "an `update` event on a timer".
- **What a verifier learns:** coarse history at checkpoint granularity. Timing is attested by proof `created`, which the signer asserts; there is no witness unless a witness proof is added (`WitnessProof`, `cel/dist/types.d.ts:12-15`, non-gating).
- **Caveat:** the device-local key means checkpoints only happen while the owner's authoring device is active.

### D. Hash-only commitment (event per seal, content kept only for the head or chosen versions)
- **Cost:** the envelope is about N·(E + ~200 B row) + C_head. Measured: 200 versions of a 20 KB note came to **166–227 KB** and still verified **[measured]**. At about 0.9 KB per version, the 1 MiB ceiling is reached at roughly 1,000 seals. The log-only floor is about 1,450 events (§4). The bytes for old versions must live somewhere else (Railway bucket keyed by SHA-256, like attachments and site assets) or be discarded.
- **What a verifier learns:** that a version with hash H was signed at T and chained from H_prev, for every seal. It can confirm any text someone presents against its H. It **cannot** reconstruct text whose bytes were discarded. SDK `publishToWeb` would skip hosting hash-only rows (`LifecycleManager.js:1724-1730` **[cited]**), so the public copy would carry only the retained versions.
- **Composes with A/B/C:** D is a storage policy, and any sealing cadence can use it. It removes the Convex ceiling as the binding constraint for B and C. Even with D, A is still bounded by the log growing about 0.9 KB per save and by per-append verify cost that grows linearly.

### Constraints that apply to every strategy
- **Log length is permanent.** Nothing in the SDK can compact or checkpoint-truncate a CEL (§5), so every sealed event is paid for forever, in bytes and in verify time.
- **Only one resource is versioned today** (`"list-metadata"`, which holds `{name, items}`). A note would either reuse it with prose inside the JSON (the JSON-in-JSON escaping adds a few percent **[measured]**) or add a second resource id at genesis. The resource→genesis binding requires that id to exist at genesis (`LifecycleManager.js:435-438, 479-500`). Existing lists have no such resource.
- **The signer is device-local** (`src/lib/celKeyStore.ts`). Every strategy seals only from the device that minted the note. Migrated lists cannot seal at all (`isRetroactiveGenesis`, `originals.ts:256-259`).

---

## Appendix: measurement method

I bundled `src/lib/originals.ts` with esbuild (same approach as `scripts/originals.test.mjs:8-24`), shimmed `localStorage` in memory, and ran under Node:

1. `createListAsset("Note", …)` to get the genesis envelope.
2. Loop N times: change the last ~20 chars of a C-byte prose string, then `recordPublishedVersion(env, {name: text, items: []})`, then record `bytes(envelope)`.
3. `verifyListEnvelope(final)` (timed).
4. Rewrite the envelope with `content` removed from intermediate versions, and separately with intermediate rows dropped, then re-verify each.

Runs: (C = 2 KB, N = 10), (20 KB, 50), (20 KB, 200). All final envelopes verified `true`, including both stripped variants. Sizes are UTF-8 byte lengths of `JSON.stringify` output.
