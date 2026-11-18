# Agent enrollment codes

Plan: `plans/002-agent-signing-decisions.md` (D14, Track A row P4), issue #286.

An agent will need a one-time code from Settings in its access request. Without
one, anyone could post access requests to any user's storage, and the owner
would have to pick the real one out of the queue. With one, only an agent the
owner started can ask at all.

This change (P4) adds the codes. **Nothing consumes them yet**, and the feature
is off by default.

## What P5 will do

P5 (`feat/agent-delegation`) adds the agent access request. It will:

- require a `code` in every access request, with no code-less path;
- call `internal.agentEnrollment.redeemEnrollmentCode({ code })` before it
  creates the request, and refuse the request when that returns `null`;
- take the storage owner from the redeemed code (`ownerId`, `ownerDid`), not
  from anything the agent sends;
- rate-limit redemption attempts per IP itself. The endpoint is
  unauthenticated, and `redeemEnrollmentCode` has no limit of its own.

## The code

`BOOP-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`: a prefix and 25 characters of Crockford
base32 (no `I`, `L`, `O` or `U`), drawn from the CSPRNG, so 125 bits. Reading
is forgiving: case, spaces and hyphens don't matter, `I` and `L` read as `1`,
and `O` reads as `0`. The helpers are in `shared/enrollmentCode.ts`.

| Rule | Value | Constant |
|---|---|---|
| Lifetime | 15 minutes | `ENROLLMENT_CODE_TTL_MS` |
| Unused codes per account | 5 | `MAX_ACTIVE_ENROLLMENT_CODES` |
| Mints per account | 10 an hour | `RATE_LIMITS.enrollmentCodeMint` |
| Kept after expiry | 1 day | `ENROLLMENT_CODE_RETENTION_MS` |

## Server (`convex/agentEnrollment.ts`)

The `agentEnrollmentCodes` table stores `ownerId`, `codeHash` (SHA-256 of the
canonical code), `label`, `createdAt`, `expiresAt` and `redeemedAt`. The code
itself is never stored. It is returned once, by the mint.

| Function | Who | What |
|---|---|---|
| `mintEnrollmentCode({ label? })` | signed-in owner | Returns `{ id, code, label, createdAt, expiresAt }`. An action, so the code comes from the runtime's CSPRNG. Refused at the cap, over the mint budget, or when the server switch is off. |
| `listEnrollmentCodes()` | signed-in owner | The owner's codes that can still be redeemed. No code, no hash. |
| `revokeEnrollmentCode({ codeId })` | signed-in owner | Deletes an unredeemed code. |
| `redeemEnrollmentCode({ code })` | internal | Returns `{ ownerId, ownerDid, codeId, label }` and marks the code redeemed, or returns `null`. |

- **Redemption is one transaction.** It checks that the code exists, hasn't
  expired and hasn't been redeemed, then sets `redeemedAt`. Two redemptions of
  the same code can't both succeed.
- **Every failed redemption returns `null`**: unknown, malformed, expired,
  revoked, already used, or an owner whose account is being deleted. A caller
  can't tell these apart.
- **The owner is the account's current DID**, read at redemption, so a code
  minted before a DID re-mint still names its owner.
- **Only a signed-in session** mints, lists or revokes. An API key gets
  `Resource unavailable`, so an agent can't enroll another agent.
- **A refused mint spends no budget.** The cap and the rate limit are checked
  in the transaction that stores the code.
- **Cleanup.** An hourly cron deletes codes a day past expiry. Account deletion
  erases the account's codes.

## Flags

boop has no feature-flag service, so this uses two env switches. Both are off
unless set to exactly `true`.

| Switch | Where | Effect when off |
|---|---|---|
| `VITE_AGENT_ENROLLMENT_CODES` | build-time, `src/lib/featureFlags.ts` | Settings has no "Agents" section. |
| `AGENT_ENROLLMENT_CODES` | Convex env var | `mintEnrollmentCode` refuses with "Agent enrollment isn't available yet." |

Listing, revoking and redeeming don't check the server switch, so codes minted
while it was on stay manageable after it is turned off.

## Settings

With the build flag on, Settings shows an "Agents" section
(`src/components/AgentEnrollmentCode.tsx`): an optional label and "Create
code", then the code with a Copy button and a countdown. The code is held only
in the component, so it is gone once Settings closes. Other unused codes are
listed by label and time left, each with Revoke.

## Tests

- `scripts/agent-enrollment-codes.test.mjs`: format, mint, hash-only storage,
  redeem, double redeem, expiry, revoke, cap, rate limit, session-only access,
  the server switch and cleanup.
- `scripts/agent-enrollment-code-ui.test.mjs`: the build flag and the Settings
  section.
