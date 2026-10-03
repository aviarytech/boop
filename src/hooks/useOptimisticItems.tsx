import { canonical } from '../../shared/replay';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useQuery } from '../lib/authenticatedConvex';
import { api } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { useOffline } from './useOffline';
import { cacheListSnapshot, getCachedItemsByList, type OfflineItem } from '../lib/offline';
import { projectItems } from '../lib/optimisticItems';
const EMPTY_ITEMS: OfflineItem[] = [];
export interface OptimisticItem extends Doc<'items'> { _isOptimistic?: boolean; _syncError?: string; _localKey?: string; _operationId?: string }

/** Durable queue entries are the optimistic state, including after reload.
 * Acknowledgments identify creates by operation ID; names and clocks never do. */
export function useOptimisticItems(listId: Id<'lists'>) {
  const { isOnline, accountId, operations, queueMutation } = useOffline();
  const snapshot = useQuery(api.items.getListItemsForReplay, { listId, operationIds: operations.filter(m => m.listIds.includes(listId) && !m.observedListIds?.includes(listId)).map(m => m.operationId) });
  const serverItems = snapshot?.items;
  useEffect(() => {
    if (snapshot && accountId) void cacheListSnapshot(accountId, listId, snapshot.items, snapshot.acknowledgments);
  }, [snapshot, accountId, listId]);
  const scope = `${accountId}:${listId}`;
  const [cached, setCached] = useState<{ scope: string; items: OfflineItem[] }>({ scope: '', items: [] });
  const last = useRef<{ scope: string; items: OfflineItem[] } | undefined>(undefined);
  if (last.current?.scope !== scope) last.current = undefined;
  if (serverItems && accountId) last.current = { scope, items: serverItems };
  useEffect(() => {
    let active = true;
    void getCachedItemsByList(accountId, listId).then(items => { if (active) setCached({ scope, items }); });
    return () => { active = false; };
  }, [accountId, listId, scope]);
  const base = accountId ? serverItems ?? last.current?.items ?? (cached.scope === scope ? cached.items : EMPTY_ITEMS) : EMPTY_ITEMS;
  const previousProjection = useRef<{ scope: string; items: OptimisticItem[] }>({ scope, items: [] });
  const items = useMemo(() => {
    const projected = projectItems(base, operations, listId, new Set(snapshot?.acknowledgments.map(a => a.operationId) ?? []));
    const previous = new Map((previousProjection.current.scope === scope ? previousProjection.current.items : []).map(i => [i._id, i]));
    const stable = projected.map(item => {
      const old = previous.get(item._id);
      return old && canonical(old) === canonical(item) ? old : item;
    });
    previousProjection.current = { scope, items: stable };
    return stable;
  }, [base, operations, listId, snapshot, scope]);
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
