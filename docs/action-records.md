# Action records and signature boundaries

Recorded actions are written as **action records**: an exact, canonical payload
that the authorizing account's Turnkey-held key signs asynchronously (#237).
They replace the unsigned `vcProof` / `vcProofs` placeholders, which remain
readable as historical data and are no longer written.

| Piece | Where |
| --- | --- |
| Payload contract, canonical bytes, verifier | `shared/actionRecord.ts` (pure: no Convex, no network) |
| The one writer | `convex/lib/actionRecords.ts` `recordActions` |
| Storage, reads, signer bookkeeping | `convex/actionRecords.ts`, table `actionRecords` |
| Signing | `convex/actionRecordSigning.ts` → `convex/lib/actionRecordSigner.ts` |
| Standalone check | `scripts/verify-action-records.mjs` |

## Authenticated identity

`authenticate` resolves an account from a verified, active session or API key.
The authorizing account remains `userId` / `did` for permissions compatibility.
`credential.kind` and `credential.id` identify the authenticated access-session
row or API-key row. Two API keys owned by one account have distinct identities.
These are opaque identifiers, never tokens, token hashes, API keys, key hashes,
Turnkey credentials, or private signing keys.

Caller-provided DIDs do not establish actor identity. Existing assertion
validation, resource authorization, scopes, expiry, and revocation remain in
place. API-key authentication establishes use of that credential, not which
person or software possessed it. A session does not prove personal intent.

## Historical compatibility

The `vcProof` / `vcProofs` schema fields and wire shape are unchanged, and
existing values are returned as before. ProvenanceInfo, query/HTTP responses and
migrations still read them. External consumers cannot be exhaustively enumerated
from this repository, so no field removal is justified. No live writer adds to
them any more: new lists and items simply lack the fields, and completing or
renaming leaves existing values as issued.

Historical JSON wrappers without signatures are labeled **unsigned**. Opaque or
potentially genuine historical proof material is labeled **unverified** in the
action presentation, not destroyed or promoted to verified. Existing CEL envelope
and WebVH verification remain separate. A valid asset history does not prove that
an action-placeholder JSON was signed.

Do not fabricate historical signatures or alter genuine evidence's signed bytes
or historical identity bindings. The legacy DID migrations still rewrite the
placeholder wrapper fields, and `celAssetDids` still rebuilds a legacy list's
unsigned ownership placeholder for its new asset DID (the constructor now lives
in that migration, its only remaining user). Signed action records are kept out
of every rewrite path.

## Identifier badges and evidence boundaries

List/note headers and compact item badges derive identifier presence from `did`,
not a credential/verification boolean. A recorded DID (including an unvalidated
string) is labeled **DID (unverified)** with a neutral information icon; absence
is **No DID** in headers and hidden in compact items. A DID alone does not prove
ownership, authorship, or authenticity.

The public list badge also says **DID (unverified)**. Displaying a supplied DID
or parsing its document and declared verification methods does not validate
signatures, resolve a WebVH history, establish trust, or verify the list. Missing,
malformed, and parseable documents have the same unverified evidence boundary.
Historical attribution records may still be unsigned.

Bitcoin anchor status remains separate: confirmed anchors retain their timestamp
and transaction details, pending anchors await confirmation, and missing anchors
say **Not anchored**. The provenance panel's CEL replay and WebVH verification
paths are unchanged; successful event-log verification is not action-record or
personal-ownership verification.

## Custody

Signing custody is **author-held at Turnkey**. Each record is signed by the
Ed25519 key in the authorizing account's own Turnkey sub-organization
(`users.turnkeySubOrgId`, resolved with `getEd25519Account`), through the same
server-initiated `signRawPayload` call `didCreation` uses. There is no boop
service key and no service attestation.

"Author-held" describes where the key lives, not who pressed the button. boop's
server asks Turnkey to sign on the account's behalf; the account holder does not
approve each signature. See [what a signature proves](#what-a-signature-proves).

## What is recorded

Every one of these transitions goes through `recordActions`, whether it arrives
as a single call, a batch, a template activation, a recurrence, an offline
replay, or the HTTP API:

| Action | Written by |
| --- | --- |
| `item.created` | `addItem`; each item of `createListFromTemplate`; the next occurrence generated when a recurring item is completed |
| `item.completed` | `checkItem`, `batchCheckItems` |
| `item.reopened` | `uncheckItem`, `batchUncheckItems` |
| `list.created` | `createList` (lists and notes), `copyList`, `createListFromTemplate` |
| `list.renamed` | `renameList` |

A batch writes one record per item, identical in shape to the record the
individual call writes. A mutation's records are signed by one signer run.

Not recorded: item edits other than the above, deletion, reordering,
assignment, and the items carried by `copyList` (they keep their original
attribution fields, so a creation record would claim someone else's work).

## Payload (version 1)

`payload` is stored as a string and is the exact UTF-8 text that gets signed.
It is canonical JSON per RFC 8785: object keys sorted by UTF-16 code unit, no
whitespace, strings and finite numbers as `JSON.stringify` writes them. Values
JSON cannot carry are never put in a payload.

```jsonc
{
  "schema": "boop.action-record",
  "version": 1,
  "action": "item.completed",
  "subject": {
    "listId": "<lists row id>",
    "listAssetDid": "did:cel:…",        // omitted when the list has none
    "itemId": "<items row id>"           // item.* actions only
  },
  "before": { "checked": false },        // null for *.created
  "after": { "checked": true, "checkedAt": 1700000000000 },
  "origin": { "kind": "recurrence", "sourceItemId": "…" },  // optional, *.created only
  "occurredAt": 1700000000000,           // server clock, ms
  "owner": { "did": "did:webvh:…", "userId": "<users row id>" },
  "credential": { "kind": "session", "id": "<accessSessions or agentApiKeys row id>" },
  "signer": { "did": "did:webvh:…", "custody": "turnkey", "keyType": "Ed25519" }
}
```

| Action | `before` | `after` | `origin` |
| --- | --- | --- | --- |
| `item.created` | `null` | `{ name, checked: false }` | `recurrence` + `sourceItemId`, or `template` + `source` |
| `item.completed` | `{ checked }` | `{ checked: true, checkedAt \| null }` | — |
| `item.reopened` | `{ checked }` | `{ checked: false }` | — |
| `list.created` | `null` | `{ name, kind: "list" \| "note" }` | `template` + `source`, or `copy` + `sourceListId` |
| `list.renamed` | `{ name }` | `{ name }` | — |

- `owner` is the account that owns the credential and authorized the action. On
  a shared list that is the editor who acted, not the list's owner.
- `credential` is the authenticated session row or API-key row from
  `ctx.actor.credential`. A human session and each API key of one account are
  distinct here while sharing one `owner`.
- `signer.did` always equals `owner.did`: the signature is expected under that
  account's own Turnkey-held Ed25519 key.
- `checkedAt` is the value stored on the item. The individual call takes it from
  the client (`null` here if it was not a finite number); the batch call uses the
  server clock. `occurredAt` is always the server clock.
- Nothing in the payload comes from a caller-supplied DID, and it never contains
  tokens, token hashes, API keys or key hashes, or Turnkey identifiers.

The stored row adds `digest` (lowercase hex SHA-256 of `payload`) and unsigned
index columns `listId`, `itemId`, `ownerUserId` copied from the payload.

### Signature

The signed message is 64 bytes:

```
SHA-256("boop.action-record/v1") || SHA-256(payload)
```

The prefix separates these signatures from the did:webvh proofs the same key can
sign. `signature` is the Ed25519 signature, multibase base58btc (`z…`).
`publicKeyMultibase` (Multikey, `z6Mk…`) and `verificationMethod`
(`did:key:<multikey>#<multikey>`) record the key that signed.

## Status lifecycle

```
recordActions ──► pending ──► signed
                    │  ▲
                    │  └── retry (attempts < 4)
                    ├────► failed    retries exhausted, or the record is no longer signable
                    └────► unsigned  the account has no Turnkey sub-org
recordActions ──► unsigned           same, known at write time
```

1. The mutation writes the record as `pending` and schedules
   `actionRecordSigning.sign`. It does not contact Turnkey. If the account has no
   sub-org it writes `unsigned` and schedules nothing.
2. The signer re-reads each record. It signs only if the stored payload is still
   canonical, still hashes to the stored digest, and still names the record's
   owner under that owner's current DID. It never rebuilds a payload from live
   list or item state.
3. It checks the returned signature against the looked-up key before storing it.
4. `settle` changes only `pending` records, so repeated, duplicate or late runs
   cannot re-sign or replace a stored signature.

### Availability and failure policy

- A write never fails or waits because of signing. A Turnkey outage delays
  signatures; it does not block or roll back actions.
- Transient failures (key lookup, signing request, a signature that does not
  verify) are retried after 1, 5 and 25 minutes. The fourth failure marks the
  record `failed`.
- Integrity or binding failures (`payload_integrity`, `owner_binding_changed`)
  mark the record `failed` immediately and are not retried.
- Scheduled actions run at most once. An hourly cron (`sweepStalePending`)
  re-queues records whose signer run never reported back, counting against the
  same attempt bound (`signer_unresponsive`).
- `error` holds a fixed reason code. Provider error text is never stored or
  logged.
- After an outage longer than the retry window, an operator can run the internal
  mutation `actionRecords.requeueFailed` with the affected record ids. Nothing
  re-queues failed records automatically, and `unsigned` records are not signed
  later if the account gains a sub-org.

## Independent verification

`verifyActionRecord(record, { trustedKeys | resolvePublicKey, expected? })`
needs only the record and keys the caller already trusts. It:

1. requires `status: "signed"` and a well-formed signature;
2. re-canonicalizes `payload` and requires byte equality, then recomputes the digest;
3. requires `signer.did === owner.did`, the row's index columns to match the
   payload, and any `expected` owner DID or credential to match;
4. takes the caller's trusted keys **for `payload.owner.did`** and requires the
   record's declared key to be one of them;
5. verifies the Ed25519 signature under that trusted key.

A key carried by the record is never trusted on its own. It only selects among
the caller's keys. Rejections are specific: `not_signed`, `malformed_payload`,
`non_canonical_payload`, `digest_mismatch`, `binding_mismatch`,
`no_trusted_key`, `untrusted_key`, `bad_signature`.

Records can be fetched with `GET /api/v1/action-records?itemId=…` or
`?listId=…` (see `API.md`) and checked offline:

```
bun scripts/verify-action-records.mjs records.json 'did:webvh:…=z6Mk…'
```

### Where the trusted key comes from

This is the part boop does not yet solve for outside verifiers. An account's
did:webvh is minted in the browser with a browser-held key (`src/lib/webvh.ts`),
so its DID document does **not** list the Turnkey key that signs action records.
A verifier therefore has to pin "this owner DID → this Turnkey key" by a route
it trusts: the account holder publishing the key, a lookup of the Turnkey
sub-org by someone entitled to make it, or pinning on first use and watching for
change. If the only source of the key is boop, verification shows the record is
intact and was signed by the key boop names, not that the key is the owner's.

An account whose DID is a `did:key` of that same Turnkey key is the exception:
the DID is the key, so no pin is needed.

### Key rotation

A record keeps the `verificationMethod` and `publicKeyMultibase` it was signed
with, and its payload keeps the owner DID that authorized it. Neither is
rewritten when the account's Turnkey key or DID later changes, and the
`remintUserDid` migration deliberately leaves `actionRecords` alone. A verifier
must accept the key bound at signing time, so `trustedKeys` takes a list per
owner DID: keep rotated-out keys there for as long as older records should
verify, and keep the pin under the DID the record names.

Nothing in a record says when a key stopped being valid. A verifier that learns
of a compromise must stop trusting that key itself.

## What a signature proves

A verified record proves that the Ed25519 key in the named account's Turnkey
sub-organization signed exactly this payload, and so that the payload has not
changed since. boop requested that signature after an operation authenticated by
the named session or API key.

It does **not** prove:

- personal intent, or that the account holder saw or approved the action;
- who or what was holding the session or API key;
- that the action was permitted (authorization is enforced at write time and is
  not part of the evidence);
- when the action happened, beyond boop's own clock in `occurredAt` and
  `signedAt`;
- that the record set is complete. Records are deleted with their item or list,
  and nothing chains them together, so an absent record proves nothing.

`pending`, `failed` and `unsigned` records carry no signature and prove nothing
cryptographically. They are shown as such.

## Presentation

`ProvenanceInfo` lists action records for an item, and list-level records for a
list, under **Action records**, separate from **Historical action records**:

| Status | Label |
| --- | --- |
| `signed` | **Signed (Turnkey-held owner key)** |
| `pending` | **Pending signature** |
| `failed` | **Signing failed** |
| `unsigned` | **Unsigned** |

Each row names the authorizing account and whether a signed-in session or an
API key was used. The browser re-checks every signed record. It says "signature
verified" only when the owner DID is itself a `did:key` for the signing key.
Otherwise it says the signature matches the key boop recorded and that the key
is not independently verified there. A record that fails even that check is
shown as **Signature check failed** instead of signed.

## Lifetime and deletion

Action records are deleted with their subject: an item's records when the item
is removed, a list's records when the list or its owner's account is deleted.
Records an account wrote on someone else's list stay with that list, as
`createdByDid` does.

## Verification status and remaining gaps

Covered by `scripts/signed-action-records.test.mjs` and
`scripts/provenance-presentation.test.mjs`: canonical determinism; create,
complete, reopen, batch, recurring, template, copy and rename flows; individual
versus batch equivalence; session versus distinct API keys; signing through a
stubbed Turnkey client holding a real Ed25519 key; rejection of altered payloads,
signatures, keys and bindings and of every non-signed status; retry to failed;
no-sub-org to unsigned; idempotent re-signing; the stale-pending sweep; reads,
the HTTP export and the standalone verifier; deletion; the re-mint migration
leaving records untouched; rendered statuses.

Not done or not verified:

- **Live Turnkey has not been exercised.** The signer mirrors the request the
  did:webvh signer makes (64-byte hex payload, `HASH_FUNCTION_NO_OP`), but no
  real signature has been produced or checked against a real sub-org key.
- The Turnkey key is not published in the owner's DID document, so outside
  verifiers must pin it themselves (above).
- No revocation or validity window for signing keys.
- Records are not chained or anchored; completeness and ordering are not
  provable.
- Existing historical placeholders are not converted, and never will be signed
  retroactively.
- Item edits, deletions, reordering and assignment are not recorded.
- Failed records need an operator to re-queue; there is no user-facing retry.
- Native builds and live flows have not been exercised.
