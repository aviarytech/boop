# Assignment consistency and reconciliation (#239)

## Authority and compatibility

`itemAssignees` is the authoritative multiple-assignee membership store.
`convex/lib/assignments.ts` provides shared reads, reconciliation, writes and
inheritance. Browser details, list badges, API reads, Explorer, sub-items,
calendar/priority/sync reads, copying and both recurrence paths use it.
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

Reruns do not re-import the scalar after the marker is set. An explicit API
unassignment, browser clear, or legacy-primary clear first reconciles and then
removes the requested membership in the same transaction, so a later migration
cannot resurrect it. Unassignment activities retain all removed duplicate rows'
assigner/time/inference metadata in their note. Existing events are never
rewritten by assignment operations.

## Bounded operator workflow (not executed by this change)

Deployment, production inspection and migration require separate authorization.
Do not run deployment/codegen or copy credentials merely to test this work.

1. Deploy the additive schema/backend and matching supported clients together
   under an approved release. Keep compatibility fields and names.
2. From an authorized data export/operator inventory, select item IDs missing
   `assignmentsVersion`. Review the scalar/row differences first.
3. Invoke internal `assignees:reconcileBatch` with `{ itemIds: [...] }`, at most
   **25 IDs** per transaction. It returns per-item `migrated`, `conflict`, or
   `missing`. Duplicate requested IDs are processed once. An item with more than
   **100 physical assignment rows** rejects the whole transaction and requires a
   separately reviewed migration strategy; it is never partially truncated.
4. Save the results, review conflict activities, and reconcile disagreements via
   explicit normal assignment writes. Retry a batch safely; already-marked
   records are no-ops. Audit final logical memberships against the pre-migration
   union and verify browser/API/Explorer agreement on designated staging data.
5. Never drop the scalar/compatibility adapter based only on a successful local
   test. Confirm browser/native versions, external integrations and migration
   completeness first.

Old orphan rows do not contribute to Explorer. Internal
`assignees:cleanupOrphanRows({ rowIds: [...] })` accepts at most **100 candidate
row IDs**, rechecks that each referenced item is missing, and deletes only those
orphans. It never deletes a live membership; it is explicit, idempotent and not
scheduled. Normal item/batch-child/list deletion removes membership rows, and
account deletion drains rows by list even if the item was previously removed.
No orphan cleanup or migration was run against a deployment.

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

Local delivery checks for this implementation: frozen-lockfile installation with
lifecycle scripts disabled; 61 focused assignment/replay/modal tests and 424 full
Bun tests passed; frontend/backend TypeScript, authenticated-client registry
check, and Vite build with placeholder Convex URLs and Sentry uploads disabled
passed. Changed-file ESLint reports 39 existing errors on both the base commit
and this change, with no added diagnostics. Existing React `act(...)` and Vite
large-chunk warnings remain. Test-generated icon/splash artifacts were restored.
The coordinating thread independently verified the mocked-transport modal at
375×812, including multiple assignees and a long-DID removal button remaining
inside the viewport. No live deployment or native-device validation is claimed.

## Assignment read scaling (PR #263 follow-up)

`withAssignmentsBatch` hydrates requested items with at most one assignment index
query per represented list. It groups live requested item IDs before reading,
ignores orphan/out-of-subset rows, unions unreconciled scalars, and deduplicates
membership. Multi-item groups use `itemAssignees.by_list`; a singleton uses the
narrower `by_item` index. Empty filtered results make no assignment query. Explorer,
list/replay/API reads, sub-items, due-date and priority results use this path.

Copying preloads source membership once and inserts the brand-new target's
primary/revision projection, membership rows and attributed activities directly.
It does not read, reconcile, or diff each new target. Unassigned targets retain
initial assignment version 1; assigned targets retain version 2, sorted primary,
and copier attribution. Source history stays untouched. Single recurrence reads
only source membership; batch recurrence caches assignment and parent-group order
state once per list and advances order locally for each new occurrence. Both
insert new target membership without target reads.

Query-count regressions exercise 4,500-item reads and copies of 1,200 mostly
unassigned items, with mixed legacy scalars, authoritative rows, duplicate rows,
and orphans. They assert one assignment query, a fixed read-call budget for copy,
zero new-target reads, source/history preservation, and correct new activities.
Subset/singleton/empty results and batch recurrence ordering are also covered.
These fixtures demonstrate call-count scaling, not unlimited transaction size or
deployed throughput; data-volume and write budgets still apply.

Follow-up validation: 84 focused tests, 436 full Bun tests, frontend/backend
TypeScript, auth registry check, frozen-lockfile installation with scripts
disabled, and Vite build with uploads disabled passed. Changed TypeScript source
ESLint has zero errors both before and after this follow-up. Existing React
`act(...)` and bundle-size warnings remain. No deployment, live migration, or
production read was performed. Integration with the newer SDK/main branch is
left to the coordinating thread.
