import { canonical } from '../../shared/replay';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useConvex } from 'convex/react';
import { useAuth } from './useAuth';
import { syncManager, type SyncStatus } from '../lib/sync';
import { getOperations, queueMutation as enqueue, retryOperations, subscribeOffline, type QueuedMutation, type OfflineItem } from '../lib/offline';
import { getNetworkStatus, onNetworkChange } from '../lib/network';

export function useOffline() {
  const { user, token } = useAuth();
  const accountId = user?.turnkeySubOrgId ?? '';
  const convex = useConvex();
  const [isOnline, setOnline] = useState(getNetworkStatus());
  const [status, setStatus] = useState<SyncStatus>({ status: 'idle' });
  const [saved, setSaved] = useState<{ accountId: string; operations: QueuedMutation[] }>({ accountId: '', operations: [] });
  const current = useRef({ accountId, token });
  current.current = { accountId, token };
  const sync = useCallback(() => {
    if (!accountId || !token || !getNetworkStatus()) return;
    return syncManager.sync(convex, { accountId, token }, () => current.current.accountId === accountId && current.current.token === token);
  }, [convex, accountId, token]);
  useEffect(() => onNetworkChange(setOnline), []);
  useEffect(() => syncManager.subscribe(s => { if (s.accountId === current.current.accountId) setStatus(s); }), []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const operations = await getOperations(accountId);
      if (active) setSaved(previous => previous.accountId === accountId && canonical(previous.operations) === canonical(operations) ? previous : { accountId, operations });
    };
    void refresh();
    const unsubscribe = subscribeOffline(() => void refresh());
    const timer = setInterval(() => { void refresh(); void sync(); }, 5000);
    return () => { active = false; unsubscribe(); clearInterval(timer); };
  }, [accountId, sync]);
  useEffect(() => { if (isOnline) void sync(); }, [isOnline, sync]);
  const queueMutation = useCallback(async (input: Parameters<typeof enqueue>[1], snapshots?: OfflineItem[]) => {
    if (!token || current.current.accountId !== accountId) throw new Error('Sign in to save this edit');
    const id = await enqueue(accountId, input, snapshots);
    void sync();
    return id;
  }, [accountId, token, sync]);
  const manualSync = useCallback(async () => { await retryOperations(accountId); await sync(); }, [accountId, sync]);
  const operations = saved.accountId === accountId ? saved.operations : [];
  const pending = operations.filter(m => m.state !== 'acked');
  const syncStatus: SyncStatus = status.accountId === accountId ? { ...status } : { status: 'idle' };
  // A successful earlier run must never hide subsequently queued/failed work.
  if (pending.length && syncStatus.status === 'synced') syncStatus.status = 'idle';
  return { isOnline, syncStatus, pendingCount: pending.length, manualSync, queueMutation, operations, accountId };
}
