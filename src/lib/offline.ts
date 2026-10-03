import { openDB, type DBSchema } from 'idb';
import type { Doc } from '../../convex/_generated/dataModel';
import { revision, replayTargets, type ExpectedRevision, type ReplayAck } from '../../shared/replay';
export type OfflineItem = Doc<'items'>;
export type OfflineList = Doc<'lists'>;
export type MutationType = 'addItem' | 'checkItem' | 'uncheckItem' | 'reorderItem' | 'updateItem' | 'removeItem' | 'batchCheckItems' | 'batchUncheckItems' | 'batchDeleteItems' | 'createList' | 'renameList' | 'deleteList';
export interface QueuedMutation {
  id?: number;
  operationId: string;
  accountId: string;
  type: MutationType;
  payload: Record<string, unknown>;
  expected: ExpectedRevision[];
  timestamp: number;
  retryCount: number;
  error?: string;
  state: 'pending' | 'failed' | 'conflict' | 'acked';
  ack?: ReplayAck;
  listIds: string[];
  observedListIds?: string[];
  nextAttemptAt?: number;
}
interface OfflineDB extends DBSchema {
  items: { key: string; value: OfflineItem; indexes: { byList: string } };
  lists: { key: string; value: OfflineList };
  mutations: { key: number; value: QueuedMutation };
}
const connections = new Map<string, ReturnType<typeof openDB<OfflineDB>>>();
const listeners = new Set<() => void>();
const CHANGE_SIGNAL = 'boop-offline-change';
function externalChange(event: StorageEvent) {
  if (event.key === CHANGE_SIGNAL) listeners.forEach(fn => fn());
}
export function subscribeOffline(listener: () => void) {
  if (!listeners.size && typeof window !== 'undefined') window.addEventListener('storage', externalChange);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== 'undefined') window.removeEventListener('storage', externalChange);
  };
}
function changed() {
  listeners.forEach(fn => fn());
  // Only a wake-up nonce crosses tabs, never another account's queue contents.
  // The existing polling fallback still works if browser storage signals fail.
  try { if (typeof window !== 'undefined') window.localStorage.setItem(CHANGE_SIGNAL, crypto.randomUUID()); } catch { /* optional signal */ }
}
export function getOfflineDB(accountId: string) {
  if (!accountId) throw new Error('Sign in to save offline edits');
  let db = connections.get(accountId);
  if (!db) {
    // The unscoped lisa-offline database is deliberately left intact. Its owner
    // cannot be established from caller-supplied DIDs. Never expose/auto-claim it.
    db = openDB<OfflineDB>(`boop-offline-v2:${encodeURIComponent(accountId)}`, 1, { upgrade(db) {
      db.createObjectStore('lists', { keyPath: '_id' });
      db.createObjectStore('items', { keyPath: '_id' }).createIndex('byList', 'listId');
      db.createObjectStore('mutations', { keyPath: 'id', autoIncrement: true });
    } });
    connections.set(accountId, db);
  }
  return db;
}
export async function getOperations(accountId: string): Promise<QueuedMutation[]> {
  if (!accountId) return [];
  return (await getOfflineDB(accountId)).getAll('mutations');
}
export async function getQueuedMutations(accountId: string) { return (await getOperations(accountId)).filter(m => m.state !== 'acked'); }
// Preserve invocation order even when hashing/caching takes different amounts
// of time. IDB still serializes transaction insertion across tabs.
const enqueueTails = new Map<string, Promise<unknown>>();
export function queueMutation(...args: Parameters<typeof enqueueMutation>): Promise<number> {
  const [accountId] = args;
  const next = (enqueueTails.get(accountId) ?? Promise.resolve()).catch(() => undefined).then(() => enqueueMutation(...args));
  enqueueTails.set(accountId, next);
  return next;
}
async function enqueueMutation(accountId: string, input: {
  type: MutationType; payload: unknown; timestamp?: number; retryCount?: number;
}, snapshots: OfflineItem[] = []): Promise<number> {
  const db = await getOfflineDB(accountId);
  const payload = input.payload as Record<string, unknown>;
  const targets = replayTargets(input.type, payload);
  const identities = await db.getAll('mutations');
  // Hash outside the transaction: awaiting crypto within an IDB transaction
  // closes it. Queue predecessor selection + insertion remain one transaction.
  const revisions = new Map<string, string>();
  const sourceOperations = new Map<string, string>();
  const listIds = new Set<string>(typeof payload.listId === "string" ? [payload.listId] : []);
  for (const id of targets) {
    // A dirty form can retain its original temporary ID after the rendered row
    // acquires the server ID. Match aliases before consulting the newer cache;
    // that cache is not the version the user edited.
    const resolvedId = resolveOperationId(id, identities);
    const source = snapshots.find(i => resolveOperationId(i._id, identities) === resolvedId);
    const doc = source ?? await db.get('items', resolvedId) ?? await db.get('lists', resolvedId);
    const sourceOperation = doc && '_operationId' in doc ? doc._operationId : undefined;
    if (typeof sourceOperation === 'string') sourceOperations.set(id, sourceOperation);
    else if (source?._id.startsWith('temp-')) sourceOperations.set(id, source._id.slice(5));
    const clean = doc && Object.fromEntries(Object.entries(doc).filter(([key]) => !['_isOptimistic', '_syncError', '_localKey', '_operationId'].includes(key)));
    revisions.set(id, clean ? await revision(clean) : 'unknown');
    if (doc) listIds.add('listId' in doc ? doc.listId : doc._id);
  }
  const tx = db.transaction('mutations', 'readwrite');
  const prior = await tx.store.getAll();
  const expected = targets.map(id => {
    const resolvedId = resolveOperationId(id, prior);
    const predecessor = [...prior].reverse().find(m => {
      const createsTarget = m.type === 'addItem' && (`temp-${m.operationId}` === id || m.ack?.result === resolvedId);
      const target = m.expected.find(e => resolveOperationId(e.id, prior) === resolvedId);
      if (!createsTarget && !target) return false;
      m.listIds.forEach(list => listIds.add(list));
      // An explicit optimistic draft source pins its exact predecessor, even if
      // newer local operations or a newer cached collaborator version exist.
      if (sourceOperations.has(id)) return sourceOperations.get(id) === m.operationId;
      if (m.state !== 'acked') return true;
      const observed = m.listIds.every(list => m.observedListIds?.includes(list));
      // A response may arrive while the reactive snapshot still shows the base
      // from before that operation. Chain through that receipt, including creates
      // whose real ID is now visible but not yet present in any cached snapshot.
      return revisions.get(id) === 'unknown' || (!observed && (createsTarget || target?.revision === revisions.get(id)));
    });
    return { id, revision: revisions.get(id)!, ...(predecessor ? { predecessor: predecessor.operationId } : {}) };
  });
  const id = await tx.store.add({ ...input, payload, accountId, listIds: [...listIds], operationId: crypto.randomUUID(), expected, state: 'pending', timestamp: input.timestamp ?? Date.now(), retryCount: 0 });
  await tx.done;
  changed();
  return id;
}
export async function saveOperation(accountId: string, mutation: QueuedMutation) {
  if (mutation.accountId !== accountId) throw new Error('Offline account mismatch');
  const tx = (await getOfflineDB(accountId)).transaction('mutations', 'readwrite');
  const previous = await tx.store.get(mutation.id!);
  // A reactive receipt can arrive before the mutation promise (or its error).
  // Never overwrite that stronger acknowledgment with a stale in-flight copy.
  if (previous?.operationId === mutation.operationId) {
    if (previous.state !== 'acked' || mutation.state === 'acked') {
      await tx.store.put({ ...mutation, observedListIds: previous.observedListIds });
    }
  }
  await tx.done; changed();
}
export async function retryOperations(accountId: string) {
  const db = await getOfflineDB(accountId);
  const tx = db.transaction('mutations', 'readwrite');
  for (const m of await tx.store.getAll()) if (m.state === 'failed') await tx.store.put({ ...m, state: 'pending', retryCount: 0, nextAttemptAt: undefined, error: undefined });
  await tx.done; changed();
}
/** Compatibility helper for seeding/upserting unacknowledged cache data. It
 * obeys the same receipt fence as reactive snapshots; it cannot bypass it. */
export async function cacheItems(accountId: string, items: OfflineItem[], listId?: string) {
  if (listId) { await writeListSnapshot(accountId, listId, items, [], true); return; }
  for (const list of new Set(items.map(item => item.listId))) {
    await writeListSnapshot(accountId, list, items.filter(item => item.listId === list), [], false);
  }
}
export async function getCachedItemsByList(accountId: string, listId: string) {
  return (await getCachedListSnapshot(accountId, listId)).items;
}
/** Read the cache and its receipt frontier together, so a mounted hook cannot
 * combine old in-memory items with newly observed acknowledgments from a tab. */
export async function getCachedListSnapshot(accountId: string, listId: string) {
  if (!accountId) return { items: [] as OfflineItem[], operationIds: [] as string[] };
  const tx = (await getOfflineDB(accountId)).transaction(['items', 'mutations']);
  const items = await tx.objectStore('items').index('byList').getAll(listId);
  const operationIds = (await tx.objectStore('mutations').getAll())
    .filter(m => m.observedListIds?.includes(listId)).map(m => m.operationId);
  await tx.done;
  return { items, operationIds };
}
/** Explicit recovery after a definite server conflict. A fresh operation is
 * created; changing content under an already-sent operation ID is forbidden. */
export async function rebaseOperation(accountId: string, id: number, snapshots: OfflineItem[]) {
  const db = await getOfflineDB(accountId);
  const revisions = new Map(await Promise.all(snapshots.map(async doc => [doc._id as string, await revision(doc)] as const)));
  const tx = db.transaction('mutations', 'readwrite');
  const m = await tx.store.get(id);
  if (!m || m.state !== 'conflict') throw new Error('Only a rejected conflict can be reapplied');
  const operations = await tx.store.getAll();
  if (m.expected.some(e => !revisions.has(resolveOperationId(e.id, operations)))) throw new Error('Refresh the list before reviewing this edit');
  const operationId = crypto.randomUUID();
  await tx.store.put({ ...m, operationId, expected: m.expected.map(e => ({ id: e.id, revision: revisions.get(resolveOperationId(e.id, operations))! })), state: 'pending', error: undefined, retryCount: 0, nextAttemptAt: undefined });
  for (const next of await tx.store.getAll()) {
    if (next.id === id) continue;
    if (next.expected.some(e => e.predecessor === m.operationId)) await tx.store.put({ ...next, expected: next.expected.map(e => e.predecessor === m.operationId ? { ...e, predecessor: operationId } : e) });
  }
  await tx.done; changed();
}

/** Cache replacement and overlay retirement commit together. A receipt observed
 * on list B cannot retire an overlay whose list A cache is still stale. */
export function cacheListSnapshot(accountId: string, listId: string, items: OfflineItem[], acknowledgments: ReplayAck[]) {
  return writeListSnapshot(accountId, listId, items, acknowledgments, true);
}
async function writeListSnapshot(accountId: string, listId: string, items: OfflineItem[], acknowledgments: ReplayAck[], replace: boolean): Promise<boolean> {
  const db = await getOfflineDB(accountId);
  const tx = db.transaction(['items', 'mutations'], 'readwrite');
  const itemStore = tx.objectStore('items');
  const mutationStore = tx.objectStore('mutations');
  let updated = false;
  try {
    const acks = new Map(acknowledgments.map(a => [a.operationId, a]));
    const operations = await mutationStore.getAll();
    // Receipt presence in the same server snapshot is a causal fence, including
    // creates/deletes (which have no comparable old/new item pair). Check inside
    // the IDB write transaction: another tab may have advanced it after the query
    // was issued. Refuse incomplete snapshots without touching items or receipts.
    if (operations.some(m => m.observedListIds?.includes(listId) && !acks.has(m.operationId))) {
      await tx.done;
      return false;
    }
    if (replace) for (const id of await itemStore.index('byList').getAllKeys(listId)) await itemStore.delete(id);
    for (const item of items) {
      if (item.listId !== listId) throw new Error('Snapshot list mismatch');
      await itemStore.put(item);
    }
    for (const m of operations) {
      const ack = acks.get(m.operationId);
      if (ack && m.listIds.includes(listId) && !m.observedListIds?.includes(listId)) {
        await mutationStore.put({ ...m, ack, observedListIds: [...m.observedListIds ?? [], listId], state: 'acked', error: undefined });
        updated = true;
      }
    }
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* The transaction may already have aborted. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
  if (updated) changed();
  return true;
}
export function resolveOperationId(id: string, operations: QueuedMutation[]): string {
  if (!id.startsWith('temp-')) return id;
  const create = operations.find(m => m.operationId === id.slice(5));
  return typeof create?.ack?.result === 'string' ? create.ack.result : id;
}
export async function cacheAllLists(accountId: string, lists: OfflineList[]) {
  const tx = (await getOfflineDB(accountId)).transaction('lists', 'readwrite');
  await tx.store.clear();
  for (const list of lists) await tx.store.put(list);
  await tx.done;
}
export async function getAllCachedLists(accountId: string) {
  return accountId ? (await getOfflineDB(accountId)).getAll('lists') : [];
}
