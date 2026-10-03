import type { Id } from '../../convex/_generated/dataModel';
import type { OptimisticItem } from '../hooks/useOptimisticItems';
import type { OfflineItem, QueuedMutation } from './offline';

export function projectItems(base: OfflineItem[], operations: QueuedMutation[], listId: Id<'lists'>, observed?: Set<string>): OptimisticItem[] {
  const localKeys = new Map(operations.filter(m => m.type === 'addItem' && typeof m.ack?.result === 'string').map(m => [m.ack!.result as string, m.operationId]));
  const items = new Map<string, OptimisticItem>(base.map(i => [i._id, localKeys.has(i._id) ? { ...i, _localKey: localKeys.get(i._id) } : i]));
  const ids = new Map(operations.filter(m => m.ack && typeof m.ack.result === 'string').map(m => [`temp-${m.operationId}`, m.ack!.result as string]));
  for (const m of operations) {
    if (!m.listIds.includes(listId) || m.observedListIds?.includes(listId) || observed?.has(m.operationId)) continue;
    const p = m.payload;
    if (m.type === 'addItem' && p.listId === listId) {
      const id = (typeof m.ack?.result === 'string' ? m.ack.result : `temp-${m.operationId}`) as Id<'items'>;
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
        for (const key of ['name', 'description', 'dueDate', 'url', 'recurrence', 'priority', 'groceryAisle', 'assigneeDid']) {
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
