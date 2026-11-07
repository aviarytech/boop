# Linked Web Storage and agent auth

boop serves each user's lists as a [Linked Web Storage](https://github.com/w3c/lws-protocol)
(LWS 1.0) storage. An agent gets access by asking for it. The user approves the
request in the app, which adds the agent's key to the user's own `did:webvh`.
The agent then signs short-lived JWTs as the user, with a `kid` that names its
key, and trades them for access tokens.

Spec sources: the LWS editor's draft is assembled client-side by ReSpec, so the
published `lws10-core` page shows empty sections. Read the sources in
`w3c/lws-protocol` (`lws10-core/Operations/*.md`, `Discovery.html`,
`Authorization.html`, `lws-access-requests.html`, `lws10-authn-ssi-cid/`). A
copy is kept, unversioned, in `tmp/lws-spec/` while this is being built.

## Decisions

- **The agent's key lives in the user's DID**, as `#agent-<id>`, referenced
  from `authentication` only. It is never an update key and never in
  `assertionMethod`, so an agent can't update the DID or sign Originals as the
  author. This is #286's "agent keys" model (PR d).
- **The JWT's `sub` = `iss` = `client_id` = the user's DID.** The CID
  authentication suite requires all three to match, so the protocol sees the
  user. The `kid` (`did:webvh:…#agent-<id>`) is what tells agents apart. boop
  records it on every write.
- **Scopes stay in Convex, not in the DID.** The DID log is public. Anyone can
  see how many agent keys a user has and when they changed, but not their
  names or what they may do.
- **Reads and writes.** Items can be created, read, updated (PUT, or PATCH with
  merge-patch) and deleted. Lists can only be read for now.
- **Agent-initiated enrollment.** The agent POSTs an LWS `AccessRequest`
  naming its `did:key`. The user approves it in Settings → Agents.
- **Plan limits are the user's.** Agent writes go through the same mutations,
  so plan caps and per-list rules apply unchanged. The unauthenticated
  access-request endpoint has its own per-IP rate limit.
- **Old app builds are turned away.** Builds from before this change treat a
  DID with agent keys as invalid, so the server returns 426 to clients that
  don't declare support for agent keys.

## URLs

`B` is the Convex site URL (`CONVEX_SITE_URL`), or `LWS_BASE_URL` when set.
`{u}` is the user's DID path (`user-<16 chars>`).

| URL | What |
|---|---|
| `B/lws/{u}` | Storage description (`application/lws+cid`). Public. |
| `B/lws/{u}/` | Storage root container: the user's own lists (not notes, not lists shared with them). |
| `B/lws/{u}/{listId}/` | A list, as a container of its items. |
| `B/lws/{u}/{listId}/{itemId}` | An item, as a JSON data resource. |
| `B/.well-known/lws-configuration` | Authorization server metadata (RFC 8414). Issuer = `B`. |
| `B/.well-known/oauth-protected-resource/lws/…` | Protected resource metadata (RFC 9728). |
| `B/oauth/token` | Token endpoint (RFC 8693 token exchange). |
| `B/lws-access/requests` | `AccessRequestService`: POST an access request. |
| `B/lws-access/requests/{id}` | The agent polls its request; once approved, it includes the grant. |

## Flow

1. **Request.** The agent makes an Ed25519 key and POSTs an `AccessRequest` to
   `B/lws-access/requests`. Its `assignee` is the agent's `did:key`, `storage`
   is `B/lws/{u}`, the actions are some of `read`, `create`, `update` and
   `delete`, and the target is the storage root. A boop extension `name`
   gives a label of up to 60 characters. The request carries
   `Authorization: Bearer <JWT>`, signed by that same key, with
   `sub = iss = client_id = did:key:…` and `aud` including
   `B/lws-access/requests`; this proves the agent holds the key. The server
   assigns the fragment `agent-<id>` and returns `201` with `Location`.
   Requests expire after 24 hours. A user has at most 10 pending: an 11th
   expires the oldest pending one (see "The request queue").
2. **Approve.** The app lists the pending requests. Approving one builds a DID
   update that adds the method `#agent-<id>` (Multikey, the agent's key,
   `controller` = the DID) and references it from `authentication`. The author
   key signs it through the Turnkey session, and the app POSTs it to
   `/api/did/log`. The app then calls `approveAccessRequest`. The server
   checks that the stored log's latest version has exactly that key at that
   method in `authentication`, then creates the `lwsAgents` row. Denying is a
   mutation and nothing else.
3. **Token.** The agent polls its request until it's approved, then POSTs to
   `B/oauth/token` with
   `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`,
   `subject_token=<JWT>`,
   `subject_token_type=urn:ietf:params:oauth:token-type:jwt` and
   `resource=B/lws/{u}`. The JWT has header
   `{alg: "EdDSA", kid: "<user DID>#agent-<id>"}` and claims
   `sub = iss = client_id = <user DID>`, `aud ∋ B`, `iat`, `exp` (at most 10
   minutes after `iat`) and `jti` (each one is accepted once). The server
   reads the user's stored DID log, which was fully verified when it was
   written, and takes its latest `state`. It finds `kid` in `authentication`,
   checks the signature, and checks that the agent row is active with the same
   key. It then issues an opaque `lwsat_…` access token, stored hashed, that
   lasts 300 seconds (LWS Authorization recommends 300 or less), is bound to
   the storage, and records the actions it grants.
4. **Use.** `Authorization: Bearer lwsat_…` on storage resources. The
   resource server resolves the token to an actor whose `did` is the user's,
   whose actions are the token's (never more than the agent holds now), and
   whose credential is `{kind: "agent", id}`. Requests without a valid token get a `401` with
   `WWW-Authenticate: Bearer resource_metadata="…"` and the storage `Link`.
5. **Revoke.** The app calls `revokeAgent`, which marks the row revoked and
   deletes its tokens, and then removes the method from the DID (a DID update
   signed by the author key). If the DID update fails, the row is still
   revoked: the token endpoint and the resource server both check the row as
   well as the DID. See "App" below.

**Actions are enforced one by one.** Every storage operation checks the one
action it needs: every read (GET and HEAD on containers, items and linksets)
needs `read`; POST needs `create`; PUT and PATCH need `update` (`modify` is
the same action), and a PUT or PATCH that completes a recurring item also
needs `create`, because completing it creates the next occurrence (the
recurrence may be the item's or arrive in the same request); DELETE needs
`delete`. A missing action is `403` with
`error="insufficient_scope"`, so narrowing at approval holds. Tokens carry
the canonical actions (`read`, `create`, `update`, `delete`); a token
without recorded actions grants none.

Scopes still exist for the app's own operations that storage writes run
through: `read` → `lists:read` and `items:read`; `create`, `update`,
`delete` → `items:write`. They follow from the actions and are never what
decides an LWS request.

## The author DID rule

`shared/authorDid.ts` used to require exactly `#key-0` and `#orig-1`. It now
also allows agent methods, each of which must:

- have an id fragment matching `agent-[a-z2-7]{10}`;
- be a `Multikey` with an Ed25519 `z6Mk…` key, its `controller` the DID, and no
  members besides `id`, `type`, `controller` and `publicKeyMultibase`;
- be referenced, by id string, from `authentication` and nowhere else;
- not reuse the author, assertion or update key, or another agent's key.

`authentication` is `#key-0` followed by agent methods only. A DID can have at
most 25 agent methods. Every other rule is unchanged, and the check still
applies to every version of the log.

## App

Settings → Agents (`src/components/AgentsSettings.tsx`) lists pending
requests and approved agents (reactive `useQuery`), and shows the storage URL
to give an agent. `B` there is `VITE_LWS_BASE_URL` if set, else the Convex
site URL: a deployment that sets `LWS_BASE_URL` must set both.

**The DID update** (`src/lib/agentKeys.ts`). It always starts from a fresh
`GET /api/did/log`, checked with `inspectAuthorDid` against this account's
keys. `nextAgentDocument` gives the next state, and didwebvh-ts `updateDID`
builds the entry from it with `updateKeys` unchanged and passed explicitly
(it writes `[]` otherwise) and no other parameters. `paths` and `portable`
are genesis-only and untouched. The author key (`#key-0`) signs it through
the Turnkey session with `authorUpdateSigner`. The client checks that the new
state is exactly the planned one, appends the entry as one canonical line to
the served bytes, re-checks the whole log, and POSTs it. A 409 (another write
won the compare-and-swap) starts again from the new served log, once. A change
already in the served DID publishes nothing, so a retry needs no signature.
Afterwards the cached author (`authorIdentity.ts`) takes the new log and
`versionId`, so Originals signs at the new version with the new log as its
evidence. Other devices keep signing at their older version until they
reload; the host accepts that, since the version is in the log's history.

**Approve** = DID update, then `approveAccessRequest`. Progress shows
"Signing with Turnkey" → "Saving your DID" → "Granting access". Without a
live Turnkey session (or without an author DID confirmed this sign-in), the
app asks the user to sign in again, as Originals signing does, and changes
nothing. If the grant fails after the DID update, the error says so and
Approve retries only the grant (the DID already has the key). A pending
request whose key is already in the DID says so.

**Revoke** (after a confirm) = `revokeAgent` first, so access ends even if
Turnkey is unavailable, then the DID update that removes the key. If that
fails, the app says access has ended but the key is still in the DID. The app
compares `agentMethods(served DID)` with active agents and pending requests:
any other agent method is a revoked agent's leftover key, listed with
"Remove key from DID" to try again later.

**Old builds: 426.** Builds before this change treat a DID with agent keys
as not an author DID. `/auth/verify` now requires
`clientCapabilities: ["agent-keys"]` in the body (`shared/clientCapabilities.ts`),
which this build sends, and answers 426 with the existing "update or reload
the app" message otherwise. It is the only endpoint that issues a session:
`establish` only registers a token `/auth/verify` issued, and the 7-day
Turnkey session refresh issues no boop session. Sessions old builds already
hold keep working until they expire (30 days on the web; native sessions are
persistent until revoked). Such a build that also has a live Turnkey session
will see the DID as not an author DID and try to re-mint it; the server keeps
the account where it is (`remintDid` skips an account that already has an
author DID on the current domain), so nothing moves and its agents survive,
but that build won't sign Originals until it updates.

## Implementation notes

Where the server (phase 1) fills in what the sections above leave open:

- **`modify` is accepted as well as `update`.** The LWS access profile names
  the action `modify`; agents written to the spec send it. Both are stored
  as sent and grant the same action, `update`.
- **`name` is optional.** Spec-only agents don't send it; the label is then
  `Agent`. It is trimmed, NFC, 1–60 characters, with no control or bidi
  override characters.
- **One `AccessPolicy`, no constraints.** A request with several policies, a
  target other than the storage root, or any `constraint` is refused rather
  than partly honoured. An absent `target` means the storage root.
- **A retry gets the same request.** A second POST signed by the same key while
  its request is pending returns that request (`200`, same `Location`), not a
  new one. A key that is already an active agent gets `409`. So does a key
  that is still an agent method of the DID while no active agent or pending
  request holds it (a revoked agent whose key removal failed): the problem
  detail says to remove the key first, and Settings → Agents says "Remove
  key from DID first" next to such keys.
- **Polling is signed too.** `GET B/lws-access/requests/{id}` takes a fresh
  did:key JWT (single-use `jti`, `aud` ∋ the requests URL or the request's
  own URL). Another key's request reads as `404`. An approved request whose
  agent was revoked reads `status: "revoked"`, without the grant. The request
  is looked up and its assignee matched before the `jti` is recorded, so a
  poll of an unknown or someone else's request writes nothing.
- **The did:key JWT's `kid` is optional**; when present it must be
  `did:key:z…#z…`. The did:webvh JWT's `kid` is required and absolute.
- **`scope` at the token endpoint** may narrow the agent's actions. Each
  value is an action (`read`, `create`, `update`/`modify`, `delete`) or one of
  the agent's scopes, which keeps the actions it fully covers (`items:write`
  keeps the agent's `create`, `update` and `delete`; `items:read` alone covers
  no action). Anything beyond the agent, or a result with no action, is
  `invalid_scope`. The response's `scope` is the granted actions, e.g.
  `read create`.
- **Token endpoint errors** use only RFC 6749 §5.2 codes, plus
  `invalid_target` (RFC 8707), which RFC 8693 names for a bad `resource`. A
  bad subject token is `invalid_request` (RFC 8693 §2.2.2). The per-IP rate
  limit is `429` with `error: "invalid_request"`, a description and
  `Retry-After`; an internal failure is `500` `invalid_request`.
- **`response_types_supported` stays** in the AS metadata (`["token"]`).
  RFC 8414 §2 makes it REQUIRED, LWS Authorization requires RFC 8414
  metadata, and its example lists it. There is no authorization endpoint.
- **The `Bearer` scheme is case-insensitive** (RFC 9110 §11.1) everywhere a
  bearer credential is read, the session extractor included, so `bearer
  lwsat_…` is still an agent token and never falls back to a cookie.
- **Owner operations refuse every delegated credential**, not only those
  without `*`: an API key or agent never approves, denies or revokes.
- **Agent tokens are good on LWS storage only.** `requestCredentials`
  (`convex/lib/actor.ts`) never reads a `Bearer lwsat_…`, so on `/api/*` and
  `/d/*` it is no credential and the answer is `401`. The operation wrappers
  (`lib/authenticated.ts`), `actorSession` and `siteInternals` don't accept
  `agentToken` either, so it can't be passed to a public Convex function.
  Only the storage operations (`convex/lwsStorage.ts`) call
  `authenticateAgentToken`.
- **An agent reaches only the user's own lists.** `authorizeResources` refuses
  an agent credential every list whose `ownerDid` isn't the user's (current or
  legacy) DID, at every authority. So lists shared with, bookmarked by or
  published to the user are out of reach, even though the user can read them.
- **Approving a key already in the DID** (the DID update landed, the grant
  didn't) needs no signature: `changeAuthorAgentKey` reads the served DID
  and goes straight to the grant, without a confirmed author or a live
  Turnkey session.
- **Account deletion** erases the user's `lwsAccessTokens`,
  `lwsAccessRequests` and `lwsAgents` in its batched steps. **A DID re-mint**
  (`applyRemint`, and the paged `finishRemint`) revokes the user's agents,
  deletes their tokens and expires pending requests: the new DID lists none
  of their keys. (`agentApiKeys` are a separate, pre-existing gap: deletion
  doesn't erase them.)
- **Cleanup.** The cron (`lwsAccess.cleanupInternal`, every 15 minutes)
  expires undecided requests, deletes decided and expired requests 30 days
  after they expire, spent `jti`s and expired tokens, 200 of each at a time,
  and reschedules itself at once while any batch was full.

### The request queue

The access-request endpoint is unauthenticated: a request only proves that
its sender holds the key it names. So anyone can ask for access to any
storage. Two limits keep that cheap:

- **Per IP**, 10 requests a minute. The IP is taken from `cf-connecting-ip`,
  else the first `x-forwarded-for` value. On `*.convex.site` these may be
  set by the client, so the limit slows a casual flood but doesn't stop a
  determined one.
- **Per user**, 10 pending requests. When a new request arrives at the cap,
  the oldest pending request expires to make room: refusing new requests
  instead would let anyone fill the queue and keep the owner's real agent
  out for a day. A retry by the same key still gets its own request back.

So a flood can push the owner's request out of the queue, or bury it among
others, but not block it: the agent asks again and its request is the
newest. What protects the owner is approving only the right request.
Settings → Agents says, next to pending requests: "Only approve a request you
started just now from your own agent. Check the key fingerprint matches
what your agent printed." The fingerprint is the last 12 characters of the
key in groups of four (`shared/multikey.ts` `keyFingerprint`), which the
agent CLI prints from `keygen` and `request`.

**Open, for the owner to decide:** a one-time enrollment code, shown in the
app and given to the agent with the storage URL, would let only the owner's
own agent create a request at all. That is the stronger fix; it isn't
built.

## Storage

Served by `convex/lwsStorageHttp.ts` (routed at the `/lws/` prefix for GET,
POST, PUT, PATCH, DELETE and OPTIONS; HEAD goes to the GET route). The
operations are in `convex/lwsStorage.ts` and the pure parts are in
`convex/lib/lwsStorage.ts`.

### Resources

| URL | Type | Methods | Body |
|---|---|---|---|
| `B/lws/{u}` | storage description | GET HEAD OPTIONS | `application/lws+cid`: `StorageRoot` and `AccessRequestService` services, no `capability` |
| `B/lws/{u}/` | root `Container` | GET HEAD OPTIONS | `application/lws+json`: the user's own lists (under the current and the legacy DID), not notes, as `Container` members with `title` and `modified` |
| `B/lws/{u}/{listId}/` | list `Container` | GET HEAD POST OPTIONS | `application/lws+json`: `title`, then the items in list order as `DataResource` members with `format`, `size` and `modified`; paginated past 500 items |
| `B/lws/{u}/{listId}/{itemId}` | item `DataResource` | GET HEAD PUT PATCH DELETE OPTIONS | `application/json` (below) |
| `<any of the three above>.meta` | linkset | GET HEAD PATCH OPTIONS | `application/linkset+json`: `up`, `type` and `…#storage` links; the response's own `Link` is only the storage |

An item:

```json
{
  "id": "B/lws/{u}/{listId}/{itemId}",
  "name": "Milk", "checked": false, "checkedAt": null,
  "description": null, "dueDate": "2026-11-20T00:00:00.000Z", "url": null,
  "priority": "high", "recurrence": { "frequency": "weekly", "interval": 2 },
  "parent": null, "createdAt": "…", "updatedAt": "…"
}
```

Every member is always present, with `null` when it has no value. `id`,
`checkedAt`, `createdAt` and `updatedAt` are read-only, and so is `parent`
after creation. In a PUT or a patched document they may be left out; if
present, they must equal the current values (else `409`). Unknown members are
`400`. Dates are ISO 8601. `recurrence.interval` is an integer from 1 to 1000.

Every response carries `Allow` and the `…#storage` link, a `404` under a
storage included. Resource GET/HEAD responses also carry `ETag`,
`Last-Modified`, `Link` (`linkset`, `up` except on the root, `type`; a
linkset's own response has only the storage link), `Accept-Ranges`, and
where they apply `Accept-Patch` and `Accept-Post`. Errors are RFC 9457
problem JSON.

**The root** reads one item per list, the latest by the `items` index
`by_list_updated` (`["listId", "updatedAt"]`), for each list's `modified`;
a list with no items has its `createdAt`. It never scans a list's items, so
root members have no `size`. Its ETag changes when a list is added,
removed, renamed or gets a newer item, not on every item deletion.

**Pagination** (lws-media-type.md "Pagination"). A list with more than 500
items is paginated. The container's URI is the first page; later pages are
`…/{listId}/?page=n`, URIs clients take from the `Link` header (`first` and
`last` on every page, `prev` and `next` where they apply) and don't build.
Each page lists up to 500 members in list order, `totalItems` counts the
whole list, and each page has its own ETag. A page past the last, or a
`page` that isn't a number, is `404`. The list's items are still read whole,
as the app's own list view and `addItem` do, so a list an agent reads is no
bigger than one the app reads; the page bounds what is serialized and sent.
POST preconditions apply to the first page's ETag.

### Writes

- **POST to a list** creates an item from `application/json`; `parent` may
  name a top-level item of the same list. The answer is `201` with
  `Location`, `Content-Location`, `ETag`, the links, and the new item as the
  body, or no body when the agent hasn't `read`. `Slug` is ignored. Setting
  `checked: true` checks the item in the same transaction.
- **PUT** (`application/json`) replaces an item: a writable member that's left
  out is cleared, and `checked` defaults to `false`.
- **PATCH** takes `application/merge-patch+json` (RFC 7396) or
  `application/json-patch+json` (RFC 6902, which LWS requires). The patch
  applies to the item's JSON, and the result is validated like a PUT. PUT and
  PATCH answer `200` with the new representation and `ETag`, or `204` with
  only the `ETag` when the agent hasn't `read`. A JSON Patch `test` reads the
  item, so it needs `read` (`403` otherwise). A patch that removes a
  sub-item's `parent` (merge-patch `null`, JSON Patch `remove`) is `409`; PUT
  may leave it out. A write that changes nothing writes nothing.
- **DELETE** answers `204`. An item with sub-items is a `409`: delete those
  first.
- Writes run the app's own operations from `convex/items.ts` (`addItem`,
  `updateItem`, `checkItem`, `uncheckItem`, `removeItem`), so they behave the
  same way. Checking a recurring item creates the next one. Each write makes
  action records (unsigned), notifications and assignment rows.
- **Attribution.** `createdByDid` and `checkedByDid` are the user's DID, since
  the agent acts as the user. The action records' attested `credential` is
  `{kind: "agent", id: <lwsAgents id>}`, which names the agent and its `kid`.
  So are the `credential` fields of activity rows.
- `lastUsedAt` is set at token exchange, and by writes at most once a minute.
  Reads run as queries and don't set it.

### ETags and preconditions

The ETag of every representation is a strong validator: the first 128 bits of
the SHA-256 of its exact bytes. It doesn't rely on `updatedAt`, which older
items don't have. A container's ETag therefore changes when a member is added,
changed or deleted.

Preconditions follow RFC 9110 13.2.2: `If-Match`, then `If-Unmodified-Since`,
then `If-None-Match`, then (GET/HEAD) `If-Modified-Since`. Writes evaluate them
inside the mutation that writes, against the representation as that
transaction reads it. A concurrent write conflicts with the read, so Convex
retries the mutation, and the retry sees the new ETag and answers `412`. A
failed request throws, so nothing it did is committed. For POST, the
preconditions apply to the list container's ETag. On GET/HEAD, a match is
`304`.

`If-Match` is not required: update-resource.md says clients SHOULD send it,
so an unconditional write is accepted, and `428` is never sent.

Every response with an ETag, `412` and `416` included, is sent with
`Cache-Control: …, no-transform`. Without it, Cloudflare in front of `*.convex.site` gzips
`application/json` (items) and weakens the ETag to `W/"…"`, which `If-Match`
never matches: every conditional write after a GET was a `412` (found by the
dev e2e).

### Auth

- The description is public. Everything else takes `Authorization: Bearer
  lwsat_…`.
- With no Bearer credential (no `Authorization`, or another scheme), the
  answer is `401` with `WWW-Authenticate: Bearer resource_metadata="…"` and
  the storage `Link`. A presented bad, expired or revoked token adds
  `error="invalid_token"` (RFC 6750 §3.1). The access-request service's
  `401`s follow the same rule.
- A token issued for another storage fails the spec's audience validation, so
  it gets the same `401 invalid_token`.
- A missing action is `403` with `error="insufficient_scope"`. Every read
  needs `read`; POST `create`; PUT, PATCH, and PATCH on a linkset `update`;
  DELETE `delete`.
- A list or item that doesn't exist, isn't the user's own, is a note, or whose
  id isn't a valid Convex id for its table (`normalizeId`) is `404`. So is an
  item addressed through another list.

### Where boop departs from the spec, and why

- **Wrong-storage token → `401`, not `403`/`404`.** The Authorization
  section's audience check is a MUST with a `401`.
- **Opaque access tokens** (phase 1): the storage server looks them up, so the
  JWT signature, issuer and temporal checks don't apply.
- **Content negotiation.** Containers are only `application/lws+json`, and
  `Accept` is ignored. No Turtle or JSON-LD profile is offered, which the
  spec permits, so there is no `Vary: Accept`.
- **Pagination only past 500 items, and only on lists.** The root is never
  paginated: it holds one member per list.
- **Ranges.** A single `bytes` range is served on GET of items, linksets and
  the description (`206`, `416`, `If-Range`); HEAD ignores `Range`. Several
  ranges get the whole representation, which RFC 9110 allows. Container
  listings send `Accept-Ranges: none` and are always whole.
- **Linksets are read-only.** All links are server-managed, which metadata.md
  allows. PATCH with JSON Patch is supported, as required, but succeeds
  (`204`) only if it changes nothing; any change, including moving `up`, is
  `409`. PUT is `405`. There is no `MoveResource` capability, so the
  description advertises none.
- **No user-defined metadata.** `Link` headers on POST/PUT/PATCH are ignored,
  and `Prefer: set-linkset` is ignored, as update-resource.md allows.
- **No containers are created or changed.** POST to the root is `405`. POST to
  a list with `Link: <…lws#Container>; rel="type"` is `409`. PUT, PATCH and
  DELETE on a list are `405`.
- **Container `Last-Modified` is a lower bound.** It is the latest item or
  list time, and a deletion leaves no time behind. So `If-Modified-Since` and
  `If-Unmodified-Since` are not evaluated on containers; their ETags are
  exact. Containers are sent with `Cache-Control: private, no-cache`.
- **Root members have no `size`** (a SHOULD): it would mean serializing every
  list.
- **The storage description has no linkset.** It sits in no container.
- **No `conformsTo` on the AccessRequestService.** The LWS AccessProfile
  requires a server advertising it to support constraints (`client`, and
  more), and boop refuses every constraint and any target below the root. A
  client trusting the claim would send requests boop turns down, so the
  service doesn't claim the profile.

### curl

```sh
B=https://<deployment>.convex.site     # or LWS_BASE_URL
U=user-xxxxxxxxxxxxxxxx

# Discovery: public.
curl -s "$B/lws/$U" | jq
curl -si "$B/lws/$U/" | grep -iE '^(HTTP|www-authenticate|link)'   # 401 + challenge

# An access token, from a JWT the agent signs with its key (see Flow, step 3).
TOKEN=$(curl -s "$B/oauth/token" \
  -d grant_type=urn:ietf:params:oauth:grant-type:token-exchange \
  -d subject_token_type=urn:ietf:params:oauth:token-type:jwt \
  --data-urlencode "subject_token=$JWT" --data-urlencode "resource=$B/lws/$U" | jq -r .access_token)
H="Authorization: Bearer $TOKEN"

# The lists, and one list's items.
curl -s -H "$H" "$B/lws/$U/" | jq '.items[] | {id, title}'
LIST=$B/lws/$U/<listId>/
curl -s -H "$H" "$LIST" | jq

# Create an item.
ITEM=$(curl -si -H "$H" -H 'Content-Type: application/json' \
  -d '{"name":"Eggs","dueDate":"2026-11-20","recurrence":{"frequency":"weekly"}}' "$LIST" \
  | awk 'tolower($1)=="location:" {print $2}' | tr -d '\r')

# Check it, conditionally: the app makes next week's copy.
ETAG=$(curl -sI -H "$H" "$ITEM" | awk 'tolower($1)=="etag:" {print $2}' | tr -d '\r')
curl -si -X PATCH -H "$H" -H 'Content-Type: application/merge-patch+json' \
  -H "If-Match: $ETAG" -d '{"checked":true}' "$ITEM"
# The same ETag again is now stale: 412.
curl -si -X PATCH -H "$H" -H 'Content-Type: application/json-patch+json' \
  -H "If-Match: $ETAG" -d '[{"op":"replace","path":"/name","value":"Free-range eggs"}]' "$ITEM"

# Delete it.
ETAG=$(curl -sI -H "$H" "$ITEM" | awk 'tolower($1)=="etag:" {print $2}' | tr -d '\r')
curl -si -X DELETE -H "$H" -H "If-Match: $ETAG" "$ITEM"    # 204
```

## Agent CLI

`scripts/lws-agent.mjs` is a whole agent in one file (`@noble/ed25519` and
`fetch`). Everything it knows (its secret key, its request, its grant and a
cached access token) is in the `--state` file, written with mode 0600.
Output is JSON.

```sh
agent() { node scripts/lws-agent.mjs "$@" --state "$HOME/.boop-agent.json"; }
agent keygen                                   # a new Ed25519 key
agent request "$B/lws/$U" --name "My agent" --actions read,create,update,delete
agent status                                   # pending → approved (after Settings → Agents)
agent token                                    # discovery + token exchange
agent get "$B/lws/$U/"                         # the lists
agent create "$B/lws/$U/<listId>/" '{"name":"Eggs"}'
agent patch "$B/lws/$U/<listId>/<itemId>" '{"checked":true}'   # If-Match from a fresh HEAD
agent delete "$B/lws/$U/<listId>/<itemId>"
```

- `request` reads the storage description, takes its `AccessRequestService`
  (refusing one on another origin), and POSTs the `AccessRequest` with a
  did:key JWT (`aud` = the service URL).
- `status` polls with a fresh did:key JWT (`aud` = the request URL) and keeps
  the grant's `verificationMethod`.
- `token` discovers the token endpoint from scratch: an unauthenticated GET of
  the storage root → `401` → `resource_metadata` → its `authorization_servers`
  → `/.well-known/lws-configuration`. It makes the client's discovery
  validation checks (LWS Authorization): the metadata URL has the requested
  URI's origin, the metadata's `resource` is exactly the requested URI, and
  the `StorageRoot` of the storage in the `Link` header has that origin too.
  It also requires the configuration's `issuer` to be the one named (RFC 8414
  3.3), the storage to be the one it asked for access to, and token exchange
  with JWT subject tokens to be supported. Then it signs the agent JWT
  (`kid` = the granted method, `sub` = `iss` = `client_id` = the user's DID,
  `aud` = the issuer, 5 minutes) and exchanges it with `resource` = the storage.
- `keygen` and `request` print the key's `fingerprint`, as Settings → Agents
  shows it next to the request.
- `get`, `create`, `patch` and `delete` reuse the cached token and get a new
  one when it has less than 30 seconds left; on a `401 invalid_token` they get
  a new one and retry once. `patch` sends merge-patch for an
  object and JSON Patch for an array, with `If-Match` from a fresh HEAD unless
  `--etag` is given. `delete` sends `If-Match` only with `--etag`.

## End-to-end on dev

`scripts/lws-e2e-dev.mjs` runs the whole flow against the **dev** deployment
(`CONVEX_DEPLOYMENT` in `.env.local`), over real HTTP to its `.convex.site`
URL, with the CLI agent as a separate process:

```sh
pgrep -fl "convex dev"                 # nothing else may push to dev meanwhile
npx convex dev --once                  # deploy this branch to dev
npx convex env set LWS_DEV_SEED 1      # dev only
node scripts/lws-e2e-dev.mjs           # prints a pass/fail table; exit 1 on any failure
npx convex env remove LWS_DEV_SEED
```

It seeds two accounts, requests access, approves, gets a token, reads and
checks the headers, creates, patches (`If-Match`, a stale `412`, checking),
deletes, approves a second agent for `[read, create]` only (it creates, and
gets `403` on PATCH and DELETE), makes the negative checks (no token, `lwsat_` on `/api/v1/lists`,
a replayed `jti`, `kid` `#key-0` signed by the author key, the other account's
storage and token audience), revokes (token `401`, exchange refused, then the
key removed from the DID), and cleans up in `finally`.

**What it bypasses.** Approving on dev needs a Turnkey session (the author key
signs the DID update) and a boop session (`POST /api/did/log`), and the e2e
can't sign in. So the test accounts' author and assertion keys are local
Ed25519 keys, and `convex/devLws.ts` stores the logs they sign after the same
write check `/api/did/log` makes (`didLogValidation.checkWrite`, with the
local keys in place of the sub-org's Turnkey accounts). The DID itself is built
by the app's own code (`mintAuthorDid`, `buildAgentUpdate`), and approval and
revocation are the deployed `approveAccessRequestForUser` and
`revokeAgentForUser`, minus the session check. Everything else is the
deployed code over HTTP.

`devLws.ts` is internal only, and every helper refuses to run unless
`WEBVH_DOMAIN` is set and isn't `boop.ad`, and `LWS_DEV_SEED` is `1`. It only
touches accounts it made (`lws-e2e-…` sub-org, `lws-e2e+…@example.invalid`).
`npx convex run devLws:cleanup '{"all": true}'` removes any a failed run left.
