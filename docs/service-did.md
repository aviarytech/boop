# The Boop service DID

Boop has one identity of its own: a did:webvh that countersigns **receipts**
for accepted action records (#286 P3, `plans/002-agent-signing-decisions.md`
D10 and D11). What a receipt is and what it proves is in
[action-records.md](action-records.md#receipts). This page is how the identity
is built, where its keys are, and what the owner has to do before receipts can
be turned on.

**Nothing here has been run against live Turnkey, and no service DID exists
yet.** Receipts are off (`ACTION_RECEIPTS_ENABLED` unset) until the steps below
are done and P6 turns them on.

| Piece | Where |
| --- | --- |
| DID shape, key paths, the current receipt key | `shared/serviceDid.ts` |
| Receipt format and verifier | `shared/receipt.ts` |
| Genesis and rotation (owner only) | `scripts/boop-service-did.ts`, `scripts/lib/service-did.ts` |
| Publishing the log | `convex/serviceDid.ts` `publish` (internal) |
| Signing receipts | `convex/receipts.ts`, `convex/lib/serviceReceipts.ts` |
| Turnkey policy for the signer | `docs/turnkey/boop-receipt-signer-policies.json` |

## The DID

`did:webvh:<scid>:<WEBVH_DOMAIN>:boop-service`, served like every account DID:
stored in `didLogs` (path `boop-service`, `author: false`), read from Convex
at `/d/boop-service/did.jsonl`, and proxied by the app server so it resolves
from `https://<domain>/boop-service/did.jsonl` (`didProxy.ts`). Account paths
are always `user-…`, so no account can write this one
(`convex/lib/didLogAuth.ts`).

Two Ed25519 keys, both accounts of one wallet in the Turnkey **parent** org,
which the parent can sign with server-side (it cannot sign in a user's
sub-org):

| Key | Wallet path | In the DID | Signs | Used by |
| --- | --- | --- | --- | --- |
| Update key | `m/44'/501'/0'/0'` | the only update key; not a verification method | DID log entries | the owner's script |
| Receipt key n | `m/44'/501'/<n>'/0'` | `#receipt-<n>`: the only verification method and only `assertionMethod` | receipts | Convex |

Every version of the log must have exactly this shape
(`serviceLogProblems`): one update key, one `#receipt-<n>` Multikey under
`assertionMethod` only, the two keys different, and receipt numbers that only
go up. Convex refuses to publish anything else and refuses to sign under a
served log that is anything else.

## Who can do what

| Credential | Held by | Can |
| --- | --- | --- |
| Owner (root or an admin user) | the owner's shell, for the length of one script run | create the wallet and accounts, sign DID log entries |
| Receipt signer `TURNKEY_RECEIPT_API_*` | Convex | sign with the current receipt key, nothing else |
| Auth relay `TURNKEY_API_*` | Convex | what it could before: OTP relay and sub-org creation. It still cannot sign anything |

The receipt signer is its own API-only user, so the relay user's policy
(`docs/turnkey/boop-api-user-policies.json`, which denies every signing
activity) does not change. Convex holds no code that creates keys or builds
DID log entries: `scripts/turnkey-custody.test.mjs` checks that the only
signing call in `convex/` is the receipt signer's, as the parent org.

A leaked receipt-signer credential lets its holder sign receipts with any
time, for as long as the key stays in the DID. The remedy is to delete that
API key in Turnkey and rotate the receipt key (below).

## Owner setup

Do these against a test parent org and a dev deployment first.

1. **Create the service DID.** With owner credentials for the parent org in
   the shell (not in Convex, not in a file in the repo):

   ```
   export TURNKEY_ORGANIZATION_ID=<parent org id>
   export TURNKEY_OWNER_API_PUBLIC_KEY=<an owner/admin API key>
   export TURNKEY_OWNER_API_PRIVATE_KEY=<its private key>
   bun scripts/boop-service-did.ts create --domain <WEBVH_DOMAIN>          # says what it will do
   bun scripts/boop-service-did.ts create --domain <WEBVH_DOMAIN> --yes    # does it
   ```

   This creates a wallet named `boop-service-did` with the two accounts, signs
   the genesis entry with the update key, and writes `service-did.jsonl`. Note
   the wallet ID it prints. Pass `--wallet-id` to use a wallet you made in the
   dashboard instead. Keep `service-did.jsonl`: it is public, and it is the
   input to every later rotation. A second `create` is a different DID.
2. **Create the receipt signer.** An API-only user in the parent org, not in
   the root quorum (root users bypass policies). Apply
   `docs/turnkey/boop-receipt-signer-policies.json` with its user ID and the
   two key addresses (`bun scripts/boop-service-did.ts show` prints the
   receipt key's; the update key's is the wallet's `m/44'/501'/0'/0'` account).
3. **Check the policy against the live API**, recording the activity IDs: as
   the receipt signer, `SIGN_RAW_PAYLOAD_V2` with the receipt key succeeds,
   and with the update key, or with any other key in the parent org, is
   denied; `CREATE_WALLET_ACCOUNTS` and an export are denied.
4. **Give Convex the signer** (per deployment):

   ```
   npx convex env set TURNKEY_RECEIPT_API_PUBLIC_KEY <signer public key>
   npx convex env set TURNKEY_RECEIPT_API_PRIVATE_KEY <signer private key>
   ```

   `TURNKEY_ORGANIZATION_ID` and `WEBVH_DOMAIN` are already set.
5. **Publish the log** to that deployment:

   ```
   bun scripts/boop-service-did.ts publish                 # the deployment `npx convex` points at
   bun scripts/boop-service-did.ts publish -- --prod
   ```

   It runs `npx convex run serviceDid:publish`, which accepts the log only as
   a valid did:webvh log on `WEBVH_DOMAIN` with the service shape, and only as
   a continuation of the one already served. Then check
   `https://<domain>/boop-service/did.jsonl` returns it.
6. **Try one receipt** before enabling anything:

   ```
   npx convex run receipts:signReceipt '{"recordHash":"<64 hex>","receivedAt":<ms>}'
   ```

   The action verifies the signature Turnkey returns against the served log
   before returning, so a wrong key, a denied policy or a wrong assumption
   about Turnkey's API is an error here, not a bad receipt.
7. **Record the service DID** in this file and in `API.md`, so verifiers can
   pin it.
8. **Enable** (P6, not before): `npx convex env set ACTION_RECEIPTS_ENABLED true`.
   Any other value, or none, is off.

### Rotating the receipt key

```
bun scripts/boop-service-did.ts rotate --wallet-id <wallet id> --yes
```

creates the next account, and appends a version in which `#receipt-<n+1>`
replaces `#receipt-<n>`, signed by the update key. Then, in this order: allow
the receipt signer to use the new address (update the policy), `publish`, and
remove the old address from the policy. The signer is allowed both
addresses while the log changes, so there is no window in which Convex
cannot sign.

Receipts name the log version they were signed under, so earlier receipts keep
verifying from the longer log. Rotation does not, by itself, invalidate a
receipt made with the old key: see the limits in
[action-records.md](action-records.md#receipts).

The update key is not rotated by the script. It never leaves Turnkey and is
used only by the owner; replacing it is a `updateKeys` change to make by hand
with `didwebvh-ts` if it is ever needed.

## Environment

| Variable | Where | Meaning |
| --- | --- | --- |
| `ACTION_RECEIPTS_ENABLED` | Convex | `true` requests a receipt for each newly accepted signed record. Unset by default |
| `TURNKEY_RECEIPT_API_PUBLIC_KEY`, `TURNKEY_RECEIPT_API_PRIVATE_KEY` | Convex | the receipt signer's API key |
| `TURNKEY_ORGANIZATION_ID` | Convex (existing), owner's shell | the parent org |
| `WEBVH_DOMAIN` | Convex (existing) | the only domain a published service DID may name |
| `TURNKEY_OWNER_API_PUBLIC_KEY`, `TURNKEY_OWNER_API_PRIVATE_KEY` | owner's shell only | credentials for `create` and `rotate` |

## Unvalidated

- Every Turnkey call here: `create_wallet`, `create_wallet_accounts`,
  `list_wallet_accounts` and `sign_raw_payload` in the parent org, with a
  Solana-format address as `signWith` and `HASH_FUNCTION_NOT_APPLICABLE`.
  They follow the same request shapes the client uses in a sub-org
  (`src/lib/turnkeySession.ts`) and are exercised only against a mock
  (`scripts/helpers/service-did-fixture.mjs`).
- Every expression in `boop-receipt-signer-policies.json`, `wallet_account.address`
  most of all.
- The parent org is shared with other apps (`docs/login-account-recovery.md`):
  check the receipt signer's policy does not collide with theirs.
