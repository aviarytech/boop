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
| Edit sessions (one record per run of saves) | `src/lib/editSessions.ts`, `src/hooks/useEditSessionRecords.ts`; table `pendingItemEdits` |
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

## Edit sessions

A note autosaves 600 ms after each pause in typing, and an item's fields can
be saved one after another. Recording and signing every save would bury the
record of what the author actually did. So the app records **one signed
`item.edited` per edit session**: a run of saves of one item by one account
from one device.

**Saves are not delayed.** Each `updateItem` is sent and applied at once, as
before. Only the record waits.

1. The device gives every save of the item the same `editSession` id (a random
   UUID) and does not sign it.
2. `updateItem` applies the save and, instead of writing a record, adds it to
   the session's row in `pendingItemEdits` (per item, account and session id):
   `after` takes each field's latest value, `before` keeps the value each field
   had when the session first touched it. This row is working state, not
   evidence, and is never returned by a read.
3. When the session ends, the device signs the session's final `after` once
   and calls `recordItemEdit({ itemId, editSession, signed })`. The server
   builds the payload from **its own** row, verifies the signature against
   those bytes, writes the record through `recordActions`, and deletes the
   row.

The server never takes the device's word for what was edited: the record's
`after` is what the server applied under that session. A signature over
anything else is recorded as `failed` (`bad_signature`), like any other.

A session ends, on the device:

| When | How |
| --- | --- |
| 5 seconds after the item's last save was answered (`EDIT_SESSION_IDLE_MS`) | idle timer, restarted by each save |
| The route changes: leaving a note, an item, or a list (list switch included) | `flushEditSessions()` |
| The tab is hidden, or the page is unloading (`visibilitychange`, `pagehide`) | `flushEditSessions()`, best effort |
| The browser reports it is back online, or the account signs out | `flushEditSessions()` |

Five seconds is long enough that a pause to think stays inside one session
(autosave fires at 600 ms, plus a round trip, so anything under about two
seconds would split ordinary typing into several records), and short enough
that the record is normally written while the author is still on the page.
Closing an item's details form does not end the session by itself, because
that save is queued and sent in the background; the idle timer ends it. A
session is never closed while one of its saves is unanswered: it closes when
the answer arrives, so the record cannot race a save. A save that fails is no
part of the session on either side. Two tabs, or two accounts, editing one
item have separate sessions and separate records. If the record cannot be
sent (offline), the device keeps it and retries at the next flush, three
attempts in all.

**What can go unrecorded.** The record is written after the edit, so a crash,
a killed tab, or an unload the browser cuts short can leave the last session
open: the edit is saved, and no record of it exists yet. It is not lost for
good in the common cases:

- when the same account next edits that item, any session of theirs on it
  that has had no save for 10 minutes (`EDIT_SESSION_ABANDONED_MS`) is
  recorded then, **unsigned**, since its device never signed it;
- when the same account removes the item, their open session on it is
  recorded unsigned first, so the edit precedes the deletion.

An edit stays unrecorded if neither happens: the author never touches the item
again, or someone else removes it (another account's open session cannot be
recorded in their name, and is dropped), or the list is deleted. A record
written this way carries boop's `occurredAt` of when it was written, not of
the edit.

A save sent without `editSession` is recorded on its own, at once: the HTTP
API, and app builds from before sessions. Offline edits join a session when
the sync queue sends them, so a queue of edits to one item replayed together
becomes one record. `editSession`, like `signed`, is not part of an offline
operation's replay fingerprint.

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
| `item.edited` | `recordItemEdit`, closing an [edit session](#edit-sessions) of `updateItem` saves from the app | yes, once per session |
| `item.edited` | `updateItem` sent without a session (the HTTP API, builds from before sessions), when it sets a field an edit record covers | only if the caller signs it |
| `item.edited` | an edit session its device never closed, recorded when its author next edits or removes the item | no |
| `item.deleted` | `removeItem`; each item named in `batchDeleteItems` | yes |
| `item.deleted` | a sub-item removed with its parent by `batchDeleteItems` | no (the author named the parent; `origin` attested) |

A batch writes one record per item, identical in shape to the record the
individual call writes, and the device signs each one. Recording happens inside
the mutation and schedules nothing.

Not recorded: reordering, assignment (an `updateItem` that changes only
assignees writes no record), aisle overrides, and promoting or demoting a
sub-item. Deleting a list is not recorded either: its records go with it.
Minting a list's Original (on the owner's device, when the list is
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
| `item.edited` | `{ itemId }` | the fields the author set (below) |
| `item.deleted` | `{ itemId }` | `{ deleted: true }` |

**`item.edited`** states what the author set, not a diff the server computed:
`after` holds only the fields the author set, each with its final value, and
`null` for a field the author cleared. For an [edit session](#edit-sessions)
that is every field any of its saves set, with the value the last such save
gave it. The device can build that from the arguments it sends, offline
included, without knowing the server's state; the prior values are boop's to
attest (`before`, below).

| Field in `after` | Value |
| --- | --- |
| `name`, `url`, `groceryAisle` | the new string; `null` when cleared (`url`, `groceryAisle`) |
| `dueDate` | ms since epoch, or `null` when cleared |
| `priority` | `"high"` \| `"medium"` \| `"low"`, or `null` when cleared |
| `recurrence` | `{ frequency, interval?, nextDue?, endDate? }`, or `null` when cleared |
| `description` | `{ "sha256": "<lowercase hex SHA-256 of the UTF-8 text>" }` |

A description is named by its digest, never its text. A note body can be
50,000 characters and the record outlives the item, so the text itself would
be kept after the item is deleted.

**A verifier can confirm a description only if it already has the text.** The
record does not contain the description and it cannot be recovered from the
digest. Someone holding a candidate text (the item's current description, an
export, a copy the author gave them) hashes its UTF-8 bytes with SHA-256 and
compares; a match shows the author signed an edit that set exactly that text.
Without the text, the record shows only that the description was changed, and
by whom. Action records never hold the text, so once the description is
edited again or the item is deleted, the text behind an older digest cannot be
obtained from them. A clear flag
wins over a value sent in the same call, as it does in the mutation. A number
JSON cannot carry (`NaN`, `Infinity`) is left out of the record and does not
fail the write. `shared/actionRecord.ts` `itemEdit` is the one definition, used
by the device and the server.

**`item.deleted`** names the item by id and carries nothing else of it: no
name, no description, no prior state, signed or attested. The item's earlier
records (its creation, edits, completions) are what say what it was, and they
are kept (see [Lifetime and deletion](#lifetime-and-deletion)).

Both types use the version-2 envelope, canonicalization and signing input
unchanged. A version bump was not needed: a new `action` value is a new
statement in the same shape, and the action is inside the signed bytes, so a
signature over one action cannot be presented as another. A build from before
these types reads such a record as unreadable (`malformed_payload`) and never
as some other action.

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
  "before": { "checked": false },              // prior state; null for *.created; absent for item.deleted
  "checkedAt": 1700000000000,                  // item.completed: the value stored on the item, when finite
  "origin": { "kind": "recurrence", "sourceItemId": "…" }  // server-originated records
}
```

For `item.edited`, `before` has the same keys as the signed `after`, with the
values the item held before the edit in the same form (a description by
digest), and `null` where the field was unset. For an edit session it is each
field's value before the session's first save touched it. For a sub-item removed with its
parent, `origin` is `{ "kind": "cascade", "parentItemId": "…" }`.

The stored row also has `digest` (lowercase hex SHA-256 of `payload`) and
index columns `listId`, `itemId`, `ownerUserId`, `action`. The verifier requires
`listId` and `itemId` to agree with the payload where the payload names them.
`action` copies the payload's action so a list's deletions can be read once the
items are gone; it is not returned with the evidence, and rows written before
`item.deleted` existed do not have it.

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
`?listId=…` (see `API.md`) and checked outside boop. A deleted item cannot
authorize a read, so its records are read through its list:
`?listId=…&itemId=…` for one item's whole history, `?listId=…&deleted=true`
for the list's deletion records (`getListItemActionRecords`,
`getDeletedItemActionRecords`).

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
- that the record set is complete. Records are deleted with their list, and
  nothing chains them together, so an absent record proves nothing;
- for an edit, the text of a description: only its digest is signed, so a
  verifier who does not already have the text learns nothing about it;
- for an edit, that it changed anything, or how many saves it took: the author
  signs the final values they set in the session, and the prior values are
  attested.

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
boop's unsigned record. An **Edit record** lists the fields it changed. A
deleted item has no panel of its own, so its **Deletion record** is listed in
its list's panel under **Deleted items**, named by the end of its item id.

## Lifetime and deletion

**An item's records outlive the item.** Removing an item (`removeItem`,
`batchDeleteItems`, sub-items included) deletes none of its records and adds
an `item.deleted` record to them, so "who deleted this, and what was it" has
an answer afterwards. What stays is what was recorded while the item existed:
its name from `item.created` and from any rename, other edited values, and
description digests, never description text.

Records are deleted with their **list**: when the list is deleted, or when its
owner's account is, the records of its deleted items included. Records an
account wrote on someone else's list stay with that list, as `createdByDid`
does.

An open edit session (`pendingItemEdits`) is removed when it is recorded, when
its item is removed, and with its list or the list owner's account.

Every toggle and edit session adds a record, so a long-lived list can hold many.
Deleting a list removes up to 500 in the deleting mutation and schedules
`actionRecords.deleteRemaining` for the rest, so it never hits Convex's
per-mutation limits.

## Verification status and remaining gaps

Covered by `scripts/signed-action-records.test.mjs`,
`scripts/provenance-presentation.test.mjs` and the share-modal E2E tests:
canonical determinism and the client/server payload agreement; create,
complete, reopen, edit, delete, batch, recurring, template and rename flows;
an item's records surviving its deletion and staying readable through its
list; edit sessions (`scripts/edit-sessions.test.mjs` for the device: one
session per item, the idle timer, flushing, saves in flight, retries; the
server's merge, separate sessions per tab and account, abandoned sessions,
sessions open at deletion, and the device and server end to end); individual
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
- Reordering and assignment are not recorded.
- A crash or a cut-short unload in the middle of an edit session can leave
  that edit unrecorded, or recorded later and unsigned (see
  [Edit sessions](#edit-sessions)).
- Flushing on tab hide and page unload is best effort: a signature through
  Turnkey and a request may not finish before the browser stops the page.
- `removeItem` on an item with sub-items leaves the sub-items in place, as
  before, and records only the item removed.
- Native builds and live flows have not been exercised.
