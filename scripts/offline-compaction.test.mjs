import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDB } from 'idb';
import { loadReplayModules, replayFixture } from './helpers/replay-fixture.mjs';
const modules = await loadReplayModules('offline-compaction');
const { offline: store, sync: { SyncManager }, optimistic: { projectItems } } = modules;
const observe = async f => {
  const operations = await store.getOperations(f.session.accountId);
  const ids = store.replayOperationIds(operations, 'L1');
  assert.ok(ids.length <= 128);
  const snapshot = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: ids });
  assert.equal(await store.cacheListSnapshot(f.session.accountId, 'L1', snapshot.items, snapshot.acknowledgments, snapshot.sequence), true);
  return snapshot;
};
const edit = async (f, payload) => {
  await store.queueMutation(f.session.accountId, { type: 'updateItem', payload }, f.rows.items);
  await new SyncManager().sync(f.client, f.session);
  return observe(f);
};

test('thousands of observed edits compact history without losing sequence fences, aliases, old draft predecessors or server receipts', { timeout: 60_000 }, async () => {
  const f = await replayFixture(modules), account = f.session.accountId;
  await store.queueMutation(account, { type: 'addItem', payload: { listId: 'L1', name: 'Draft original', createdAt: 1, createdByDid: f.owner.user.did } });
  const create = (await store.getOperations(account))[0];
  const tempSource = projectItems([], [create], 'L1')[0];
  let firstRequest;
  await new SyncManager().sync({ mutation: async (ref, args) => { firstRequest = { ref, args }; return f.client.mutation(ref, args); } }, f.session);
  const early = await observe(f);
  const realId = early.acknowledgments[0].result;
  // Capture a dirty optimistic source on a different item before its receipt
  // becomes old history. It must still pin this exact version after pruning.
  await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I1', name: 'First local update' } }, f.rows.items);
  const oldUpdate = (await store.getOperations(account)).at(-1);
  const oldSource = projectItems(f.rows.items, [oldUpdate], 'L1').find(i => i._id === 'I1');
  await new SyncManager().sync(f.client, f.session);
  await observe(f);
  for (let index = 0; index < 2048; index++) {
    await edit(f, { itemId: 'I1', name: `Healthy edit ${index}` });
    assert.ok((await store.getOperations(account)).length <= store.RECENT_OPERATIONS);
  }
  const remaining = await store.getOperations(account);
  assert.equal(remaining.length, store.RECENT_OPERATIONS);
  assert.ok(!remaining.some(m => m.operationId === create.operationId || m.operationId === oldUpdate.operationId));
  assert.deepEqual(store.replayOperationIds(remaining, 'L1'), []);
  const cache = await store.getCachedListSnapshot(account, 'L1');
  assert.equal(cache.sequence, 2050);
  assert.equal(cache.items.find(i => i._id === realId)._localKey, create.operationId);
  const state = await store.getOfflineState(account);
  assert.equal(state.aliases[realId], create.operationId);
  // A sleeping tab's old queue copy must not resurrect the retired create/edit.
  const projected = projectItems(cache.items, [create, oldUpdate], 'L1', new Set(cache.operationIds), cache.acknowledgments, { ...cache, aliases: state.aliases, sequence: cache.sequence });
  assert.equal(projected.filter(i => i._id === realId).length, 1);
  assert.equal(projected.find(i => i._id === 'I1').name, 'Healthy edit 2047');
  assert.equal(await store.cacheListSnapshot(account, 'L1', early.items, early.acknowledgments, early.sequence), false);
  assert.equal(await store.cacheListSnapshot(account, 'L1', early.items, early.acknowledgments), false);
  await store.cacheItems(account, early.items, 'L1');
  assert.equal((await store.getCachedListSnapshot(account, 'L1')).sequence, 2050);
  await store.saveOperation(account, { ...create, state: 'failed' });
  assert.equal((await store.getOperations(account)).length, store.RECENT_OPERATIONS, 'late in-flight response cannot resurrect compacted row');
  const receiptCount = f.rows.offlineReceipts.length;
  const duplicate = await f.client.mutation(firstRequest.ref, firstRequest.args);
  assert.equal(duplicate.sequence, 1);
  assert.equal(f.rows.offlineReceipts.length, receiptCount);
  assert.equal(f.rows.users[0].replaySequence, 2050, 'duplicate does not advance sequence');
  await f.call('items', 'updateItem', { itemId: realId, name: 'Collaborator rename' }, f.collaborator);
  await observe(f);
  await store.queueMutation(account, { type: 'updateItem', payload: { itemId: realId, name: 'Draft original', priority: 'high' } }, [tempSource]);
  await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I1', name: 'Old draft update' } }, [oldSource]);
  const dirty = await store.getQueuedMutations(account);
  assert.equal(dirty[0].expected[0].predecessor, create.operationId);
  assert.equal(dirty[1].expected[0].predecessor, oldUpdate.operationId);
  await new SyncManager().sync(f.client, f.session);
  assert.ok((await store.getQueuedMutations(account)).every(m => m.state === 'conflict'));
  assert.equal(f.rows.items.find(i => i._id === realId).name, 'Collaborator rename');
  assert.equal(f.rows.items.find(i => i._id === 'I1').name, 'Healthy edit 2047');
  const other = await replayFixture(modules);
  assert.deepEqual(await store.getOperations(other.session.accountId), []);
  assert.deepEqual((await store.getOfflineState(other.session.accountId)).aliases, {});
});

test('compacted predecessor can still replay, retained low-ID pending work and direct dependencies survive', async () => {
  const f = await replayFixture(modules), account = f.session.accountId;
  await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I1', name: 'Pending low row' } }, f.rows.items);
  const pending = (await store.getOperations(account))[0];
  await store.saveOperation(account, { ...pending, state: 'failed', retryCount: 5 });
  await store.queueMutation(account, { type: 'addItem', payload: { listId: 'L1', name: 'Stable draft', createdAt: 1, createdByDid: f.owner.user.did } });
  const create = (await store.getOperations(account)).at(-1);
  const draft = projectItems([], [create], 'L1')[0];
  await new SyncManager().sync(f.client, f.session);
  let snapshot = await observe(f);
  const realId = snapshot.acknowledgments.find(a => a.operationId === create.operationId).result;
  // Independent item, so the draft predecessor's server revision remains valid.
  f.rows.items.push({ ...f.rows.items[0], _id: 'I2' });
  for (let i = 0; i < 40; i++) snapshot = await edit(f, { itemId: 'I2', name: `Other ${i}` });
  const cache = await store.getCachedListSnapshot(account, 'L1');
  assert.ok(cache.retiredThrough > pending.id);
  const operations = await store.getOperations(account);
  assert.ok(operations.some(m => m.id === pending.id));
  assert.ok(!operations.some(m => m.operationId === create.operationId));
  assert.equal(projectItems(cache.items, operations, 'L1', new Set(cache.operationIds), cache.acknowledgments, cache).find(i => i._id === 'I1').name, 'Pending low row');
  await store.queueMutation(account, { type: 'updateItem', payload: { itemId: draft._id, priority: 'high' } }, [draft]);
  const editOperation = (await store.getOperations(account)).at(-1);
  assert.equal(editOperation.payload.itemId, realId, 'durable alias resolves a stale temporary target');
  assert.equal(editOperation.expected[0].predecessor, create.operationId);
  await new SyncManager().sync(f.client, f.session);
  assert.equal(f.rows.items.find(i => i._id === realId).priority, 'high');
  assert.equal((await store.getQueuedMutations(account)).length, 1);
  const beforeLate = await observe(f);
  await store.retryOperations(account);
  await new SyncManager().sync(f.client, f.session);
  const afterLate = await observe(f);
  assert.ok(afterLate.sequence > beforeLate.sequence, 'a late low-row commit advances server order');
  assert.equal(await store.cacheListSnapshot(account, 'L1', beforeLate.items, [], beforeLate.sequence), false);
  assert.equal((await store.getQueuedMutations(account)).length, 0);
  assert.equal(f.rows.items.find(i => i._id === 'I1').name, 'Pending low row');
});

test('receipt batches skip definite conflicts, prioritize acknowledged work, and fairly scan lost responses', async () => {
  const f = await replayFixture(modules), account = f.session.accountId;
  const db = await store.getOfflineDB(account);
  const tx = db.transaction('mutations', 'readwrite');
  for (let i = 0; i < 256; i++) await tx.store.add({ accountId: account, operationId: `rejected-${i}`, type: 'updateItem', payload: { itemId: 'missing' }, expected: [], timestamp: i, retryCount: 5, state: i < 128 ? 'conflict' : 'failed', listIds: ['L1'] });
  await tx.done;
  for (let i = 0; i < 160; i++) {
    await edit(f, { itemId: 'I1', name: `Healthy ${i}` });
    assert.ok((await store.getOperations(account)).length <= 256 + store.RECENT_OPERATIONS);
  }
  const operations = await store.getOperations(account);
  const selected = new Set([...store.replayOperationIds(operations, 'L1', 0), ...store.replayOperationIds(operations, 'L1', 64)]);
  assert.ok(![...selected].some(id => Number(id.slice(9)) < 128));
  assert.ok(operations.filter(m => m.state === 'failed').every(m => selected.has(m.operationId)));
  const acked = { operationId: 'late-healthy', state: 'acked', listIds: ['L1'] };
  assert.ok(store.replayOperationIds([...operations, acked], 'L1').includes(acked.operationId));
  assert.ok(store.replayOperationIds([...operations, acked], 'L1').length <= 128);
  await assert.rejects(f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: Array(129).fill('x') }), /Too many replay receipts/);
});

test('migration preserves unversioned other-list fences and create aliases until that list is safely observed', async () => {
  const account = 'migration-compaction';
  const old = await openDB(`boop-offline-v2:${account}`, 1, { upgrade(db) {
    db.createObjectStore('lists', { keyPath: '_id' });
    db.createObjectStore('items', { keyPath: '_id' }).createIndex('byList', 'listId');
    db.createObjectStore('mutations', { keyPath: 'id', autoIncrement: true });
  } });
  const item = { _id: 'B1', listId: 'B', name: 'Kept', checked: true, _creationTime: 1, createdAt: 1, createdByDid: 'did:b' };
  await old.put('items', item);
  await old.add('mutations', { operationId: 'legacy-create', accountId: account, type: 'addItem', payload: { listId: 'B', name: 'Kept' }, expected: [], state: 'acked', timestamp: 1, retryCount: 0, listIds: ['B'], observedListIds: ['B'], ack: { operationId: 'legacy-create', result: 'B1', revisions: { B1: 'legacy' } } });
  for (let i = 0; i < 40; i++) await old.add('mutations', { operationId: `old-a-${i}`, accountId: account, type: 'updateItem', payload: { itemId: 'A1' }, expected: [], state: 'acked', timestamp: i, retryCount: 0, listIds: ['A'], observedListIds: ['A'], ack: { operationId: `old-a-${i}`, result: null, revisions: {} } });
  old.close();
  await store.cacheListSnapshot(account, 'A', [], [], 0);
  assert.ok((await store.getOperations(account)).some(m => m.operationId === 'legacy-create'));
  assert.equal(await store.cacheListSnapshot(account, 'B', [{ ...item, checked: false }], []), false);
  assert.equal((await store.getCachedItemsByList(account, 'B'))[0].checked, true);
  await store.cacheListSnapshot(account, 'B', [item], [], 0);
  assert.equal((await store.getCachedItemsByList(account, 'B'))[0]._localKey, 'legacy-create');
  assert.ok(!(await store.getOperations(account)).some(m => m.operationId === 'legacy-create'));
  assert.equal(await store.cacheListSnapshot(account, 'B', [], []), false, 'unversioned responses cannot bypass the migration baseline');
});

test('enqueue, conflict rebase, and cross-tab nonces work without crypto.randomUUID', async () => {
  const f = await replayFixture(modules), account = f.session.accountId;
  const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
  const previousWindow = globalThis.window;
  const nonces = [];
  globalThis.window = { localStorage: { setItem(_key, value) { nonces.push(value); } } };
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  try {
    const id = await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I1', name: 'Fallback' } }, f.rows.items);
    const before = (await store.getOperations(account))[0];
    await store.saveOperation(account, { ...before, state: 'conflict' });
    await store.rebaseOperation(account, id, f.rows.items);
    const after = (await store.getOperations(account))[0];
    assert.notEqual(before.operationId, after.operationId);
    for (const value of [before.operationId, after.operationId, ...nonces]) assert.match(value, /^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/);
    assert.ok(nonces.length >= 3);
    assert.equal(new Set(nonces).size, nonces.length);
    await new SyncManager().sync(f.client, f.session);
    assert.equal(f.rows.items[0].name, 'Fallback');
  } finally {
    if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor); else delete crypto.randomUUID;
    globalThis.window = previousWindow;
  }
});

test('compaction retains direct pending dependencies without retaining their entire acknowledged ancestry', async () => {
  const account = 'direct-dependencies';
  const db = await store.getOfflineDB(account);
  const tx = db.transaction('mutations', 'readwrite');
  for (let i = 0; i < 100; i++) await tx.store.add({ accountId: account, operationId: `op-${i}`, type: i ? 'updateItem' : 'addItem', payload: i ? { itemId: 'I1' } : { listId: 'L1' }, expected: i ? [{ id: 'I1', revision: 'base', predecessor: `op-${i - 1}` }] : [], timestamp: i, retryCount: 0, state: 'acked', listIds: ['L1'], observedListIds: ['L1'], ack: { operationId: `op-${i}`, sequence: i + 1, result: i ? null : 'I1', revisions: { I1: `revision-${i}` } } });
  await tx.store.add({ accountId: account, operationId: 'pending', type: 'updateItem', payload: { itemId: 'temp-op-0', priority: 'high' }, expected: [{ id: 'temp-op-0', revision: 'base', predecessor: 'op-10' }], timestamp: 101, retryCount: 0, state: 'pending', listIds: ['L1'] });
  await tx.done;
  const item = { _id: 'I1', listId: 'L1', name: 'Current', checked: false, _creationTime: 1, createdAt: 1, createdByDid: 'did:a' };
  await store.cacheListSnapshot(account, 'L1', [item], [], 100);
  const retained = await store.getOperations(account);
  assert.equal(retained.length, 35); // 32 recent + direct predecessor + temp alias + pending
  assert.ok(retained.some(m => m.operationId === 'op-10'));
  assert.ok(retained.some(m => m.operationId === 'op-0'));
  assert.ok(!retained.some(m => m.operationId === 'op-9'));
  assert.equal((await store.getCachedItemsByList(account, 'L1'))[0]._localKey, 'op-0');
});

test('unsequenced permanent receipts migrate through an explicit versioned zero snapshot without replaying effects', async () => {
  const f = await replayFixture(modules);
  await store.queueMutation(f.session.accountId, { type: 'addItem', payload: { listId: 'L1', name: 'Legacy creation', createdAt: 1 } });
  let request;
  await new SyncManager().sync({ mutation: async (ref, args) => { request = { ref, args }; return f.client.mutation(ref, args); } }, f.session);
  delete f.rows.offlineReceipts[0].sequence;
  delete f.rows.users[0].replaySequence;
  const before = f.rows.items.length;
  const ack = await f.client.mutation(request.ref, request.args);
  assert.equal(ack.sequence, undefined);
  assert.equal(f.rows.items.length, before);
  const snapshot = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: [ack.operationId] });
  assert.equal(snapshot.sequence, 0);
  assert.equal(await store.cacheListSnapshot(f.session.accountId, 'L1', snapshot.items, snapshot.acknowledgments, 0), true);
  assert.equal(await store.cacheListSnapshot(f.session.accountId, 'L1', [], snapshot.acknowledgments), false);
  assert.equal((await store.getCachedListSnapshot(f.session.accountId, 'L1')).sequence, 0);
});
