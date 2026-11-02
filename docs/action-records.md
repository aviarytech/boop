# Action records and signature boundaries

Recorded actions are written as **action records** (#237): an exact, canonical
statement of what was done, signed by the account that authorized it, with
boop's own context stored beside it, unsigned. They replace the unsigned
`vcProof` / `vcProofs` placeholders, which remain readable as historical data and
are no longer written.

| Piece | Where |
| --- | --- |
| Payload contract, canonical bytes, verifier | `shared/actionRecord.ts` (pure: no Convex, no network) |
| The one writer, and the check at receipt | `convex/lib/actionRecords.ts` `recordActions` |
| Storage and reads | `convex/actionRecords.ts`, table `actionRecords` |
| Signing on the author's device | `src/lib/actionSigning.ts`, attached by `src/lib/actionSigner.ts` |
| Standalone check | `scripts/verify-action-records.mjs` |

## Custody: who signs

Decided on #244 and #286: **the author, on their own device**, never boop's
server. Each account's did:webvh (`shared/authorDid.ts`) has two Turnkey
Ed25519 keys in the account's own sub-org, both usable only through the
author's client-side Turnkey session (`docs/turnkey-custody.md`):

| Key | In the DID | Signs |
| --- | --- | --- |
| Author key `#key-0` | the only update key | DID updates, nothing else |
| Assertion key `#orig-1` | `assertionMethod`, not an update key | Originals 5 entries **and action records** |

Signing is **online-only and best-effort**. When a mutation that records
actions is sent, the device builds the payload for each action from the
arguments it is sending, signs it through the Turnkey session, and attaches the
signatures as the mutation's `signed` argument. Offline edits are signed when
the sync queue sends them (the device is online then). Without a confirmed
author DID, a live session and a clean sub-org audit, or if Turnkey fails, the
action is sent unsigned and recorded as **Unsigned**. Signing has a budget of
5 seconds for the session check and every signature in the call
(`SIGNING_BUDGET_MS`); past it the write goes out unsigned. A write never
fails, and never waits longer than that, because of signing. Routine actions are signed without a prompt; only
Originals entries show a confirmation.

API-key (agent) writes carry no signature today: the agent has no author key.
They are recorded unsigned with the key row attested (below). Delegated agent
keys in the author's DID are the follow-up in #286 (PR d).

## What the server does at receipt

`recordActions` never stores a signature over bytes it did not build. For each
action it:

1. rebuilds the version-2 payload from the mutation's own arguments and the
   authenticated actor (`ctx.actor.did`), with the key, DID version and signing
   time the envelope names;
2. requires the envelope's `verificationMethod` to be `<actor DID>#orig-1`,
   reads the DID log the server serves for that DID (`didLogs`, which
   `convex/lib/authorDidLog.ts` validated when it was stored and marked
   `author`), and takes `#orig-1`'s key at the named version;
3. verifies the Ed25519 signature over `actionRecordSigningInput(payload)`.

Outcome per record:

| Result | Stored |
| --- | --- |
| verifies | `status: "signed"`, the payload with key/version/time, `signature`, `verificationMethod`, `publicKeyMultibase`, `signedAt` |
| no signature offered for this action | `status: "unsigned"`, payload with the author DID only |
| a signature was offered and did not verify | `status: "failed"`, payload with the author DID only, `error` reason code; nothing from the envelope is kept |

Reason codes: `author_mismatch` (not this account's `#orig-1`),
`no_author_did` (the account's served DID is not an author DID),
`unknown_did_version`, `not_assertion_key`, `malformed_signature`,
`malformed_envelope`, `bad_signature`. A client whose view is stale therefore
gets a truthful `failed` record, not a rejected write.

The replay fingerprint for offline operations excludes `signed`: a retry of the
same operation carries a fresh signature (new `signedAt`) and must still be
recognized as the same operation (`convex/lib/authenticated.ts`).

## Authenticated identity

`authenticate` resolves an account from a verified, active session or API key.
The authorizing account is `did` / `userId`. `credential.kind` and
`credential.id` identify the authenticated access-session row or API-key row.
Two API keys owned by one account have distinct identities. These are opaque
identifiers, never tokens, token hashes, API keys, key hashes, Turnkey
credentials, or private signing keys.

The **signed** payload binds the author DID (which is `actor.did`; the server
refuses any other). The **credential** is boop's observation and is stored in
the attested context, unsigned: the author's device does not know its session
row id, and a signature cannot prove who was holding the credential anyway.

Caller-provided DIDs do not establish actor identity. Existing assertion
validation, resource authorization, scopes, expiry, and revocation remain in
place. API-key authentication establishes use of that credential, not which
person or software possessed it. A session does not prove personal intent.

## What is recorded

Every one of these transitions goes through `recordActions`, whether it arrives
as a single call, a batch, a template activation, a recurrence, an offline
replay, or the HTTP API:

| Action | Written by | Signed by the device |
| --- | --- | --- |
| `item.created` | `addItem` | yes |
| `item.created` | each item of `createListFromTemplate`; the next occurrence generated when a recurring item is completed | no (server-originated; `origin` attested) |
| `item.completed` | `checkItem`, `batchCheckItems` | yes |
| `item.completed` | `checkSharedItem` (DID resource toggle) | no |
| `item.reopened` | `uncheckItem`, `batchUncheckItems` | yes |
| `item.reopened` | `uncheckSharedItem` | no |
| `list.created` | `createList` (lists and notes) | yes |
| `list.created` | `createListFromTemplate` | no (`origin` attested) |
| `list.renamed` | `renameList` | yes |

A batch writes one record per item, identical in shape to the record the
individual call writes, and the device signs each one. Recording happens inside
the mutation and schedules nothing.

Not recorded: item edits other than the above, deletion, reordering, and
assignment. Minting a list's Original (on the owner's device, when the list is
opened) is recorded in the Original's own signed history, not here.

## Payload (version 2)

`payload` is stored as a string and is the exact UTF-8 text a signature covers.
It is canonical JSON per RFC 8785: object keys sorted by UTF-16 code unit, no
whitespace, strings and finite numbers as `JSON.stringify` writes them. It
contains only what the author knows when acting, so the device can build it
before the server has run anything.

```jsonc
{
  "schema": "boop.action-record",
  "version": 2,
  "action": "item.completed",
  "subject": { "itemId": "<items row id>" },
  "after": { "checked": true },
  "author": {
    "did": "did:webvh:…",                       // the account that authorized the action
    "verificationMethod": "did:webvh:…#orig-1", // present only when signed
    "versionId": "3-Qm…"                        // DID log version the key is to be read from; only when signed
  },
  "signedAt": 1700000000000                     // the author's clock; only when signed
}
```

| Action | `subject` | `after` |
| --- | --- | --- |
| `item.created` | `{ listId }` | `{ name }` |
| `item.completed` | `{ itemId }` | `{ checked: true }` |
| `item.reopened` | `{ itemId }` | `{ checked: false }` |
| `list.created` | `{ createdAt }` (the creation time the author chose) | `{ name, kind: "list" \| "note" }` |
| `list.renamed` | `{ listId }` | `{ name }` |

The subject names identifiers the author has at action time. A new list has
no Original yet (the owner's device mints it when the list is opened), so it
is named by the author's `createdAt`. The server's id for a newly created item
or list is not signed; it is attested. `author.did`
is the acting account, which on a shared list is the editor who acted, not the
list's owner.

`shared/actionRecord.ts` `clientActionChanges(mutation, args)` is the
device-side mapping from a mutation's arguments to these statements, and the
builders in `convex/lib/actionRecords.ts` are the server side. They must agree
byte for byte, which `scripts/signed-action-records.test.mjs` checks end to
end with a real author DID and a mocked Turnkey.

### Attested context (unsigned)

The row's `attested` column is canonical JSON of what boop knows and the author
did not sign (`ActionRecordAttested`):

```jsonc
{
  "occurredAt": 1700000000001,                 // server clock of the mutation
  "userId": "<users row id>",
  "credential": { "kind": "session", "id": "<accessSessions or agentApiKeys row id>" },
  "listId": "<lists row id>",
  "itemId": "<items row id>",                  // item.* actions; for item.created the id the server assigned
  "listAssetDid": "did:vh:…",                   // when the list has an Original
  "before": { "checked": false },              // prior state; null for *.created
  "checkedAt": 1700000000000,                  // item.completed: the value stored on the item, when finite
  "origin": { "kind": "recurrence", "sourceItemId": "…" }  // server-originated creations
}
```

The stored row also has `digest` (lowercase hex SHA-256 of `payload`) and
index columns `listId`, `itemId`, `ownerUserId`. The verifier requires the
index columns to agree with the payload where the payload names them.

Nothing in a record comes from a caller-supplied DID, and it never contains
tokens, token hashes, API keys or key hashes, or Turnkey identifiers.

### Signature

The signed message is 64 bytes:

```
SHA-256("boop.action-record/v2") || SHA-256(payload)
```

The prefix separates these signatures from anything else the same key signs,
including Originals entries and version-1 records (which were never signed).
`signature` is the Ed25519 signature, multibase base58btc (`z…`).
`verificationMethod` is `payload.author.verificationMethod`;
`publicKeyMultibase` (`z6Mk…`) is the key as it appears in the DID log.

### Version 1

Records written before this change carry `version: 1`: the server's own
statement with `occurredAt`, `before`, `owner` and `credential` inside the
payload. None was ever signed. They remain readable (`describeActionRecord`
reads both versions) and are shown as **Unsigned**; the verifier rejects a
version-1 record that claims to be signed with `unsupported_version`.

## Status lifecycle

| Status | Meaning |
| --- | --- |
| `signed` | Verified at receipt against the author's DID log; carries `signature`, `verificationMethod`, `publicKeyMultibase`, `signedAt` |
| `unsigned` | No signature exists: no live session, an API-key or server-originated action, or a version-1 record. Nothing is fabricated |
| `failed` | A signature was offered and did not verify; `error` holds the reason code and nothing else from the envelope is kept |
| `pending` | Reserved (understood by the UI and verifier); not written today |

## Independent verification

`verifyActionRecord(record, { resolveDidLog | trustedKeys | resolvePublicKey, expected? })`
needs only the record and the author's DID log, or keys the caller pins. It:

1. requires `status: "signed"` and a well-formed signature;
2. parses the version-2 payload, re-canonicalizes it and requires byte
   equality, then recomputes the digest;
3. requires `author.verificationMethod` to be a fragment of `author.did`, with
   `versionId` and `signedAt` present; requires the row's index columns and
   `verificationMethod` to agree with the payload, and any `expected.ownerDid`;
4. takes the key: from the DID log at `author.versionId`, where
   `author.verificationMethod` must be a `Multikey` listed in
   `assertionMethod` (`assertionKeyAt`), and/or from the caller's pinned keys
   for `author.did`; the record's own `publicKeyMultibase` only has to agree;
5. verifies the Ed25519 signature.

Rejections are specific: `not_signed`, `malformed_payload`,
`unsupported_version`, `non_canonical_payload`, `digest_mismatch`,
`binding_mismatch`, `unknown_did_version`, `not_assertion_key`,
`no_trusted_key`, `untrusted_key`, `bad_signature`.

The verifier takes the DID log **as given**. Resolving and validating a
did:webvh (every entry signed by the update keys before it, resolving to its
last entry, the author-DID shape) is the resolver's job: `didwebvh-ts` does it,
wrapped by `convex/lib/authorDidLog.ts` on the server, `src/lib/authorDid.ts`
`inspectAuthorDid` in the browser, and `scripts/verify-action-records.mjs`.

Records can be fetched with `GET /api/v1/action-records?itemId=…` or
`?listId=…` (see `API.md`) and checked outside boop:

```
# resolve each author's did.jsonl from the domain the DID names
bun scripts/verify-action-records.mjs records.json --resolve
# or supply the log, or pin a key, yourself
bun scripts/verify-action-records.mjs records.json 'did:webvh:…=author.jsonl'
bun scripts/verify-action-records.mjs records.json 'did:webvh:…=z6Mk…'
```

### Key rotation and revocation

A record names the DID version its key is to be read from, and keeps the
`verificationMethod` and `publicKeyMultibase` it was signed with. A later DID
update does not change it: the verifier reads the key at the named version, so
records signed under an earlier version keep verifying from the updated log,
and a record naming a version the log does not have is `unknown_did_version`.
Today every version of an author DID carries the same two keys
(`shared/authorDid.ts`), so this is the mechanism, not yet a rotation in use.

The `remintUserDid` migration (re-genesis onto a new DID) leaves
`actionRecords` alone. Records keep naming the old DID, whose log the old
domain or path may no longer serve; a verifier then needs that log or a pinned
key for the old DID.

Nothing in a record says when a key stopped being valid, and a holder of a
compromised key can backdate `signedAt`. boop's `occurredAt` in the attested
context narrows that only for someone who trusts boop.

## What a signature proves

A verified record proves that the `#orig-1` key of the named author DID, at
the named version, signed exactly this statement: the action, its subject, its
result, and the author's clock. Since that key is usable only through the
author's own Turnkey session, this is the author's device acting, with the
limits in `docs/turnkey-custody.md` (a compromised backend or a malicious
build of the client can subvert the session).

It does **not** prove:

- which session or API key was used, or who or what was holding it: that is
  boop's attested context, unsigned;
- that the action was permitted (authorization is enforced at write time and is
  not part of the evidence);
- when the action happened, beyond the author's own `signedAt` and boop's own
  `occurredAt`;
- the prior state, the server-assigned id of a created item or list, or the
  list an item belongs to: attested, not signed;
- that the record set is complete. Records are deleted with their item or list,
  and nothing chains them together, so an absent record proves nothing.

An **unsigned** record proves nothing cryptographically. It is boop's own
account of what happened.

## Historical compatibility

The `vcProof` / `vcProofs` schema fields and wire shape are unchanged, and
existing values are returned as before. ProvenanceInfo, query/HTTP responses and
migrations still read them. External consumers cannot be exhaustively enumerated
from this repository, so no field removal is justified. No live writer adds to
them any more.

Historical JSON wrappers without signatures are labeled **unsigned**. Opaque or
potentially genuine historical proof material is labeled **unverified** in the
action presentation, not destroyed or promoted to verified. A list's Original (its
did:vh history) and WebVH verification remain separate. A valid asset history does not prove that
an action-placeholder JSON was signed.

Do not fabricate historical signatures or alter genuine evidence's signed bytes
or historical identity bindings. The legacy DID migrations still rewrite the
placeholder wrapper fields. Action records are kept out of every rewrite path,
because their payload is signed as written.

## Identifier badges and evidence boundaries

List/note headers and compact item badges show one chip that states identifier
presence and anchor status together, e.g. **Unverified ID · not anchored**.
Identifier presence derives from `did`, not a credential/verification boolean. A
recorded DID (including an unvalidated string) is **Unverified ID** with a
neutral information icon; absence is **No ID** in headers, and the chip is hidden
in compact items when there is neither a DID nor an anchor. A DID alone does not
prove ownership, authorship, or authenticity. The chip's tooltip explains the
identifier and the anchor separately.

The public list badge (`src/components/publish/VerificationBadge.tsx`) still says
**DID (unverified)**. Displaying a supplied DID or parsing its document and
declared verification methods does not validate signatures, resolve a WebVH
history, establish trust, or verify the list. Missing, malformed, and parseable
documents have the same unverified evidence boundary.

Bitcoin anchor status remains a separate claim within the chip. The provenance
panel's Original and WebVH verification paths are separate; a verified signed
history is not action-record or personal-ownership verification.

## Presentation

`ProvenanceInfo` lists action records for an item, and list-level records for a
list, under **Action records**, separate from **Historical action records**:

| Status | Label |
| --- | --- |
| `signed`, verified in the browser | **Signed** · "Signature verified in this browser against the author's DID key, resolved from the DID's own domain." |
| `signed`, DID not resolvable here | **Signed** · "boop verified this signature when it was recorded … not independently verified here." |
| `signed`, check fails | **Signature check failed** |
| `pending` | **Pending signature** |
| `failed` | **Signing failed** (with the reason code) |
| `unsigned` | **Unsigned** |

For a signed record the browser fetches the author's `did.jsonl` from the
domain the DID names, validates it with `inspectAuthorDid` (signatures, head,
author-DID shape), and runs `verifyActionRecord` against it. Each row names the
authorizing account and, for signed records, the key fragment and DID version;
the credential used and boop's receipt time are shown separately, marked as
boop's unsigned record.

## Lifetime and deletion

Action records are deleted with their subject: an item's records when the item
is removed, a list's records when the list or its owner's account is deleted.
Records an account wrote on someone else's list stay with that list, as
`createdByDid` does.

Every toggle adds a record, so a long-lived list can hold many. Deletion removes
up to 500 in the deleting mutation and schedules `actionRecords.deleteRemaining`
for the rest, so deleting a list or item never hits Convex's per-mutation limits.

## Verification status and remaining gaps

Covered by `scripts/signed-action-records.test.mjs`,
`scripts/provenance-presentation.test.mjs` and the share-modal E2E tests:
canonical determinism and the client/server payload agreement; create,
complete, reopen, batch, recurring, template and rename flows; individual
versus batch equivalence; device-side signing with a real author did:webvh and
a mocked Turnkey, verified at receipt; every `failed` reason code, with nothing
from a bad envelope stored; session versus distinct API keys; verification from
the DID log and from pinned keys, and rejection of altered payloads,
signatures, keys, bindings, DID versions and every non-signed status; a DID
update keeping older records verifiable; reads, the HTTP export and the
standalone verifier with a DID log, a pinned key and a forged log; deletion;
the re-mint migration leaving records untouched; version-1 records staying
readable and unsigned; all rendered statuses, including a DID that cannot be
resolved and a log that does not validate.

Not done or not verified:

- **Live Turnkey.** Signing through the real session (`SIGN_RAW_PAYLOAD_V2`)
  has run only against the mock; the device checks every returned signature,
  so a wrong assumption fails closed (recorded unsigned).
- Agent (API-key) writes are unsigned until delegated agent keys exist (#286 PR d).
- No revocation or validity window for signing keys beyond the DID version.
- Records are not chained or anchored; completeness and ordering are not
  provable.
- Existing historical placeholders and version-1 records are not converted,
  and never will be signed retroactively.
- Item edits, deletions, reordering and assignment are not recorded.
- Native builds and live flows have not been exercised.
