# Public Convex function inventory (#236)

Every function a browser, native app or direct Convex client can call, classified by
how it establishes who is acting. `scripts/public-function-boundary.test.mjs` loads the
real registrations and fails when:
- a new public function is not covered by one of these classes;
- a protected function, called with validator-shaped business arguments naming real
  fixture rows, accepts an anonymous, forged-key or asserted-identity call;
- such a call reads anything beyond the credential tables, or writes, before rejecting;
- a non-public HTTP route answers such a request with anything other than 401/403, or
  writes.

Snapshot: 172 public registrations (156 actor-wrapped, 5 self-authenticating,
7 rejecting compatibility names, 4 intentionally public). HTTP routes are listed
separately below.

## 1. Actor-wrapped (156)

Defined with `actorQuery` / `actorMutation` / `actorAction` (`convex/lib/authenticated.ts`).
The wrapper resolves the actor from `authToken` (a signed JWT whose hash has a live
`accessSessions` row) or `apiKey` (an unrevoked `agentApiKeys` row), checks the declared
API scope, rejects identity-assertion fields (`userDid`, `ownerDid`, `checkedByDid`,
`legacyDid`, …) that do not match that actor, authorizes declared resources (lists,
items, anchors, accounts) and passes only declared business arguments to the handler.
Handlers attribute writes to `ctx.actor`. `ctx.actor.credential` identifies the session
row or the specific API-key row that acted. Activity rows (assignment, presence) persist it
as `activities.credential`. Resources a handler loads beyond the declared
ones (tags, comments, categories, templates, sites, grants, invitations) are checked
against the actor inside the handler.

`activity`, `assignees`, `attachments`, `billing`, `bitcoinAnchors` (reads, `anchorListState`,
`verifyAnchorState`), `categories`, `comments`, `didCreation`, `didResources`
(`checkSharedItem`, `uncheckSharedItem`), `feedback`, `invitations`, `itemCategories`,
`items` (including `*Replay`), `listGrants`, `lists` (including `*Replay`), `notes`,
`notificationActions.sendPushNotification`, `notifications`, `originals`, `presence`,
`publication` (except `getPublicList`), `referrals`, `siteActions`, `siteAssets`, `sites`,
`tags`, `templates` (except `getPublicTemplates`), `users` (except `getUsersByDids`).

## 2. Self-authenticating (5)

| Function | Identity source |
|---|---|
| `actorSession.establish` | Verifies the JWT signature; records only its hash. Proves possession of a token, never a DID. |
| `actorSession.revoke` | Requires the raw token being revoked. |
| `auth.getUserByTurnkeyId`, `auth.getUserByEmail`, `auth.upsertUser` | `requireSession`; arguments must equal the session's sub-org/email; `upsertUser` cannot link a new current or legacy DID. Compatibility names (AUTH-COMPAT-RETIREMENT). |

## 3. Rejecting compatibility names (7)

`authSessions.createSession|getSession|markSessionVerified|deleteSession` and
`rateLimits.checkAndIncrement|checkStatus|cleanupExpired` throw for every caller; the
HTTP login flow uses their internal registrations (#241, #251).

## 4. Intentionally public (4)

| Function | What an anonymous caller gets |
|---|---|
| `publication.getPublicList` | Lists with an active publication only; attribution names masked (#251). |
| `templates.getPublicTemplates` | Templates their owners marked public. |
| `users.getUsersByDids` | Public display names for attribution; never emails (#251). |
| `waitlist.joinWaitlist` | Inserts the submitted email; no account or identity. |

## Made internal or removed in this change

| Was public | Now | Why |
|---|---|---|
| `bitcoinAnchors.createAnchorRecord`, `updateAnchorStatus` | internal only | A list owner or `items:write` key could record an arbitrary hash or mark an anchor `confirmed` with any txid; `verifyAnchorState` would then report it valid. |
| `activity.recordActivity` | removed | Editors could fabricate assignment/reconciliation history. No client used it. |
| `notificationActions.sendListNotification` | removed | Any editor could push arbitrary text to every member and bookmarker. Server code uses `sendListNotificationInternal`. |
| `sites.getPublicSiteByHostname` | internal | Returned the whole site and hostname rows (owner DID, Cloudflare state) for any hostname; the HTTP resolver already projects public fields for active hostnames. |
| `didResources.getPublicList`, `getPublicListItems` | internal | HTTP-only; returned whole list documents. |
| `didResources.getListById`, `getActivePublicationByListId` | replaced by internal `getPublishedListForPath` | The fallback trusted a publication's `webvhDid` to name the controller. |
| `didLogs.getDidLogByPath`, `getDidLogRecordByPath`, `getDidLogByUserDid` | internal | HTTP-only resolver lookups; `did.jsonl` stays public through the HTTP route. |

None of these names were called by any browser or native client (they appeared only in the
generated session registry), so no deployed client depends on them.

## HTTP routes

All authenticated routes call `authenticatedRequest` / `requireAuth` and then the
`.internal` registration of the same actor-wrapped operation with only the request's
credentials, so the actor is re-resolved in the transaction. API keys cannot create API
keys. Category and billing routes now return 401/403 for credential failures instead of
500. Unauthenticated routes: OTP `/auth/initiate|verify`, Stripe webhook (signature),
`/api/sites/resolve-*`, `GET /api/did/log`, `/d/*` (active publications), public-list
attachment downloads, `/health`.

`POST /api/user/updateDID` and `POST /api/user/remintDid` take the account from the JWT and
now also require the new DID to be a `did:webvh` minted at that account's own path
(`user-<first 16 of sub-org>`); `applyRemint` refuses a DID held by any other account.
