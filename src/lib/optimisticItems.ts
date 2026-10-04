import type { ReplayAck } from '../../shared/replay';
import type { Id } from '../../convex/_generated/dataModel';
import type { OptimisticItem } from '../hooks/useOptimisticItems';
import type { OfflineItem, QueuedMutation } from './offline';

export function projectItems(base: OfflineItem[], operations: QueuedMutation[], listId: Id<'lists'>, observed?: Set<string>, acknowledgments: ReplayAck[] = [], proof?: { retiredThrough?: number; retainedOperationIds?: string[]; aliases?: Record<string, string>; sequence?: number }): OptimisticItem[] {
  // Reactive receipts can arrive before the mutation response / queue observer.
  // Use their create results immediately for row identity and pending targets.
  const receipts = new Map(operations.flatMap(m => m.ack ? [[m.operationId, m.ack] as const] : []));
  for (const ack of acknowledgments) receipts.set(ack.operationId, ack);
  const localKeys = new Map(operations.filter(m => m.type === 'addItem' && typeof receipts.get(m.operationId)?.result === 'string').map(m => [receipts.get(m.operationId)!.result as string, m.operationId]));
  for (const [id, key] of Object.entries(proof?.aliases ?? {})) localKeys.set(id, key);
  const items = new Map<string, OptimisticItem>(base.map(i => [i._id, localKeys.has(i._id) ? { ...i, _localKey: localKeys.get(i._id) } : i]));
  const ids = new Map(operations.filter(m => typeof receipts.get(m.operationId)?.result === 'string').map(m => [`temp-${m.operationId}`, receipts.get(m.operationId)!.result as string]));
  for (const [id, key] of localKeys) ids.set(`temp-${key}`, id);
  const retained = new Set(proof?.retainedOperationIds);
  for (const m of operations) {
    if (m.id !== undefined && m.id <= (proof?.retiredThrough ?? 0) && !retained.has(m.operationId)) continue;
    const sequence = receipts.get(m.operationId)?.sequence;
    if (sequence !== undefined && proof?.sequence !== undefined && sequence <= proof.sequence) continue;
    if (!m.listIds.includes(listId) || m.observedListIds?.includes(listId) || observed?.has(m.operationId)) continue;
    const p = m.payload;
    if (m.type === 'addItem' && p.listId === listId) {
      const id = (typeof receipts.get(m.operationId)?.result === 'string' ? receipts.get(m.operationId)!.result : `temp-${m.operationId}`) as Id<'items'>;
      items.set(id, { ...p, _id: id, _creationTime: m.timestamp, listId, name: String(p.name), createdAt: Number(p.createdAt), createdByDid: String(p.createdByDid), checked: false, order: -m.timestamp, _isOptimistic: true, _syncError: m.error, _localKey: m.operationId, _operationId: m.operationId } as OptimisticItem);
      continue;
    }
    const targets = typeof p.itemId === 'string' ? [p.itemId] : Array.isArray(p.itemIds) ? p.itemIds as string[] : [];
    for (const [index, originalId] of targets.entries()) {
      const id = ids.get(originalId) ?? originalId;
      const original = items.get(id);
      if (!original) continue;
      const item = { ...original };
      items.set(id, item);
      if (m.type === 'removeItem' || m.type === 'batchDeleteItems') { items.delete(id); continue; }
      if (m.type === 'checkItem' || m.type === 'batchCheckItems') Object.assign(item, { checked: true, checkedByDid: p.checkedByDid, checkedAt: p.checkedAt ?? m.timestamp });
      if (m.type === 'uncheckItem' || m.type === 'batchUncheckItems') Object.assign(item, { checked: false, checkedByDid: undefined, checkedAt: undefined });
      if (m.type === 'reorderItem') item.order = index;
      if (m.type === 'updateItem') {
        if (Array.isArray(p.assigneeDids)) {
          item.assigneeDids = [...new Set(p.assigneeDids as string[])].sort();
          item.assigneeDid = item.assigneeDid && item.assigneeDids.includes(item.assigneeDid) ? item.assigneeDid : item.assigneeDids[0];
        } else if (p.assigneeDid !== undefined || p.clearAssigneeDid) {
          const dids = new Set(item.assigneeDids ?? (item.assigneeDid ? [item.assigneeDid] : []));
          if (item.assigneeDid) dids.delete(item.assigneeDid);
          if (!p.clearAssigneeDid && p.assigneeDid) dids.add(String(p.assigneeDid));
          item.assigneeDids = [...dids].sort();
          item.assigneeDid = p.clearAssigneeDid ? item.assigneeDids[0] : String(p.assigneeDid);
        }

        for (const key of ['name', 'description', 'dueDate', 'url', 'recurrence', 'priority', 'groceryAisle']) {
          if (p[key] !== undefined) Object.assign(item, { [key]: p[key] });
          if (p[`clear${key[0].toUpperCase()}${key.slice(1)}`]) Object.assign(item, { [key]: undefined });
        }
      }
      item._isOptimistic = true;
      item._operationId = m.operationId;
      item._syncError = m.error;
    }
  }
  return [...items.values()];
}

/** Resolve selection captured before a queued create acquired its server ID. */
export function matchesItemId(item: OptimisticItem, id: string): boolean {
  return item._id === id || (item._localKey !== undefined && `temp-${item._localKey}` === id);
}
