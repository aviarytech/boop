import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export async function assignmentRows(ctx: QueryCtx, item: Doc<'items'>) {
  const storedRows = await ctx.db.query('itemAssignees').withIndex('by_item', q => q.eq('itemId', item._id)).collect();
  const rows = [...new Map(storedRows.map(row => [row.assigneeDid, row])).values()];
  // Before reconciliation the scalar is evidence, not a reason to discard rows.
  if (item.assignmentsVersion === undefined && item.assigneeDid && !rows.some(r => r.assigneeDid === item.assigneeDid)) {
    return [...rows, { itemId: item._id, listId: item.listId, assigneeDid: item.assigneeDid,
      assignedByDid: item.createdByDid, assignedAt: item.createdAt, inferredFromLegacyScalar: true as const }];
  }
  return rows;
}

export async function withAssignments(ctx: QueryCtx, item: Doc<'items'>) {
  const assigneeDids = [...new Set((await assignmentRows(ctx, item)).map(r => r.assigneeDid))].sort();
  // The stored scalar stays the legacy primary; rows supply all current members.
  return { ...item, assigneeDids };
}

/** Hydrate only the requested items, with at most one assignment query per list.
 * The live-item map discards old orphan rows and rows outside a filtered subset.
 * A singleton uses its narrower item index instead of reading the whole list. */
export async function withAssignmentsBatch(ctx: QueryCtx, items: Doc<'items'>[]) {
  const groups = new Map<Id<'lists'>, Map<Id<'items'>, Set<string>>>();
  for (const item of items) {
    let group = groups.get(item.listId);
    if (!group) { group = new Map(); groups.set(item.listId, group); }
    group.set(item._id, new Set(item.assignmentsVersion === undefined && item.assigneeDid ? [item.assigneeDid] : []));
  }
  await Promise.all([...groups].map(async ([listId, group]) => {
    const rows = group.size === 1
      ? await ctx.db.query('itemAssignees').withIndex('by_item', q => q.eq('itemId', group.keys().next().value!)).collect()
      : await ctx.db.query('itemAssignees').withIndex('by_list', q => q.eq('listId', listId)).collect();
    for (const row of rows) group.get(row.itemId)?.add(row.assigneeDid);
  }));
  return items.map(item => ({ ...item, assigneeDids: [...groups.get(item.listId)!.get(item._id)!].sort() }));
}

/** Idempotent, lossless cutover. Existing rows and historical events are untouched.
 * Imported scalar attribution is only a legacy inference, explicitly recorded as
 * such. Nothing here creates or claims a signed credential. */
export async function reconcileAssignments(ctx: MutationCtx, item: Doc<'items'>) {
  if (item.assignmentsVersion !== undefined) return { conflict: false, migrated: false };
  const rows = await ctx.db.query('itemAssignees').withIndex('by_item', q => q.eq('itemId', item._id)).collect();
  const rowDids = [...new Set(rows.map(r => r.assigneeDid))].sort();
  const conflict = !!item.assigneeDid && rowDids.some(did => did !== item.assigneeDid);
  if (item.assigneeDid && !rowDids.includes(item.assigneeDid)) {
    await ctx.db.insert('itemAssignees', { itemId: item._id, listId: item.listId, assigneeDid: item.assigneeDid,
      assignedByDid: item.createdByDid, assignedAt: item.createdAt, inferredFromLegacyScalar: true });
  }
  if (item.assigneeDid || rows.length) {
    await ctx.db.insert('activities', { listId: item.listId, itemId: item._id, actorDid: 'system:assignment-reconciliation',
      type: 'item_updated', createdAt: Date.now(), metadata: { note: JSON.stringify({
        kind: 'assignment_reconciliation', conflict, scalar: item.assigneeDid ?? null, rowDids,
        policy: 'union', attribution: 'legacy scalar actor/time inferred from item creation; not signed',
      }) } });
  }
  const primary = item.assigneeDid || rowDids[0];
  await ctx.db.patch(item._id, { assignmentsVersion: 1, assigneeDid: primary });
  return { conflict, migrated: true };
}

/** All callers authorize the item before entering this transaction helper. */
export async function changeAssignments(ctx: MutationCtx, source: Doc<'items'>, actorDid: string,
  change: { add?: string; remove?: string; replace?: string[]; legacy?: string | null }, note?: string) {
  await reconcileAssignments(ctx, source);
  const item = (await ctx.db.get(source._id))!;
  const rows = await ctx.db.query('itemAssignees').withIndex('by_item', q => q.eq('itemId', item._id)).collect();
  const before = new Set(rows.map(r => r.assigneeDid));
  const after = new Set(change.replace ?? before);
  if (change.legacy !== undefined) {
    // Only replace the scalar the legacy writer could have seen. Reconciliation
    // may have synthesized a primary from previously invisible row-only data.
    if (source.assigneeDid) after.delete(source.assigneeDid);
    if (change.legacy) after.add(change.legacy);
  }
  if (change.add !== undefined) after.add(change.add);
  if (change.remove) after.delete(change.remove);
  if ([...after].some(did => !did.trim())) throw new Error('Assignee DID cannot be empty');
  const now = Date.now();
  for (const did of before) if (!after.has(did)) {
    // Remove every duplicate, while retaining all prior activities.
    for (const row of rows.filter(r => r.assigneeDid === did)) await ctx.db.delete(row._id);
    await ctx.db.insert('activities', { listId: item.listId, itemId: item._id, actorDid,
      type: 'item_unassigned', metadata: { assigneeDid: did, note: JSON.stringify({ reason: note ?? 'unassigned', priorAssignments: rows.filter(r => r.assigneeDid === did).map(r => ({ assignedByDid: r.assignedByDid, assignedAt: r.assignedAt, inferredFromLegacyScalar: r.inferredFromLegacyScalar ?? false })) }) }, createdAt: now });
  }
  for (const did of after) if (!before.has(did)) {
    await ctx.db.insert('itemAssignees', { itemId: item._id, listId: item.listId, assigneeDid: did, assignedByDid: actorDid, assignedAt: now });
    await ctx.db.insert('activities', { listId: item.listId, itemId: item._id, actorDid,
      type: 'item_assigned', metadata: { assigneeDid: did, ...(note ? { note } : {}) }, createdAt: now });
  }
  const primary = change.legacy && after.has(change.legacy) ? change.legacy
    : item.assigneeDid && after.has(item.assigneeDid) ? item.assigneeDid : [...after].sort()[0];
  if ([...before].some(did => !after.has(did)) || [...after].some(did => !before.has(did)) || primary !== item.assigneeDid) {
    await ctx.db.patch(item._id, { assigneeDid: primary, assignmentsVersion: (item.assignmentsVersion ?? 0) + 1, updatedAt: now });
  }
}

/** Projection for a brand-new item: no existing membership needs reconciling.
 * Keep the existing initial version/primary semantics without target reads. */
export function inheritedAssignmentFields(assigneeDids: string[], assignedAt: number) {
  return { assigneeDid: assigneeDids[0], assignmentsVersion: assigneeDids.length ? 2 : 1,
    ...(assigneeDids.length ? { updatedAt: assignedAt } : {}) };
}

/** Only for targets inserted in this transaction, from a sorted unique source
 * projection. Original rows/events/proofs stay on the source asset. No reads. */
export async function insertInheritedAssignments(ctx: MutationCtx, args: {
  sourceId: Id<'items'>; targetId: Id<'items'>; listId: Id<'lists'>;
  assigneeDids: string[]; actorDid: string; assignedAt: number; reason: 'copy' | 'recurrence';
}) {
  for (const assigneeDid of args.assigneeDids) {
    await ctx.db.insert('itemAssignees', { itemId: args.targetId, listId: args.listId,
      assigneeDid, assignedByDid: args.actorDid, assignedAt: args.assignedAt });
    await ctx.db.insert('activities', { listId: args.listId, itemId: args.targetId, actorDid: args.actorDid,
      type: 'item_assigned', metadata: { assigneeDid,
        note: `${args.reason} from item ${args.sourceId}; source assignment history remains on that item` }, createdAt: args.assignedAt });
  }
}

/** Deleting content also deletes live membership, but leaves audit activities. */
export async function deleteAssignments(ctx: MutationCtx, itemId: Id<'items'>) {
  for (const row of await ctx.db.query('itemAssignees').withIndex('by_item', q => q.eq('itemId', itemId)).collect()) await ctx.db.delete(row._id);
}
