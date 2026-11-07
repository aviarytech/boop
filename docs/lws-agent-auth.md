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
   Requests expire after 24 hours, and a user can have at most 10 pending.
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
   lasts an hour and is bound to the storage.
4. **Use.** `Authorization: Bearer lwsat_…` on storage resources. The
   resource server resolves the token to an actor whose `did` is the user's,
   whose scopes are the agent's, and whose credential is
   `{kind: "agent", id}`. Requests without a valid token get a `401` with
   `WWW-Authenticate: Bearer resource_metadata="…"` and the storage `Link`.
5. **Revoke.** The app removes the method from the DID (a DID update signed by
   the author key), then calls `revokeAgent`, which marks the row revoked and
   deletes its tokens. If the DID update fails, the row is still revoked: the
   token endpoint and the resource server both check the row as well as the
   DID.

Action → scope: `read` → `lists:read` and `items:read`; `create`, `update`,
`delete` → `items:write`.

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

## Implementation notes

Where the server (phase 1) fills in what the sections above leave open:

- **`modify` is accepted as well as `update`.** The LWS access profile names
  the action `modify`; agents written to the spec send it. Both map to
  `items:write` and are stored as sent.
- **`name` is optional.** Spec-only agents don't send it; the label is then
  `Agent`. It is trimmed, NFC, 1–60 characters, with no control or bidi
  override characters.
- **One `AccessPolicy`, no constraints.** A request with several policies, a
  target other than the storage root, or any `constraint` is refused rather
  than partly honoured. An absent `target` means the storage root.
- **A retry gets the same request.** A second POST signed by the same key while
  its request is pending returns that request (`200`, same `Location`), not a
  new one. A key that is already an active agent gets `409`.
- **Polling is signed too.** `GET B/lws-access/requests/{id}` takes a fresh
  did:key JWT (single-use `jti`, `aud` ∋ the requests URL or the request's
  own URL). Another key's request reads as `404`. An approved request whose
  agent was revoked reads `status: "revoked"`, without the grant.
- **The did:key JWT's `kid` is optional**; when present it must be
  `did:key:z…#z…`. The did:webvh JWT's `kid` is required and absolute.
- **`scope` at the token endpoint** may narrow the agent's scopes; anything
  beyond them is `invalid_scope`. A bad subject token is `invalid_request`
  (RFC 8693 §2.2.2); a wrong `resource` is `invalid_target`.
- **Owner operations refuse every delegated credential**, not only those
  without `*`: an API key or agent never approves, denies or revokes.
