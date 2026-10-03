# boop - Specs Overview

A collaborative list-sharing app with decentralized identity (DID) and verifiable credential support.

## Current State (Working)
- OTP authentication via Turnkey
- JWT-based API auth with rate limiting
- List CRUD with categories
- Collaborator system (owner/editor/viewer roles)
- Invite links for sharing
- Offline caching (IndexedDB)
- Client-side DID identity (did:peer via @originals/sdk)
- Client-side credential signing (via @originals/sdk)
- "Shared with me" dashboard section

## Tech Stack
- **Frontend**: React 19 + Vite 7 + TypeScript + TailwindCSS v4
- **Backend**: Convex (realtime DB + HTTP actions)
- **Auth**: Turnkey OTP + JWT (via @originals/auth)
- **Identity**: DIDs (currently did:peer, target: did:webvh)
- **Credentials**: Verifiable Credentials (via @originals/sdk)
- **Deploy**: Railway (static frontend), Convex Cloud (backend)

## Key Packages (Controlled by Team)
- `@originals/sdk` — DIDManager, CredentialManager
- `@originals/auth` — Turnkey client, DID signer, wallet management

## Current Architecture Problem
All DID/credential/signing operations run client-side. Need to move Turnkey signing
server-side, but @originals packages exceed Convex's bundle size limits.
