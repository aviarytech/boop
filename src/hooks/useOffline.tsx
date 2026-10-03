import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { useConvex } from 'convex/react';
import { useAuth } from './useAuth';
import { syncManager, type SyncStatus } from '../lib/sync';
import { queueMutation as enqueue, retryOperations, type OfflineItem } from '../lib/offline';
import { offlineObserver } from '../lib/offlineObserver';
import { getNetworkStatus, onNetworkChange } from '../lib/network';

export function useOffline() {
  const { user, token } = useAuth();
  const accountId = user?.turnkeySubOrgId ?? '';
  const convex = useConvex();
  const [isOnline, setOnline] = useState(getNetworkStatus());
  const [status, setStatus] = useState<SyncStatus>({ status: 'idle' });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = useRef({ accountId, token });
  current.current = { accountId, token };
  const observer = offlineObserver(accountId);
  const sync = useCallback(() => {
    if (!accountId || !token || !observer.hasSession(token) || !getNetworkStatus()) return;
    return syncManager.sync(convex, { accountId, token }, () => observer.hasSession(token));
  }, [convex, accountId, token, observer]);
  useEffect(() => onNetworkChange(setOnline), []);
  useEffect(() => syncManager.subscribe(s => { if (s.accountId === current.current.accountId) setStatus(s); }), []);
  const subscribe = useCallback((listener: () => void) => observer.subscribe(listener, () => { void sync(); }, token ? {
    token,
    isCurrent: () => mounted.current && current.current.accountId === accountId && current.current.token === token,
  } : undefined), [observer, sync, accountId, token]);
  const saved = useSyncExternalStore(subscribe, observer.getSnapshot, observer.getSnapshot);
  useEffect(() => { if (isOnline) void sync(); }, [isOnline, sync]);
  const queueMutation = useCallback(async (input: Parameters<typeof enqueue>[1], snapshots?: OfflineItem[]) => {
    if (!mounted.current || !token || current.current.accountId !== accountId || current.current.token !== token) throw new Error('Sign in to save this edit');
    const id = await enqueue(accountId, input, snapshots);
    void sync();
    return id;
  }, [accountId, token, sync]);
  const manualSync = useCallback(async () => { await retryOperations(accountId); await sync(); }, [accountId, sync]);
  const operations = saved.operations;
  const pending = operations.filter(m => m.state !== 'acked');
  const syncStatus: SyncStatus = status.accountId === accountId ? { ...status } : { status: 'idle' };
  // A successful earlier run must never hide subsequently queued/failed work.
  if (pending.length && syncStatus.status === 'synced') syncStatus.status = 'idle';
  if (!pending.length && syncStatus.status === 'error') { syncStatus.status = 'idle'; syncStatus.message = undefined; }
  return { isOnline, syncStatus, pendingCount: pending.length, manualSync, queueMutation, operations, accountId, aliases: saved.aliases, compaction: saved };
}
