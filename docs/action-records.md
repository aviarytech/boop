# Action records and signature boundaries

Recorded actions are written as **action records**: an exact, canonical payload
naming the account and credential that authorized the action (#237). Records are
stored **unsigned** for now. Who holds the signing key, and whether the account
holder must be present to sign, is still being decided (#244), so no signer is
wired up and nothing claims a signature. They replace the unsigned `vcProof` / `vcProofs` placeholders, which remain
readable as historical data and are no longer written.

| Piece | Where |
| --- | --- |
| Payload contract, canonical bytes, verifier | `shared/actionRecord.ts` (pure: no Convex, no network) |
| The one writer | `convex/lib/actionRecords.ts` `recordActions` |
| Storage and reads | `convex/actionRecords.ts`, table `actionRecords` |
| Signing | Not implemented yet; see [Custody](#custody) |
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
action presentation, not destroyed or promoted to verified. A list's Original (its
did:vh history) and WebVH verification remain separate. A valid asset history does not prove that
an action-placeholder JSON was signed.

Do not fabricate historical signatures or alter genuine evidence's signed bytes
or historical identity bindings. The legacy DID migrations still rewrite the
placeholder wrapper fields. Action records are kept out of
every rewrite path, because their payload is meant to be signed as written.

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
**DID (unverified)**. Displaying a supplied DID
or parsing its document and declared verification methods does not validate
signatures, resolve a WebVH history, establish trust, or verify the list. Missing,
malformed, and parseable documents have the same unverified evidence boundary.
Historical attribution records may still be unsigned.

Bitcoin anchor status remains a separate claim within the chip: confirmed anchors
say **anchored** and retain their timestamp and transaction details, pending
anchors say **anchoring**, and missing anchors say **not anchored**. The provenance panel's Original and WebVH verification
paths are separate; a verified signed history is not action-record or
personal-ownership verification.

## Custody

Undecided. #244 rules out boop's parent-org Turnkey API key signing as a user
without the user present, which is what a server-initiated `signRawPayload` in
the account's sub-org would be. Until the replacement model lands:

- every record is written with `status: "unsigned"`;
- the payload carries no `signer` or custody field, so stored bytes make no
  claim about a key that does not exist yet;
- the schema, verifier and provenance UI already understand `pending`, `signed`
  and `failed`, so a signer can be added without changing them.

Records written now will not be signed retroactively under an author-present
model, because the author is no longer present for them.

## What is recorded

Every one of these transitions goes through `recordActions`, whether it arrives
as a single call, a batch, a template activation, a recurrence, an offline
replay, or the HTTP API:

| Action | Written by |
| --- | --- |
| `item.created` | `addItem`; each item of `createListFromTemplate`; the next occurrence generated when a recurring item is completed |
| `item.completed` | `checkItem`, `batchCheckItems`, `checkSharedItem` (DID resource toggle) |
| `item.reopened` | `uncheckItem`, `batchUncheckItems`, `uncheckSharedItem` (DID resource toggle) |
| `list.created` | `createList` (lists and notes), `createListFromTemplate` |
| `list.renamed` | `renameList` |

A batch writes one record per item, identical in shape to the record the
individual call writes. Recording happens inside the mutation and schedules
nothing, so it cannot fail or delay the write.

Not recorded: item edits other than the above, deletion, reordering, and
assignment.

## Payload (version 1)

`payload` is stored as a string and is the exact UTF-8 text a signature covers.
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
    "listAssetDid": "did:vh:…",         // omitted when the list has none
    "itemId": "<items row id>"           // item.* actions only
  },
  "before": { "checked": false },        // null for *.created
  "after": { "checked": true, "checkedAt": 1700000000000 },
  "origin": { "kind": "recurrence", "sourceItemId": "…" },  // optional, *.created only
  "occurredAt": 1700000000000,           // server clock, ms
  "owner": { "did": "did:webvh:…", "userId": "<users row id>" },
  "credential": { "kind": "session", "id": "<accessSessions or agentApiKeys row id>" }
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

The prefix separates these signatures from anything else the same key signs. `signature` is the Ed25519 signature, multibase base58btc (`z…`).
`publicKeyMultibase` (Multikey, `z6Mk…`) and `verificationMethod`
(`did:key:<multikey>#<multikey>`) record the key that signed.

## Status lifecycle

| Status | Meaning | Written today |
| --- | --- | --- |
| `unsigned` | No signature exists | Yes, for every record |
| `pending` | Awaiting a signature | No |
| `signed` | Carries `signature`, `publicKeyMultibase`, `verificationMethod`, `signedAt` | No |
| `failed` | Signing did not complete; `error` holds a non-secret reason code | No |

Whatever signer is added must sign only the stored bytes, never a payload
rebuilt from live list or item state, and must check that they still hash to
`digest`.

## Independent verification

`verifyActionRecord(record, { trustedKeys | resolvePublicKey, expected? })`
needs only the record and keys the caller already trusts. It:

1. requires `status: "signed"` and a well-formed signature;
2. re-canonicalizes `payload` and requires byte equality, then recomputes the digest;
3. requires the row's index columns to match the payload, and any `expected`
   owner DID or credential to match;
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

Unsolved, and tied to the custody decision. An account's did:webvh is minted in
the browser with a browser-held key (`src/lib/webvh.ts`), so a verifier can only
take a signing key from that DID document if the signing key is listed there.
Otherwise it has to pin "this owner DID → this key" by a route it trusts. If the
only source of the key is boop, verification shows the record is intact and was
signed by the key boop names, not that the key is the owner's.

An account whose DID is a `did:key` of the signing key is the exception: the DID
is the key, so no pin is needed.

### Key rotation

A record keeps the `verificationMethod` and `publicKeyMultibase` it was signed
with, and its payload keeps the owner DID that authorized it. Neither is
rewritten when the account's key or DID later changes, and the
`remintUserDid` migration deliberately leaves `actionRecords` alone. A verifier
must accept the key bound at signing time, so `trustedKeys` takes a list per
owner DID: keep rotated-out keys there for as long as older records should
verify, and keep the pin under the DID the record names.

Nothing in a record says when a key stopped being valid. A verifier that learns
of a compromise must stop trusting that key itself.

## What a signature proves

No record is signed today, so action records currently prove nothing
cryptographically. They are boop's own account of what happened, and are shown
as **Unsigned**.

Once a signer exists, a verified record will prove that the named key signed
exactly this payload, and so that it has not changed since. What else it proves
depends on the custody model. Even then it does **not** prove:

- who or what was holding the session or API key;
- that the action was permitted (authorization is enforced at write time and is
  not part of the evidence);
- when the action happened, beyond boop's own clock in `occurredAt` and
  `signedAt`;
- that the record set is complete. Records are deleted with their item or list,
  and nothing chains them together, so an absent record proves nothing.

## Presentation

`ProvenanceInfo` lists action records for an item, and list-level records for a
list, under **Action records**, separate from **Historical action records**:

| Status | Label |
| --- | --- |
| `signed` | **Signed** |
| `pending` | **Pending signature** |
| `failed` | **Signing failed** |
| `unsigned` | **Unsigned** |

Only **Unsigned** occurs today. Each row names the authorizing account and whether a signed-in session or an
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

Every toggle adds a record, so a long-lived list can hold many. Deletion removes
up to 500 in the deleting mutation and schedules `actionRecords.deleteRemaining`
for the rest, so deleting a list or item never hits Convex's per-mutation limits.

## Verification status and remaining gaps

Covered by `scripts/signed-action-records.test.mjs`,
`scripts/provenance-presentation.test.mjs` and the share-modal E2E tests:
canonical determinism; create, complete, reopen, batch, recurring, template,
copy and rename flows; individual versus batch equivalence; session versus
distinct API keys; every record written unsigned with nothing scheduled;
verification of records signed with a test key, and rejection of altered
payloads, signatures, keys and bindings and of every non-signed status; reads,
the HTTP export and the standalone verifier; deletion; the re-mint migration
leaving records untouched; all four rendered statuses.

Not done or not verified:

- **No signer.** Signing waits on the custody follow-up from #244.
- Where an outside verifier gets the signing key from is unsolved (above).
- No revocation or validity window for signing keys.
- Records are not chained or anchored; completeness and ordering are not
  provable.
- Existing historical placeholders are not converted, and never will be signed
  retroactively.
- Item edits, deletions, reordering and assignment are not recorded.
- Native builds and live flows have not been exercised.
