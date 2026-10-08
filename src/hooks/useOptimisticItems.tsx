import { canonical, type ReplayAck } from '../../shared/replay';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useQuery } from '../lib/authenticatedConvex';
import { api } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { useOffline } from './useOffline';
import { cacheListSnapshot, getCachedListSnapshot, replayOperationIds, type OfflineItem } from '../lib/offline';
import { projectItems } from '../lib/optimisticItems';
const EMPTY_ITEMS: OfflineItem[] = [];
const EMPTY_ACKNOWLEDGMENTS: ReplayAck[] = [];
const EMPTY_OPERATION_IDS: string[] = [];
export type BatchMutationType = 'batchCheckItems' | 'batchUncheckItems' | 'batchDeleteItems';
export interface OptimisticItem extends Doc<'items'> { assigneeDids?: string[]; _isOptimistic?: boolean; _syncError?: string; _localKey?: string; _operationId?: string }

/** Durable queue entries are the optimistic state, including after reload.
 * Acknowledgments identify creates by operation ID; names and clocks never do.
 * Every list edit queues against the same server/cache base rows. */
export function useOptimisticItems(listId: Id<'lists'>) {
  const { isOnline, accountId, operations, queueMutation, aliases, compaction } = useOffline();
  const [scanOffset, setScanOffset] = useState(0);
  const needsReceiptScan = operations.filter(m => m.listIds.includes(listId) && m.state !== 'acked' && m.state !== 'conflict').length > 64;
  useEffect(() => {
    if (!needsReceiptScan) return;
    const timer = setInterval(() => setScanOffset(offset => offset + 64), 5000);
    return () => clearInterval(timer);
  }, [accountId, listId, needsReceiptScan]);
  const snapshot = useQuery(api.items.getListItemsForReplay, { listId, operationIds: replayOperationIds(operations, listId, scanOffset) });
  const revoked = compaction?.revokedListIds?.includes(listId) ?? false;
  const scope = `${accountId}:${listId}`;
  type CachedSnapshot = Awaited<ReturnType<typeof getCachedListSnapshot>> & { scope: string };
  const [cached, setCached] = useState<CachedSnapshot>({ scope: '', items: [], operationIds: [], acknowledgments: [], sequence: undefined, retiredThrough: 0, retainedOperationIds: [] });
  type Base = { items: OfflineItem[]; operationIds: string[]; acknowledgments: ReplayAck[]; sequence?: number; scope: string };
  const last = useRef<Base | undefined>(undefined);
  if (last.current?.scope !== scope) last.current = undefined;
  const acceptedSequence = Math.max(cached.scope === scope ? cached.sequence ?? -1 : -1, last.current?.sequence ?? -1, compaction?.sequences?.[listId] ?? -1);
  const frontier = new Set([
    ...operations.filter(m => m.observedListIds?.includes(listId)).map(m => m.operationId),
    ...(cached.scope === scope ? cached.operationIds : []),
  ]);
  const coversFrontier = (candidate: { sequence?: number; operationIds: string[] }) => {
    if (candidate.sequence !== undefined) return candidate.sequence >= acceptedSequence;
    return acceptedSequence < 0 && [...frontier].every(id => candidate.operationIds.includes(id));
  };
  const snapshotIds = useMemo(() => snapshot?.acknowledgments.map(a => a.operationId) ?? EMPTY_OPERATION_IDS, [snapshot]);
  const server = snapshot && coversFrontier({ sequence: snapshot.sequence, operationIds: snapshotIds })
    ? { ...snapshot, operationIds: snapshotIds, scope } : undefined;
  if (server && accountId && !revoked) last.current = server;
  useEffect(() => {
    let active = true;
    const persist = async () => {
      if (snapshot && accountId && !revoked) await cacheListSnapshot(accountId, listId, snapshot.items, snapshot.acknowledgments, snapshot.sequence);
      const stored = await getCachedListSnapshot(accountId, listId);
      if (active) setCached({ scope, ...stored });
    };
    void persist();
    return () => { active = false; };
  }, [snapshot, accountId, listId, scope, operations, revoked]);
  const lastBase = last.current && coversFrontier(last.current) ? last.current : undefined;
  // The shared observer may advance before this hook's cache effect. Carry
  // its atomic item snapshot too, so compaction cannot expose an older fallback
  // or briefly unmount an open row while the per-list cache read catches up.
  const sharedBase = useMemo(() => compaction?.items ? {
    items: compaction.items.filter(item => item.listId === listId),
    sequence: compaction.sequences?.[listId],
    operationIds: compaction.operations.filter(m => m.observedListIds?.includes(listId)).map(m => m.operationId),
    acknowledgments: compaction.operations.filter(m => m.observedListIds?.includes(listId)).flatMap(m => m.ack ? [m.ack] : []),
  } : undefined, [compaction, listId]);
  const selected = accountId ? server ?? lastBase ?? (cached.scope === scope && coversFrontier(cached) ? cached : undefined)
    ?? (sharedBase && coversFrontier(sharedBase) ? sharedBase : undefined) : undefined;
  const base = useMemo(() => revoked ? EMPTY_ITEMS : (selected?.items ?? EMPTY_ITEMS).filter(item => !compaction?.unavailableItemIds?.includes(item._id)), [revoked, selected?.items, compaction?.unavailableItemIds]);
  const baseOperationIds = selected?.operationIds ?? EMPTY_OPERATION_IDS;
  const baseAcknowledgments = selected?.acknowledgments ?? EMPTY_ACKNOWLEDGMENTS;
  const baseSequence = selected?.sequence;
  const previousProjection = useRef<{ scope: string; items: OptimisticItem[] }>({ scope, items: [] });
  useEffect(() => {
    if (revoked) { last.current = undefined; previousProjection.current = { scope, items: [] }; }
  }, [revoked, scope]);
  const items = useMemo(() => {
    if (revoked) return EMPTY_ITEMS;
    const identities = { ...Object.fromEntries((previousProjection.current.scope === scope ? previousProjection.current.items : []).filter(i => i._localKey).map(i => [i._id, i._localKey!])), ...Object.fromEntries((cached.scope === scope ? cached.items : []).filter(i => i._localKey).map(i => [i._id, i._localKey!])), ...aliases };
    const proof = cached.scope === scope && cached.retiredThrough > (compaction?.retiredThrough ?? 0) ? cached : compaction;
    const projected = projectItems(base, operations, listId, new Set(baseOperationIds), baseAcknowledgments, { ...proof, aliases: identities, sequence: baseSequence });
    const previous = new Map((previousProjection.current.scope === scope ? previousProjection.current.items : []).map(i => [i._id, i]));
    const stable = projected.map(item => {
      const old = previous.get(item._id);
      return old && canonical(old) === canonical(item) ? old : item;
    });
    previousProjection.current = { scope, items: stable };
    return stable;
  }, [base, operations, listId, baseOperationIds, baseAcknowledgments, baseSequence, aliases, compaction, cached, scope, revoked]);
  const snapshots = useRef(base);
  snapshots.current = base;
  const enqueue = useCallback((type: Parameters<typeof queueMutation>[0]['type'], payload: unknown) => queueMutation({ type, payload }, snapshots.current).then(() => undefined), [queueMutation]);
  const addItem = useCallback((args: { name: string; createdByDid: string; legacyDid?: string; createdAt: number }) => enqueue('addItem', { listId, ...args }), [enqueue, listId]);
  const checkItem = useCallback((itemId: Id<'items'>, checkedByDid: string, legacyDid?: string) => enqueue('checkItem', { itemId, checkedByDid, legacyDid, checkedAt: Date.now() }), [enqueue]);
  const uncheckItem = useCallback((itemId: Id<'items'>, userDid: string, legacyDid?: string) => enqueue('uncheckItem', { itemId, userDid, legacyDid }), [enqueue]);
  const reorderItems = useCallback((itemIds: Id<'items'>[], userDid: string, legacyDid?: string) => enqueue('reorderItem', { listId, itemIds, userDid, legacyDid }), [enqueue, listId]);
  const updateItem = useCallback((args: { itemId: Id<'items'>; userDid: string; legacyDid?: string; [key: string]: unknown }) => enqueue('updateItem', args), [enqueue]);
  const removeItem = useCallback((itemId: Id<'items'>, userDid: string, legacyDid?: string) => enqueue('removeItem', { itemId, userDid, legacyDid }), [enqueue]);
  const queueBatch = useCallback((type: BatchMutationType, payload: { itemIds: Id<'items'>[]; [key: string]: unknown }) => enqueue(type, payload), [enqueue]);
  return { items, addItem, checkItem, uncheckItem, reorderItems, updateItem, removeItem, queueBatch,
    isLoading: server === undefined && cached.scope !== scope && !last.current,
    usingCache: !isOnline && server === undefined && cached.scope === scope };
}
