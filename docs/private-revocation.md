# Private revocation and local recovery (#260)

## Behavior

The existing authenticated operation boundaries from #256/#257 remain the server
source of authority. The client now subscribes to an account-scoped access manifest
outside route error boundaries. It checks every cached list and item, including
unopened resources, and draft locators from server-verified current/legacy account
DIDs. Queries resume on contact/reconnect. Inaccessible resources return no content;
inaccessible list/item pairings intentionally give identical unavailable answers.

Read loss removes IndexedDB list/item caches, clears rendered fallback projections,
and parks pending edits and their dependency chains in the existing #238 conflict
recovery queue. FORBIDDEN is terminal: automatic sync, manual retry, and conflict
rebase cannot resend denied work. Viewer downgrade keeps readable server content
while removing denied optimistic overlays. A later grant permits newly authored
edits but does not reactivate the old denied queue.

List permission timestamps and per-item observations are fenced separately. A
list-only or different item-subset response cannot suppress confirmed deletion of
an item in another batch. Inaccessible-list answers are never treated as evidence
of item deletion. Confirmed item deletion purges unopened item caches and strips
acknowledged operation payloads, retaining only receipt evidence. Stale cache
writers cannot reinsert revoked/deleted content. A later authoritative positive
item observation can clear an unavailable marker.

`listGrants.leaveList`/`leaveListInternal` remove only the caller's accepted grant,
are idempotent, and use the same revocation tombstone as owner revocation. They
require wildcard management scope; read-only API keys cannot leave. Old invitation
acceptance cannot restore the grant; a fresh owner reinvitation can. Ownership,
other recipients, and publication remain unchanged. This supplies lifecycle
semantics, not the #258 discovery/navigation UI.

## Attachments

`attachments.getAttachmentUrls` now returns locators for
`CONVEX_SITE_URL/api/attachments/download`, never a presigned storage GET URL.
The HTTP broker authenticates and checks current list/item access and registered
attachment-key membership before bucket I/O and again before releasing the body.
It returns bytes directly, with `private, no-store`, credential-aware `Vary`, and
`nosniff`; it never redirects to reusable storage authority. Private requests need
current session/API credentials. Intentional public publication still allows
anonymous reads, checked on every retrieval; unpublishing removes that authority.
Legacy `_storage` attachment entries remain filtered out, as before.

The browser sends credentials only to the configured Convex HTTP origin and exact
broker route. It rejects old direct-storage URLs, embedded URL credentials, other
origins/paths, and redirects without forwarding its session. Blob preview URLs
are scoped to the current token/item and revoked on replacement, account change,
revocation-driven unmount, and teardown. Late fetch results are aborted/ignored.
The service worker excludes API, attachment, signed download, and DID resource
paths and respects no-store/private responses. Old app download cache entries are
removed on worker activation and app contact/account changes.

## Independent work and compatibility limits

New item detail saves enqueue changed fields and explicit clears only, with
changed-field provenance. Interrupted dirty forms keep only changed form fields
in an export-only local record, not a source snapshot. Recovery clears previously
inspected server versions after denial. All recovery exports use a filtered
export function; no export grants source access or automatically writes to it.
An in-flight request may already have succeeded before contact was lost.

Both note editors preserve independently edited local text while removing the
original comparison `base` from localStorage and memory. Server-verified draft
access checks cover unopened notes and item descriptions. Denial markers and
per-draft detachment prevent a stale tab from reintroducing a comparison body or
automatically replaying a detached draft, even after regrant. Detached text can
be copied/downloaded; restoring it to the source is disabled. Unavailable views
only detach existing drafts; server observations alone write document access
markers. Marker-only denied documents remain monitored after all drafts are
discarded. Both editor queries include a server permission observation timestamp; a newer
authorized observation clears an older marker. Mounting with a stale cached
`canEdit: true` cannot clear denial. Existing detached drafts stay export-only.
An edited note may
contain unchanged text as part of the user's independently recoverable draft;
the separate original source/comparison body is removed.

Older item queues did not record field provenance. When a cached baseline hashes
to the saved expected revision, recovery removes unchanged source fields and
preserves changed values. If no matching baseline exists, there is no safe way to
infer which fields the user authored. Those entries are explicitly quarantined:
retained locally to avoid destroying genuine work, hidden from resource views and
recovery previews, excluded from every export, and never retried/rebased. The UI
explains this limit and warns before discarding their unexportable values.
**This is a compatibility limitation, not a claim that every legacy private byte
has been purged or every legacy authored field can be recovered.** Resolving that
ambiguity requires a proven baseline or an explicit product decision; arbitrary
field deletion is not performed.

## Rollout gate: already-issued storage URLs

No deployment or production storage/credential changes were performed here.
The configured default is Railway S3-compatible storage; no R2-specific behavior
or revocation feature is assumed. A storage URL issued by the old backend remains
a bearer capability until storage itself rejects it. Deploying this broker does
not invalidate that URL. Existing attachment GET signatures used 600-second
lifetimes. A release must stop all old GET issuers, then wait out the last actual
issued lifetime (including any other issuers/proxies), or separately authorize and
verify storage-side invalidation such as signing-credential revocation or object
replacement/removal. Do not claim immediate revocation of legacy signed URLs.

Deploy the broker and URL issuer together, then the matching browser/native
clients and worker. New clients fail closed against old storage URLs; old clients
cannot use an unauthenticated private broker locator. Do not roll back to a URL
issuer that reopens a private bearer window. Validate actual Railway bucket and
proxy cache behavior in the release environment before enabling the guarantee.
Unresolved legacy signatures and ambiguous queued payloads mean #260 should not
be closed as unconditionally complete on the strength of this local change alone.

Revocation cannot contact an offline device before it reconnects. It cannot recall
bytes someone already downloaded, explicitly copied, or exported. App cache and
blob cleanup are best-effort local lifecycle controls, not secure RAM erasure.

## Verification

Handler regressions use real credential/authorization functions with deterministic
in-memory storage fixtures. They exercise the exact broker locator obtained before
revocation with a fresh Request afterward, revocation during storage I/O, scopes,
substituted keys, anonymous publication, unpublish, leave and deletion. IDB tests
cover denied replay, downgrade, stale writes, account isolation, legacy recovery,
regrant, independent batch order and more than 128 items. Rendered React tests cover
real modal save→deny→export, cache fallback clearing, recovery snapshot cleanup,
attachment object URL cleanup, both note editors, stale mounted note editors and
unopened-resource reconciliation.

These are local handler/IDB/React tests, not a live Convex subscription or Railway
bucket integration test. Native WebView, iOS/Android downloads, live websocket
reconnect/OCC, production CORS/proxies, and the legacy signature cutover still need
release-environment validation. No build script, Convex codegen, deployment,
merge, production changes, or spending were used.
