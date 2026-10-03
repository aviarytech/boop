import { canonical } from '../../shared/replay';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useQuery } from '../lib/authenticatedConvex';
import { api } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { useOffline } from './useOffline';
import { cacheListSnapshot, getCachedListSnapshot, type OfflineItem } from '../lib/offline';
import { projectItems } from '../lib/optimisticItems';
const EMPTY_ITEMS: OfflineItem[] = [];
export interface OptimisticItem extends Doc<'items'> { _isOptimistic?: boolean; _syncError?: string; _localKey?: string; _operationId?: string }

/** Durable queue entries are the optimistic state, including after reload.
 * Acknowledgments identify creates by operation ID; names and clocks never do. */
export function useOptimisticItems(listId: Id<'lists'>) {
  const { isOnline, accountId, operations, queueMutation } = useOffline();
  // Keep the complete receipt frontier in every query, including already
  // observed operations. A delayed tab must prove it saw all accepted writes.
  const snapshot = useQuery(api.items.getListItemsForReplay, { listId, operationIds: operations.filter(m => m.listIds.includes(listId)).map(m => m.operationId) });
  const scope = `${accountId}:${listId}`;
  type CachedSnapshot = { scope: string; items: OfflineItem[]; operationIds: string[] };
  const [cached, setCached] = useState<CachedSnapshot>({ scope: '', items: [], operationIds: [] });
  const last = useRef<CachedSnapshot | undefined>(undefined);
  const frontier = new Set([
    ...operations.filter(m => m.observedListIds?.includes(listId)).map(m => m.operationId),
    ...(cached.scope === scope ? cached.operationIds : []),
  ]);
  const coversFrontier = (ids: string[]) => [...frontier].every(id => ids.includes(id));
  const snapshotIds = snapshot?.acknowledgments.map(a => a.operationId) ?? [];
  const serverItems = snapshot && coversFrontier(snapshotIds) ? snapshot.items : undefined;
  if (last.current?.scope !== scope) last.current = undefined;
  if (serverItems && accountId) last.current = { scope, items: serverItems, operationIds: snapshotIds };
  useEffect(() => {
    let active = true;
    const persist = async () => {
      if (snapshot && accountId) await cacheListSnapshot(accountId, listId, snapshot.items, snapshot.acknowledgments);
      // Also refresh after a rejected snapshot: a different tab may own a newer
      // accepted cache than either this query or our in-memory fallback.
      const stored = await getCachedListSnapshot(accountId, listId);
      if (active) setCached({ scope, ...stored });
    };
    void persist();
    return () => { active = false; };
  }, [snapshot, accountId, listId, scope, operations]);
  const lastItems = last.current && coversFrontier(last.current.operationIds) ? last.current.items : undefined;
  const cachedItems = cached.scope === scope && coversFrontier(cached.operationIds) ? cached.items : EMPTY_ITEMS;
  const base = accountId ? serverItems ?? lastItems ?? cachedItems : EMPTY_ITEMS;
  const previousProjection = useRef<{ scope: string; items: OptimisticItem[] }>({ scope, items: [] });
  const items = useMemo(() => {
    const projected = projectItems(base, operations, listId, new Set(serverItems ? snapshot?.acknowledgments.map(a => a.operationId) ?? [] : []));
    const previous = new Map((previousProjection.current.scope === scope ? previousProjection.current.items : []).map(i => [i._id, i]));
    const stable = projected.map(item => {
      const old = previous.get(item._id);
      return old && canonical(old) === canonical(item) ? old : item;
    });
    previousProjection.current = { scope, items: stable };
    return stable;
  }, [base, operations, listId, snapshot, scope, serverItems]);
  const snapshots = useRef(base);
  snapshots.current = base;
  const enqueue = useCallback((type: Parameters<typeof queueMutation>[0]['type'], payload: unknown) => queueMutation({ type, payload }, snapshots.current).then(() => undefined), [queueMutation]);
  const addItem = useCallback((args: { name: string; createdByDid: string; legacyDid?: string; createdAt: number }) => enqueue('addItem', { listId, ...args }), [enqueue, listId]);
  const checkItem = useCallback((itemId: Id<'items'>, checkedByDid: string, legacyDid?: string) => enqueue('checkItem', { itemId, checkedByDid, legacyDid, checkedAt: Date.now() }), [enqueue]);
  const uncheckItem = useCallback((itemId: Id<'items'>, userDid: string, legacyDid?: string) => enqueue('uncheckItem', { itemId, userDid, legacyDid }), [enqueue]);
  const reorderItems = useCallback((itemIds: Id<'items'>[], userDid: string, legacyDid?: string) => enqueue('reorderItem', { listId, itemIds, userDid, legacyDid }), [enqueue, listId]);
  const updateItem = useCallback((args: { itemId: Id<'items'>; userDid: string; legacyDid?: string; [key: string]: unknown }) => enqueue('updateItem', args), [enqueue]);
  const removeItem = useCallback((itemId: Id<'items'>, userDid: string, legacyDid?: string) => enqueue('removeItem', { itemId, userDid, legacyDid }), [enqueue]);
  return { items, addItem, checkItem, uncheckItem, reorderItems, updateItem, removeItem,
    isLoading: serverItems === undefined && cached.scope !== scope && !last.current,
    usingCache: !isOnline && serverItems === undefined && cached.scope === scope };
}
