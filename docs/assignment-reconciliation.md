# Assignment consistency and reconciliation (#239)

## Authority and compatibility

`itemAssignees` is the authoritative multiple-assignee membership store.
`convex/lib/assignments.ts` provides shared reads, reconciliation, writes and
inheritance. Browser details, list badges, API reads, sub-items,
calendar/priority/sync reads, copying and both recurrence paths use it. Explorer
counts distinct DIDs directly from the authoritative rows; the release gate
below establishes their convergence with legacy evidence.
Membership is a set of exact DID strings; arbitrary external assignee identities
remain supported. Assignees are not permission grants.

`items.assigneeDid` remains a compatibility primary projection. Do not remove it
or the existing public/internal/HTTP operation names until deployed clients have
been inventoried. `items.assignmentsVersion` marks completed reconciliation and
advances on membership or primary changes, including changes in the same
millisecond. It is not a count of assignees.

- `assignItem` adds one membership; `unassignItem` removes that DID, including all
  duplicate rows. Already-assigned/missing-member retries succeed without adding
  assignment/unassignment events. A first legacy write may separately reconcile.
- `addItem` and `updateItem` accept `assigneeDids: string[]`; updates replace the
  complete set, and `[]` explicitly clears it. If both forms are supplied, the
  array takes precedence. Omitting assignment arguments preserves all members.
- Legacy `assigneeDid` updates replace only the pre-reconciliation scalar, preserving
  secondary members. `clearAssigneeDid` removes only that scalar. With row-only
  legacy data, an unseen member is never replaced by a synthesized primary. This preserves
  the single-assignee behavior for old single-member records without silently
  erasing memberships that the legacy client cannot represent.
- Item query results add sorted, unique `assigneeDids`. The persisted scalar is
  returned unchanged for compatibility/revision hashing. Before migration an old
  scalar-only client cannot display row-only memberships; current clients use
  the array immediately. Older clients must be updated to display all members.
- `getItemAssignees` retains its row-shaped response, with one row per logical
  DID. Duplicate physical rows remain stored with their attribution. A
  scalar-only membership read before reconciliation is an inferred row without
  a database `_id`/`_creationTime`; after reconciliation it has a persisted row.
  `inferredFromLegacyScalar: true` distinguishes inferred creator/time values.

No credential or permission checks are weakened. Acting identity, API scopes,
legacy-account access and resource authorization still come from the existing
#236 actor boundary. The new internal maintenance operations are not public
browser operations or HTTP routes.

## Lossless legacy policy

Until an item has `assignmentsVersion`, reads expose the **union** of the scalar
and row memberships. On its first assignment write, or an explicit migration,
reconciliation inserts only missing scalar membership and keeps every original
row, duplicate, activity and credential untouched. It then marks the item and
selects the existing scalar, or the first sorted row DID, as primary.

| Existing evidence | Result |
| --- | --- |
| Neither | Empty set, marked reconciled |
| Scalar only | Scalar imported, explicitly inferred provenance |
| Rows only | Rows retained, deterministic compatibility primary |
| Matching scalar and rows | No duplicate insertion |
| Different scalar and rows | Union retained; conflict reported and recorded |
| Scalar with multiple row DIDs | All retained; differing members flagged for review |
| Duplicate row DIDs | All physical rows retained; one logical membership per DID |

For nonempty evidence a separate `item_updated` activity records a JSON note:
`kind: assignment_reconciliation`, `policy: union`, `conflict`, original `scalar`
and original `rowDids`. Its actor is `system:assignment-reconciliation`, not an
assertion that the item's creator performed this maintenance. Imported row
`assignedByDid`/`assignedAt` use item creation evidence only and are explicitly
marked **inferred**, not an authentic assignment event. A conflict does not
choose a winner. An authorized user must review and explicitly remove unwanted
memberships through normal writes.

Reconciliation audit timestamps record the actual maintenance time. These
activities can move affected lists in Explorer’s updated sort; this one-time
reordering is an accepted rollout effect. The release owner must anticipate and
document it. Do not backdate audit events or change the recency model to hide
this movement.

Reruns do not re-import the scalar after the marker is set. An explicit API
unassignment, browser clear, or legacy-primary clear first reconciles and then
removes the requested membership in the same transaction, so a later migration
cannot resurrect it. Unassignment activities retain all removed duplicate rows'
assigner/time/inference metadata in their note. Existing events are never
rewritten by assignment operations.

## Mandatory backend-first release and reconciliation gate

Deployment, production inspection and migration require separate authorization.
This change supplies code and a runbook; it neither runs those operations nor
certifies that any deployed dataset has converged.

**Before reconciliation, Explorer intentionally retains its baseline row-only
semantics:** scalar-only memberships are absent from its count and legacy orphan
rows may contribute. Item and assignment API reads still expose the lossless
live scalar/row union. No memberships or history are discarded. The new frontend
must not be released until the whole target dataset passes the gate below.

1. Hold frontend/native rollout. Railway and Convex deploy independently; merging
   a branch or observing a green frontend build does not enforce backend-first
   ordering. The release owner must hold Railway auto-deployment or use a
   separately controlled staged release. Deploy the additive Convex schema and
   backend **first**, retaining old client validators, names and scalar adapters.
   Verify new and cached/old-client reads, writes and replay compatibility against
   that backend before proceeding. Do not release a frontend that sends
   `assigneeDids` to a backend whose validators do not support it.
2. Inventory the **whole target deployment dataset**, across every list/account,
   using an authorized consistent export or complete paginated operator scan.
   Record the dataset/deployment identifier, checkpoint/cursor, item and
   assignment-row IDs, and all items missing `assignmentsVersion`. Inventory all
   orphan rows whose referenced item is absent, not only rows for recently
   visited lists. Preserve the pre-migration memberships/history for comparison.
   A sample, an owner-only scan or an undocumented exclusion is not completion.
3. Run internal `assignees:reconcileBatch({ itemIds: [...] })` for **all** items
   missing the marker, at most **25 IDs** per transaction. Save inputs, returned
   `migrated`/`conflict`/`missing` results and completed checkpoints. Duplicate IDs
   are processed once; completed items are no-ops on retry. Retry failed batches
   from their last confirmed checkpoint. More than **100 physical assignment
   rows** on one item rejects the whole batch; separately review a safe strategy
   for those records and keep the frontend release blocked until resolved.
4. Run internal `assignees:cleanupOrphanRows({ rowIds: [...] })` for **all** inventoried
   orphan candidates, at most **100 IDs** per batch. It rechecks item absence and
   removes only orphans; live memberships are never removed by this operation.
   Save deleted IDs and checkpoints, and retry safely. Normal item/batch-child/
   list deletion removes membership rows; account deletion also drains legacy
   rows by list when their item is already gone.
5. Save and review every reconciliation conflict. The union is the explicit
   reconciliation policy: retain both sides unless an authorized user deliberately
   removes a membership through a normal write. Review does not require choosing
   a winner. Confirm original row attribution, duplicate rows, activities and
   credential evidence remain intact. Compare row memberships against the saved
   live scalar/row union and compare browser/API/Explorer results.
6. Re-inventory from a fresh consistent checkpoint. Require **no remaining items
   missing the marker, no remaining orphan rows, and no unresolved exclusions or
   batch failures** in the target dataset. Account for concurrent writes/deletes;
   if necessary, coordinate a final consistent verification window. Preserve the
   audit evidence, conflict reviews and release-owner sign-off. If completeness
   cannot be established, **postpone the frontend/native release** rather than
   treating partial counts as converged.
7. Only after the verified gate passes, release/enable the matching frontend and
   native clients. Maintain the compatibility adapters until supported-client
   inventory permits their retirement. No deployment or migration is authorized
   merely by this documentation.

## History, copies, recurrence and reminted identities

Copies and new recurring items receive the source's full current union as new
memberships. New assignment events identify the actual authenticated copier or
completer and reference the source item in their note. Original assignment rows,
events and credential proofs remain on the source. They are not transplanted as
claims about a new asset. Copying drops old assignment revision/primary state and
rebuilds it; both single and batch recurrence paths do the same.

The existing DID-remint migration already rewrites scalar membership, row DIDs,
row assigner DIDs and `activities.metadata.assigneeDid`. It now also advances
item revisions for secondary/row-only membership changes. Colliding old/new DID
rows are retained, read as one logical member, and all removed on explicit
unassignment. Derived arrays are not stored, so there is no second array to
remint. Reconciliation and removal JSON notes retain their historical identifiers
as audit evidence rather than being rewritten into a new account identity.

Assignment changes create no signed credentials and do not change signed proof
bytes. #237 is deferred. Separately, the existing general remint migration has
preexisting code that rewrites serialized list/item credential fields and proof
strings. This change neither expands nor invokes that behavior; it remains a
baseline risk for a separately authorized remint review.

## Offline revisions and evidence limits

Reactive snapshots include joined `assigneeDids`, but the offline queue excludes
that derived field when hashing a persisted item. Server replay accepts either the stored document hash or the exact current
server-computed joined item hash. This also supports already-open older clients
whose cleaners retain the newly returned array; it does not accept partial or
arbitrary client projections. `assignmentsVersion` makes all shared assignment writes
visible to that hash even at identical timestamps, while remint also advances
item state. Existing receipt fingerprints remain canonical when new optional
assignment arguments are omitted. Dirty forms keep their captured revision;
intervening assignment changes produce the existing saved-edit conflict flow.
Unrelated form saves do not send a replacement set.

Local regression coverage includes all reconciliation cases, retries and bounds,
duplicate attribution, browser/API/Explorer and secondary reads, HTTP responses
and scope denials, source/copy/recurrence history, deletion/erasure/orphans, DID
collisions, queue conflicts, old receipts, temporary creates and rendered modal
multi-assignee edits/removals. These are in-memory Convex/HTTP fixtures and real
React DOM components with mocked transport, not evidence of production state,
live WebSocket timing, deployed native clients or completed migration. Confirm
those release acceptance criteria with approved staging/deployed evidence.

## Assignment read scaling

`withAssignmentsBatch` hydrates requested items with at most one assignment index
query per represented list. It groups live requested item IDs before reading,
ignores orphan/out-of-subset rows, unions unreconciled scalars, and deduplicates
membership. Multi-item groups use `itemAssignees.by_list`; a singleton uses the
narrower `by_item` index. Empty filtered results make no assignment query.
List/replay/API reads, sub-items, due-date and priority results use this path.
Explorer instead reads only compact `itemAssignees.by_list` rows, deduplicating
DIDs without reading item documents or their description/proof payloads. Its
legacy scalar/orphan accuracy depends on the mandatory release gate above.

Copying preloads source membership once and inserts the brand-new target's
primary/revision projection, membership rows and attributed activities directly.
It does not read, reconcile, or diff each new target. Unassigned targets retain
initial assignment version 1; assigned targets retain version 2, sorted primary,
and copier attribution. Source history stays untouched. Single recurrence reads
only source membership; batch recurrence caches assignment and parent-group order
state once per list and advances order locally for each new occurrence. Both
insert new target membership without target reads.

Regression checks should cover large item payloads across multiple lists and
assert zero item queries, item gets and returned item bytes in Explorer. Check
both baseline pre-migration counts and exact post-gate counts for scalar-only,
row-only, matching, conflicting, multi-assignee, duplicate and orphan evidence.
Retain query-count and no-target-reread tests for copying, filtered item reads and
recurrence, including source history and new activity attribution. These fixtures
do not prove deployed throughput or unlimited transaction size; compact assignment
rows and other Explorer metadata remain subject to normal transaction budgets.
