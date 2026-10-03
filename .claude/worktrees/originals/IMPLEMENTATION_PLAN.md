# Implementation Plan

## Working Context (For Ralph)

_No active task. Pick the next item from "Next Up"._

---

## Next Up
- Remove debug DID display from Home.tsx (cleanup)
- Client-side fallback for offline credential operations

## Warnings

- [WARNING] `convex/turnkeyHelpers.ts` uses raw `@turnkey/http` client access (`turnkeyClient.client.getWalletAccounts()`) because `TurnkeyHttpClient.apiClient()` doesn't expose `getWalletAccounts` yet. If @originals/auth adds this method later, switch to the wrapper.
- [WARNING] `convex/_generated/api.d.ts` was manually edited to add `didCreation`, `credentialSigning`, and `dataSigning` modules. Run `npx convex dev` to regenerate properly.
- [WARNING] `npx convex codegen` fails with "ModulesTooLarge" (45.32 MiB > 42.92 MiB max). The `credentialSigning` module adds to the bundle. Consider optimizing imports or using tree-shaking in @originals/sdk if deploying to Convex cloud becomes blocked.
- [NOTE] Client still uses `@originals/sdk` for `createListAsset()` (did:peer generation for lists). This is local-only and doesn't require Turnkey.

## Recently Completed

- ✓ **Client simplification** — Removed client-side Turnkey/signing code:
  - Removed `TurnkeyDIDSigner`, wallet management, and `createWebvhDID` from `useAuth.tsx`
  - Removed `getSigner()` from `useCurrentUser.tsx` (was unused)
  - Updated `PublishModal.tsx` to use server-side `api.didCreation.createListDID` action
  - Added public `createListDID` action to `convex/didCreation.ts` for list publication DIDs
  - Cleaned up `src/lib/originals.ts` - removed unused `signItemActionWithSigner` and `ExternalSigner`
  - Deleted `src/lib/turnkey.ts` (no longer needed, was re-exporting from @originals/auth/client)
  - Removed `walletDid` tracking from `Home.tsx` and `useCurrentUser.tsx`
  - Updated `vite.config.ts` to not explicitly bundle `@originals/auth` (only used server-side now)
- ✓ **useAuth.tsx simplified** — Now relies entirely on server-provided DID (no client-side wallet setup). Auth flow: OTP → server creates DID → client receives DID in JWT response.
- ✓ Server-side arbitrary data signing endpoint (`convex/dataSigning.ts`) — general-purpose signing action that takes `data` (string) + `subOrgId`, signs via Turnkey's `signRawPayload`, returns hex signature + public key. Also extracted shared `convex/turnkeyHelpers.ts` with `getEd25519Account()` to deduplicate wallet lookup across `dataSigning.ts`, `credentialSigning.ts`, and `didCreation.ts`.
- ✓ Server-side credential signing action (`convex/credentialSigning.ts`) — moved `signItemActionWithSigner` to a Convex `"use node"` public action. Client components (`AddItemInput.tsx`, `ListItem.tsx`) now call `api.credentialSigning.signItemAction` via `useAction`. `subOrgId` exposed through `useCurrentUser` hook.
- ✓ Server-side DID creation with @originals/auth 1.7.1

## Backlog

- Migrate authInternal.ts from raw Web Crypto to @originals/auth/server (now that bundle works)
