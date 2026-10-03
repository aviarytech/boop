# Feature: Server-Side Turnkey Signing

## Goal
Move Turnkey signing operations to the server so the app can sign DID documents,
verifiable credentials, and arbitrary data using Turnkey-managed keys.

## Problem
- Turnkey signing appears to require server-side execution
- @originals/sdk and @originals/auth are too large for Convex's bundle limits
- We control both packages and can optimize them

## What Needs to Sign Server-Side
1. **DID documents** — Create/update did:webvh identities
2. **Verifiable credentials** — Issue item action credentials (ResourceCreated, ResourceUpdated)
3. **Arbitrary data** — General-purpose signing with Turnkey-managed keys

## Current Client-Side Operations (to move server-side)
- `DIDManager.createDIDPeer()` — identity creation
- `CredentialManager.createResourceCredential()` — unsigned credential creation
- `CredentialManager.signCredential()` — signing with raw private key
- `CredentialManager.signCredentialWithExternalSigner()` — signing via TurnkeyDIDSigner
- `CredentialManager.verifyCredential()` — credential verification
- All @originals/auth/client Turnkey operations (wallet, signer, DID creation)

## Approach
**Convex `"use node"` actions** using `@originals/auth/server` + `@originals/sdk`.
Bundle size issue resolved in @originals/auth 1.7.1 (uses lightweight @turnkey/http ~23MB
instead of @turnkey/sdk-server ~125MB+).

Existing infrastructure:
- `convex/didCreation.ts` — already implements `createDIDWebVH` using `TurnkeyWebVHSigner`
- `convex/authInternal.ts` — handles Turnkey OTP + JWT (raw Web Crypto, no SDK needed)
- Verify flow in `convex/http.ts` already calls DID creation on login

## Acceptance Criteria
- [ ] Server can sign DID documents using Turnkey keys
- [ ] Server can issue signed verifiable credentials
- [ ] Server can sign arbitrary data
- [ ] Client no longer needs to handle private keys or Turnkey sessions for signing
- [ ] Build/lint pass
