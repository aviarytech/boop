# Action records and signature boundaries

The signing custody decision for #237 is pending. This foundation does not change
the current `vcProof` / `vcProofs` writers into cryptographic signers.

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

`vcProof` / `vcProofs` remain unchanged on the wire. ProvenanceInfo, query/HTTP
responses and migrations depend on them. External consumers cannot be
exhaustively enumerated from this repository, so no field removal is justified.

Historical JSON wrappers without signatures are labeled **unsigned**. Opaque or
potentially genuine historical proof material is labeled **unverified** in the
action presentation, not destroyed or promoted to verified. Existing CEL envelope
and WebVH verification remain separate. A valid asset history does not prove that
an action-placeholder JSON was signed.

Do not fabricate historical signatures or alter genuine evidence's signed bytes
or historical identity bindings. Current legacy DID migrations rewrite wrapper
fields; the replacement must keep signed evidence out of those rewrite paths.
This foundation does not change those migrations.

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

## Custody and verification requirements still awaiting selection

Service attestations must say that boop observed an authenticated operation. They
must not claim an author-held signature or personal authorship. Author-held
cross-device note sealing belongs to #244.

Independent service-attestation verification must require an externally pinned
issuer key. A key supplied only by the record establishes mathematical
consistency, not that boop issued it. Rotation requires retaining trusted
historical public keys with an explicit trust policy. Never include secrets in
payloads, envelopes, exports, or logs.

Availability behavior must be selected with custody. Synchronous signing can
make key loss or configuration failure reject otherwise valid writes.
Asynchronous signing requires durable pending records, retries, truthful status,
and exact persisted payload/binding checks at signing time. Neither behavior has
been enabled while this product/deployment choice is pending.

The installed Originals SDK 4.0.0 exposes local CEL creation and cold envelope
loading through `@originals/sdk/v3`. It can bind exact UTF-8 resource bytes through
a signed resource digest. The existing Turnkey WebVH adapter is Node/network-only
and cannot simply be called inside a Convex mutation. Existing browser CEL keys
are not server-held.

## Current verification and gaps

Tests exercise credential distinction/revocation and rendered historical
unsigned/unverified presentation, header/compact/public identifier badges, and
separate anchor states. Local Originals tests exercise genuine CEL verification
and tamper rejection. Signed recording, independent signature
verification, individual/batch history parity, recurring records, key rotation,
and signing-availability behavior remain unimplemented pending custody. Native
and live flows have not been exercised. No live Convex operations are required
or authorized for this work.
