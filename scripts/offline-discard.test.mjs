import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadReplayModules, replayFixture } from './helpers/replay-fixture.mjs';
const modules = await loadReplayModules('offline-discard');
const { offline: store, optimistic: { projectItems }, sync: { SyncManager } } = modules;
async function chain() {
  const f = await replayFixture(modules), account = f.session.accountId;
  const source = structuredClone(f.rows.items);
  await store.cacheListSnapshot(account, 'L1', source, [], 0);
  for (const name of ['Root', 'Child', 'Grandchild']) await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I1', name } }, source);
  const operations = await store.getOperations(account);
  await store.saveOperation(account, { ...operations[0], state: 'conflict' });
  return { f, account, source, operations: await store.getOperations(account) };
}
const ids = operations => operations.map(m => m.operationId);

test('confirmed discard atomically removes the transitive chain, suppresses stale overlays, and preserves other accounts and unrelated work', async () => {
  const { f, account, source, operations } = await chain();
  const root = operations[0];
  f.rows.items.push({ ...f.rows.items[0], _id: 'I2' });
  await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I2', name: 'Unrelated' } }, f.rows.items);
  const other = `${account}-other`, otherDb = await store.getOfflineDB(other);
  for (const m of operations) await otherDb.put('mutations', { ...m, accountId: other });
  let notifications = 0;
  const unsubscribe = store.subscribeOffline(() => notifications++);
  try {
    assert.equal(await store.discardOperation(account, root.operationId, ids(operations)), 3);
    assert.equal(notifications, 1);
    const left = await store.getOperations(account);
    assert.equal(left.length, 1);
    assert.equal(left[0].payload.name, 'Unrelated');
    assert.deepEqual(ids(await store.getOperations(other)), ids(operations));
    const cached = await store.getCachedListSnapshot(account, 'L1');
    assert.equal(cached.sequence, 0, 'discard never resets the accepted server fence');
    assert.equal(projectItems(source, operations, 'L1', new Set(), [], cached)[0].name, 'Milk');
    await store.saveOperation(account, { ...root, state: 'acked', ack: { operationId: root.operationId, result: null, revisions: {} } });
    await store.saveOperation(account, { ...operations[1], state: 'failed' });
    assert.equal((await store.getOperations(account)).length, 1, 'late responses cannot resurrect deleted rows');
    await new SyncManager().sync(f.client, f.session);
    assert.equal(f.rows.items.find(i => i._id === 'I2').name, 'Unrelated');
  } finally { unsubscribe(); }
});

test('temporary create references cascade even without a predecessor edge; acknowledged evidence stays', async () => {
  const { account, operations } = await chain();
  const db = await store.getOfflineDB(account);
  const create = { ...operations[0], type: 'addItem', payload: { listId: 'L1', name: 'Root' }, expected: [], state: 'failed' };
  await db.put('mutations', create);
  const child = { ...operations[1], type: 'addItem', payload: { listId: 'L1', parentId: `temp-${create.operationId}`, name: 'Child' }, expected: [] };
  await db.put('mutations', child);
  const acknowledged = { ...operations[2], state: 'acked', ack: { operationId: operations[2].operationId, result: null, revisions: {} } };
  await db.put('mutations', acknowledged);
  assert.deepEqual(ids(store.discardCascade(await store.getOperations(account), create.operationId)), [create.operationId, child.operationId]);
  await store.discardOperation(account, create.operationId, [create.operationId, child.operationId]);
  assert.deepEqual(ids(await store.getOperations(account)), [acknowledged.operationId]);
  await assert.rejects(store.queueMutation(account, { type: 'addItem', payload: { listId: 'L1', parentId: `temp-${create.operationId}`, name: 'Stale child' } }), /discarded edit/);
});

test('stale confirmation rejects changed dependencies, retry state, and rebased operation identity', async () => {
  const { account, source, operations } = await chain();
  const root = operations[0], reviewed = ids(operations);
  await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I1', name: 'New dependent' } }, source);
  await assert.rejects(store.discardOperation(account, root.operationId, reviewed), /Dependent edits changed/);
  assert.equal((await store.getOperations(account)).length, 4);
  await store.rebaseOperation(account, root.id, source);
  await assert.rejects(store.discardOperation(account, root.operationId, ids(await store.getOperations(account))), /edit changed/);
  const rebased = (await store.getOperations(account))[0];
  await assert.rejects(store.discardOperation(account, rebased.operationId, ids(await store.getOperations(account))), /edit changed/);
  await store.saveOperation(account, { ...rebased, state: 'failed' });
  const reviewedAgain = ids(await store.getOperations(account));
  await store.prepareOperationForSync(account, rebased.id, rebased.operationId);
  await assert.rejects(store.discardOperation(account, rebased.operationId, reviewedAgain), /edit changed/);
  assert.equal((await store.getOperations(account)).length, 4);
});

test('discard rollback retains all rows and creates no suppression tombstones', async () => {
  const { account, operations } = await chain();
  const remove = IDBObjectStore.prototype.delete;
  let count = 0;
  IDBObjectStore.prototype.delete = function (...args) {
    if (this.name === 'mutations' && this.transaction.db.name.endsWith(encodeURIComponent(account)) && ++count === 2) throw Error('Injected delete failure');
    return remove.apply(this, args);
  };
  try { await assert.rejects(store.discardOperation(account, operations[0].operationId, ids(operations)), /Injected/); }
  finally { IDBObjectStore.prototype.delete = remove; }
  assert.deepEqual(ids(await store.getOperations(account)), ids(operations));
  assert.equal(await (await store.getOfflineDB(account)).get('metadata', `discarded:${operations[0].operationId}`), undefined);
});

test('an enqueue already hashing a dirty draft cannot recreate a successor after its predecessor is discarded', async () => {
  const { account, operations, source } = await chain();
  const draft = projectItems(source, [operations[0]], 'L1')[0];
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  const descriptor = Object.getOwnPropertyDescriptor(crypto.subtle, 'digest');
  let started, release;
  const hashing = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  Object.defineProperty(crypto.subtle, 'digest', { configurable: true, value: async (...args) => { started(); await gate; return digest(...args); } });
  try {
    const queued = store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I1', priority: 'high' } }, [draft]);
    const rejected = assert.rejects(queued, /discarded edit/);
    await hashing;
    await store.discardOperation(account, operations[0].operationId, ids(operations));
    release(); await rejected;
    assert.deepEqual(await store.getOperations(account), []);
  } finally { release(); if (descriptor) Object.defineProperty(crypto.subtle, 'digest', descriptor); else delete crypto.subtle.digest; }
});

test('active drain never sends a discarded row from its earlier queue snapshot', async () => {
  const { f, account, operations } = await chain();
  const db = await store.getOfflineDB(account);
  // Put unrelated work first; its delayed response leaves the drain holding the
  // soon-to-be-discarded failed chain in the same initial getAll snapshot.
  await db.clear('mutations');
  f.rows.items.push({ ...f.rows.items[0], _id: 'I2' });
  await db.put('mutations', { ...operations[0], id: 1, operationId: 'unrelated-first', state: 'pending', expected: [], payload: { listId: 'L1', name: 'Unrelated create', createdAt: 1 }, type: 'addItem' });
  const parked = operations.map((m, index) => ({ ...m, id: index + 2, state: index ? 'pending' : 'failed' }));
  for (const m of parked) await db.put('mutations', m);
  let started, release;
  const gate = new Promise(resolve => { started = resolve; });
  const response = new Promise(resolve => { release = resolve; });
  const calls = [];
  const manager = new SyncManager();
  const running = manager.sync({ mutation: async (ref, args) => { calls.push(args.replay.operationId); const ack = await f.client.mutation(ref, args); started(); await response; return ack; } }, f.session);
  await gate;
  await store.discardOperation(account, parked[0].operationId, ids(parked));
  release(); await running;
  assert.deepEqual(calls, ['unrelated-first']);
  assert.equal((await store.getQueuedMutations(account)).length, 0);
});

for (const revokeAt of [1, 2]) test(`account/session revocation at discard guard ${revokeAt} aborts the entire transaction`, async () => {
  const { account, operations } = await chain();
  let checks = 0;
  await assert.rejects(store.discardOperation(account, operations[0].operationId, ids(operations), () => ++checks < revokeAt), /Sign in again/);
  assert.deepEqual(ids(await store.getOperations(account)), ids(operations));
  const db = await store.getOfflineDB(account);
  assert.equal(await db.get('metadata', `discarded:${operations[0].operationId}`), undefined);
  assert.equal((await store.getCachedListSnapshot(account, 'L1')).sequence, 0);
});
