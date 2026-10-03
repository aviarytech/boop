import type { ConvexReactClient } from 'convex/react';
import { ConvexError } from 'convex/values';
import { api } from '../../convex/_generated/api';
import { authErrorData } from '../../convex/lib/authError';
import { getOperations, getQueuedMutations, saveOperation, type MutationType, type QueuedMutation } from './offline';
import type { ReplayAck } from '../../shared/replay';
export type SyncStatusType = 'idle' | 'syncing' | 'synced' | 'error';
export interface SyncStatus { status: SyncStatusType; message?: string; accountId?: string }
export interface SyncSession { accountId: string; token: string }
const endpoints = {
  addItem: api.items.addItemReplay, checkItem: api.items.checkItemReplay,
  uncheckItem: api.items.uncheckItemReplay, updateItem: api.items.updateItemReplay,
  removeItem: api.items.removeItemReplay, reorderItem: api.items.reorderItemsReplay,
  batchCheckItems: api.items.batchCheckItemsReplay, batchUncheckItems: api.items.batchUncheckItemsReplay,
  batchDeleteItems: api.items.batchDeleteItemsReplay, createList: api.lists.createListReplay,
  renameList: api.lists.renameListReplay, deleteList: api.lists.deleteListReplay,
} satisfies Record<MutationType, unknown>;
export class SyncManager {
  private running = new Set<string>();
  private rerun = new Map<string, { convex: ConvexReactClient; session: SyncSession; isCurrent: () => boolean }>();
  private listeners = new Set<(status: SyncStatus) => void>();
  async sync(convex: ConvexReactClient, session: SyncSession, isCurrent: () => boolean = () => true): Promise<void> {
    const { accountId, token } = session;
    if (!accountId || !token || !isCurrent()) return;
    if (this.running.has(accountId)) {
      this.rerun.set(accountId, { convex, session, isCurrent });
      return;
    }
    this.running.add(accountId);
    const notify = (status: SyncStatus) => { if (isCurrent()) this.listeners.forEach(fn => fn({ ...status, accountId })); };
    notify({ status: 'syncing' });
    try {
      const attempted = new Set<string>();
      while (isCurrent()) {
        const operations = await getOperations(accountId);
        const acknowledged = new Map(operations.filter(m => m.ack).map(m => [m.operationId, m.ack!]));
        for (const m of operations) {
          if (!isCurrent()) return;
          if (attempted.has(m.operationId) || m.state === 'acked' || m.state === 'conflict' || m.retryCount >= 5 || (m.nextAttemptAt ?? 0) > Date.now()) continue;
          if (m.accountId !== accountId) throw new Error('Offline account mismatch');
          if (m.expected.some(e => e.predecessor && operations.some(prior => prior.operationId === e.predecessor) && !acknowledged.has(e.predecessor))) continue;
          attempted.add(m.operationId);
          try {
            const ack = await this.executeMutation(convex, m, token, acknowledged);
            if (ack.operationId !== m.operationId) throw new Error('Missing operation acknowledgment');
            // Always persist an in-flight old-account acknowledgment to its own DB.
            await saveOperation(accountId, { ...m, state: 'acked', ack, error: undefined });
            acknowledged.set(m.operationId, ack);
          } catch (error) {
            const auth = authErrorData(error);
            if (auth && auth.code !== 'FORBIDDEN') {
              notify({ status: 'error', message: 'Sync paused. Sign in with the account that made these edits; your changes are still saved.' });
              return;
            }
            const conflict = error instanceof ConvexError && error.data?.code === 'REPLAY_CONFLICT';
            const message = conflict ? String(error.data.message) : error instanceof Error ? error.message : 'Sync failed';
            await saveOperation(accountId, { ...m, retryCount: m.retryCount + 1, state: conflict ? 'conflict' : 'failed', nextAttemptAt: Date.now() + 1000 * 2 ** m.retryCount, error: message });
          }
        }
        const fresh = await getQueuedMutations(accountId);
        if (!fresh.some(m => !attempted.has(m.operationId) && m.state !== 'conflict' && m.retryCount < 5 && (m.nextAttemptAt ?? 0) <= Date.now() && m.expected.every(e => !e.predecessor || !fresh.some(prior => prior.operationId === e.predecessor)))) break;
      }
      const remaining = await getQueuedMutations(accountId);
      notify(remaining.length ? { status: 'error', message: `${remaining.length} saved edit(s) still need syncing. Review conflicts or retry failed edits.` } : { status: 'synced' });
    } catch (error) {
      notify({ status: 'error', message: error instanceof Error ? error.message : 'Sync failed; edits remain saved.' });
    } finally {
      this.running.delete(accountId);
      const next = this.rerun.get(accountId);
      this.rerun.delete(accountId);
      if (next?.isCurrent()) await this.sync(next.convex, next.session, next.isCurrent);
    }
  }
  private async executeMutation(convex: ConvexReactClient, m: QueuedMutation, token: string, acknowledged: Map<string, ReplayAck>): Promise<ReplayAck> {
    const resolveId = (id: string) => id.startsWith('temp-') ? String(acknowledged.get(id.slice(5))?.result ?? id) : id;
    const payload = Object.fromEntries(Object.entries(m.payload).filter(([key]) => !['userDid', 'createdByDid', 'checkedByDid', 'ownerDid', 'legacyDid', 'authToken', 'apiKey'].includes(key)));
    for (const key of ['itemId', 'listId']) if (typeof payload[key] === 'string') payload[key] = resolveId(payload[key]);
    if (Array.isArray(payload.itemIds)) payload.itemIds = payload.itemIds.map(resolveId);
    return convex.mutation(endpoints[m.type], { ...payload, authToken: token, replay: { operationId: m.operationId, accountId: m.accountId, expected: m.expected.map(e => ({ ...e, id: resolveId(e.id) })) } } as never);
  }
  subscribe(listener: (status: SyncStatus) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  get syncing() { return this.running.size > 0; }
}
export const syncManager = new SyncManager();
