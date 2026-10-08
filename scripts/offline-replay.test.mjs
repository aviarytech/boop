import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFunctionName } from 'convex/server';
import { loadReplayModules, replayFixture } from './helpers/replay-fixture.mjs';
const modules = await loadReplayModules('offline-replay-tests');
const { offline: store, sync: { SyncManager }, shared: { revision }, optimistic: { projectItems } } = modules;
const queue = (f, type, payload) => store.queueMutation(f.session.accountId, { type, payload }, structuredClone(f.rows.items));
const pending = f => store.getQueuedMutations(f.session.accountId);
const all = f => store.getOperations(f.session.accountId);
const notifications = f => f.effects.filter(([, ref]) => getFunctionName(ref).startsWith('notificationActions:'));
const recorded = (f, action, itemId) => (f.rows.actionRecords ?? []).map(r => JSON.parse(r.payload)).filter(p => p.action === action && (!itemId || p.subject.itemId === itemId));
const meta = async (f, operationId, items = f.rows.items) => ({ operationId, accountId: f.session.accountId, expected: await Promise.all(items.map(async i => ({ id: i._id, revision: await revision(i) }))) });

test('offline check then uncheck survives reload, clock skew, and a lost check acknowledgment without duplicate recurring items or proof records', async () => {
  const f = await replayFixture(modules);
  f.rows.items[0].recurrence = { frequency: 'daily' };
  await store.cacheItems(f.session.accountId, f.rows.items, 'L1');
  await queue(f, 'checkItem', { itemId: 'I1', checkedByDid: f.owner.user.did, checkedAt: -100000 });
  await queue(f, 'uncheckItem', { itemId: 'I1', userDid: f.owner.user.did });
  let operations = await all(f);
  assert.equal(operations[1].expected[0].predecessor, operations[0].operationId);
  assert.equal(projectItems(await store.getCachedItemsByList(f.session.accountId, 'L1'), operations, 'L1')[0].checked, false);
  let lose = true;
  const client = { ...f.client, mutation: async (...args) => { const ack = await f.client.mutation(...args); if (lose) { lose = false; throw Error('Response lost'); } return ack; } };
  await new SyncManager().sync(client, f.session);
  assert.equal(f.rows.items[0].checked, true);
  assert.equal((await pending(f)).length, 2);
  assert.equal(f.rows.items.length, 2);
  await store.retryOperations(f.session.accountId);
  await new SyncManager().sync(f.client, f.session);
  assert.equal(f.rows.items[0].checked, false);
  assert.equal(f.rows.items.length, 2);
  // Historical evidence is untouched; each replayed action is recorded exactly once.
  assert.deepEqual(f.rows.items[0].vcProofs.map(p => p.proof), ['do-not-replace']);
  assert.equal(recorded(f, 'item.completed', 'I1').length, 1);
  assert.equal(recorded(f, 'item.reopened', 'I1').length, 1);
  assert.equal(recorded(f, 'item.created').length, 1);
  assert.deepEqual(recorded(f, 'item.created')[0].origin, { kind: 'recurrence', sourceItemId: 'I1' });
  assert.equal(notifications(f).length, 1);
  assert.equal(f.rows.offlineReceipts.length, 2);
  assert.equal((await pending(f)).length, 0);
});

test('duplicate names are distinct creates, and retrying either stable ID never duplicates a create', async () => {
  const f = await replayFixture(modules);
  for (let i = 0; i < 2; i++) await queue(f, 'addItem', { listId: 'L1', name: 'Milk', createdAt: 1, createdByDid: f.owner.user.did });
  const operations = await all(f);
  assert.notEqual(operations[0].operationId, operations[1].operationId);
  assert.equal(projectItems(f.rows.items, operations, 'L1').length, 3);
  let lost = true;
  await new SyncManager().sync({ mutation: async (...args) => { const ack = await f.client.mutation(...args); if (lost) { lost = false; throw Error('Lost'); } return ack; } }, f.session);
  await store.retryOperations(f.session.accountId);
  await new SyncManager().sync(f.client, f.session);
  assert.equal(f.rows.items.length, 3);
  assert.equal(f.rows.offlineReceipts.length, 2);
  assert.equal(notifications(f).length, 2);
  assert.equal(recorded(f, 'item.created').length, 2);
});

test('an offline create can be checked and unchecked through its stable temporary ID', async () => {
  const f = await replayFixture(modules);
  await queue(f, 'addItem', { listId: 'L1', name: 'New', createdAt: 1, createdByDid: f.owner.user.did });
  const temp = `temp-${(await all(f))[0].operationId}`;
  await queue(f, 'checkItem', { itemId: temp, checkedAt: 123 });
  await queue(f, 'uncheckItem', { itemId: temp });
  await new SyncManager().sync(f.client, f.session);
  assert.equal((await pending(f)).length, 0);
  assert.equal(f.rows.items.find(i => i.name === 'New').checked, false);
  const created = f.rows.items.find(i => i.name === 'New');
  assert.equal(created.vcProofs, undefined, 'new items get action records, not placeholders');
  assert.deepEqual(['item.created', 'item.completed', 'item.reopened'].map(action => recorded(f, action, created._id).length), [1, 1, 1]);
});

test('concurrent same-revision edits admit one write; conflicts retain ordered successors and support deliberate rebase', async () => {
  const f = await replayFixture(modules);
  await queue(f, 'checkItem', { itemId: 'I1', checkedAt: 1 });
  await queue(f, 'uncheckItem', { itemId: 'I1' });
  await f.call('items', 'updateItem', { itemId: 'I1', name: 'Collaborator edit' }, f.collaborator);
  await new SyncManager().sync(f.client, f.session);
  let queued = await pending(f);
  assert.equal(queued.length, 2); assert.equal(queued[0].state, 'conflict'); assert.equal(queued[1].retryCount, 0);
  assert.equal(f.rows.items[0].checked, false); assert.equal(f.rows.offlineReceipts.length, 0);
  const oldId = queued[0].operationId;
  await store.rebaseOperation(f.session.accountId, queued[0].id, f.rows.items);
  queued = await pending(f);
  assert.notEqual(queued[0].operationId, oldId);
  assert.equal(queued[1].expected[0].predecessor, queued[0].operationId);
  await new SyncManager().sync(f.client, f.session);
  assert.equal((await pending(f)).length, 0); assert.equal(f.rows.items[0].checked, false); assert.equal(f.rows.items[0].name, 'Collaborator edit');
  const a = await meta(f, 'concurrent-a'), b = await meta(f, 'concurrent-b');
  const results = await Promise.allSettled([f.call('items', 'checkItemReplay', { itemId: 'I1', checkedAt: 5, replay: a }), f.call('items', 'checkItemReplay', { itemId: 'I1', checkedAt: 6, replay: b })]);
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected']);
});

test('predecessor acknowledgment never overrides a collaborator edit after it', async () => {
  const f = await replayFixture(modules);
  await queue(f, 'checkItem', { itemId: 'I1', checkedAt: 1 });
  await queue(f, 'uncheckItem', { itemId: 'I1' });
  let first = true;
  await new SyncManager().sync({ mutation: async (...args) => {
    const ack = await f.client.mutation(...args);
    if (first) { first = false; await f.call('items', 'updateItem', { itemId: 'I1', name: 'Remote after check' }, f.collaborator); }
    return ack;
  } }, f.session);
  assert.equal(f.rows.items[0].checked, true);
  assert.equal((await pending(f))[0].state, 'conflict');
});

test('reactive receipts retire overlays exactly, including lost responses and later collaborator changes', async () => {
  const f = await replayFixture(modules);
  const before = structuredClone(f.rows.items);
  await queue(f, 'updateItem', { itemId: 'I1', name: 'Local' });
  assert.equal(projectItems(before, await all(f), 'L1')[0].name, 'Local');
  await new SyncManager().sync(f.client, f.session);
  const records = await all(f);
  assert.equal(projectItems(before, records, 'L1', new Set())[0].name, 'Local', 'keep ack overlay before reactive receipt');
  await f.call('items', 'updateItem', { itemId: 'I1', name: 'New remote' }, f.collaborator);
  const snapshot = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: records.map(m => m.operationId) });
  assert.equal(projectItems(snapshot.items, records, 'L1', new Set(snapshot.acknowledgments.map(a => a.operationId)))[0].name, 'New remote');
  await store.cacheListSnapshot(f.session.accountId, 'L1', snapshot.items, snapshot.acknowledgments);
  await store.saveOperation(f.session.accountId, { ...records[0], state: 'failed', error: 'Late transport error' });
  assert.equal((await all(f))[0].state, 'acked'); assert.deepEqual((await all(f))[0].observedListIds, ['L1']);
});

test('same operation ID is immutable; concurrent duplicate delivery and deletion retry return identical receipts', async () => {
  const f = await replayFixture(modules);
  const args = { itemId: 'I1', checkedAt: 10, replay: await meta(f, 'one-check') };
  const [a, b] = await Promise.all([f.call('items', 'checkItemReplay', args), f.call('items', 'checkItemReplay', args)]);
  assert.deepEqual(a, b); assert.equal(f.rows.items[0].vcProofs.length, 1);
  assert.equal(recorded(f, 'item.completed', 'I1').length, 1);
  await assert.rejects(f.call('items', 'checkItemReplay', { ...args, checkedAt: 11 }), /reused/);
  const remove = { itemId: 'I1', replay: await meta(f, 'one-delete') };
  const first = await f.call('items', 'removeItemReplay', remove);
  assert.deepEqual(await f.call('items', 'removeItemReplay', remove), first);
  assert.equal(f.rows.items.length, 0);
});

test('all batch targets are checked before any side effect; duplicate delivery does not repeat recurring creation', async () => {
  const f = await replayFixture(modules);
  f.rows.items[0].recurrence = { frequency: 'weekly' };
  f.rows.items.push({ ...structuredClone(f.rows.items[0]), _id: 'I2' });
  const replay = await meta(f, 'batch');
  await f.call('items', 'updateItem', { itemId: 'I2', name: 'Remote' }, f.collaborator);
  await assert.rejects(f.call('items', 'batchCheckItemsReplay', { itemIds: ['I1', 'I2'], replay }), /changed/);
  assert.equal(f.rows.items.length, 2); assert.equal(f.rows.items[0].checked, false);
  const args = { itemIds: ['I1', 'I2'], replay: await meta(f, 'batch-new') };
  await f.call('items', 'batchCheckItemsReplay', args); await f.call('items', 'batchCheckItemsReplay', args);
  assert.equal(f.rows.items.length, 4); assert.equal(f.rows.offlineReceipts.length, 1);
});

test('list creates, rename chains, and deletes deduplicate without changing legacy result shapes', async () => {
  const f = await replayFixture(modules);
  const create = { assetDid: 'did:new', name: 'New list', createdAt: 1, replay: { operationId: 'list-create', accountId: f.session.accountId, expected: [] } };
  const first = await f.call('lists', 'createListReplay', create);
  assert.deepEqual(await f.call('lists', 'createListReplay', create), first);
  assert.equal(f.rows.lists.length, 2);
  const doc = f.rows.lists.find(l => l._id === first.result);
  const rename = { listId: doc._id, name: 'Renamed', replay: await meta(f, 'rename', [doc]) };
  await f.call('lists', 'renameListReplay', rename);
  const remove = { listId: doc._id, replay: { operationId: 'delete-list', accountId: f.session.accountId, expected: [{ id: doc._id, revision: 'irrelevant', predecessor: 'rename' }] } };
  const deleted = await f.call('lists', 'deleteListReplay', remove);
  assert.deepEqual(await f.call('lists', 'deleteListReplay', remove), deleted);
  assert.equal(f.rows.lists.length, 1);
  const result = await f.call('items', 'addItem', { listId: 'L1', name: 'Legacy client', createdAt: 1 });
  assert.equal(typeof result, 'string');
});

test('account switch isolates queue/cache, stops unsent operations, and persists in-flight ack only to the initiating account', async () => {
  const f = await replayFixture(modules), other = await replayFixture(modules);
  await store.cacheItems(f.session.accountId, f.rows.items, 'L1');
  await queue(f, 'checkItem', { itemId: 'I1', checkedAt: 1 });
  await queue(f, 'uncheckItem', { itemId: 'I1' });
  let current = true;
  await new SyncManager().sync({ mutation: async (...args) => { const ack = await f.client.mutation(...args); current = false; return ack; } }, f.session, () => current);
  assert.equal((await all(f))[0].state, 'acked'); assert.equal((await pending(f)).length, 1);
  assert.deepEqual(await store.getCachedItemsByList(other.session.accountId, 'L1'), []); assert.deepEqual(await all(other), []);
  const wrong = { itemId: 'I1', checkedAt: 1, replay: await meta(f, 'cross-account') };
  await assert.rejects(f.call('items', 'checkItemReplay', wrong, f.collaborator), /account mismatch/);
  await new SyncManager().sync(f.client, f.session); assert.equal(f.rows.items[0].checked, false);
});

test('legacy queues stay intact; only attributed current-account edits are exportable', async () => {
  const db = await openDB('lisa-offline', 1, { upgrade(db) { db.createObjectStore('mutations', { keyPath: 'id' }); db.createObjectStore('items', { keyPath: '_id' }); } });
  const records = [
    { id: 1, payload: { userDid: 'did:a', name: 'Private A' } },
    { id: 2, payload: { checkedByDid: 'did:b', name: 'Private B' } },
    { id: 3, payload: { name: 'Unknown owner' } },
    { id: 4, payload: { userDid: 'did:a', createdByDid: 'did:b' } },
    { id: 5, payload: { createdByDid: 'did:old-a', legacyDid: 'did:old-a' } },
  ];
  for (const record of records) await db.put('mutations', record);
  assert.equal(await modules.legacy.hasLegacyWork(), true);
  assert.deepEqual((await modules.legacy.exportIdentifiedLegacyWork({ did: 'did:a', legacyDid: 'did:old-a' })).map(m => m.id), [1, 5]);
  assert.deepEqual((await modules.legacy.exportIdentifiedLegacyWork({ did: 'did:b' })).map(m => m.id), [2]);
  assert.deepEqual(await db.getAll('mutations'), records); db.close();
});

test('list B cannot retire list A add/delete overlays; atomic list A snapshot survives offline reopening', async () => {
  const f = await replayFixture(modules);
  f.rows.lists.push({ ...f.rows.lists[0], _id: 'L2', name: 'Other list' });
  await store.cacheItems(f.session.accountId, f.rows.items, 'L1');
  await queue(f, 'addItem', { listId: 'L1', name: 'Saved addition', createdAt: 1, createdByDid: f.owner.user.did });
  await queue(f, 'removeItem', { itemId: 'I1' });
  await new SyncManager().sync(f.client, f.session);
  const operations = await all(f);
  // Even a caller requesting all account receipts must not observe them through
  // a snapshot of a different list in the persistence layer.
  const b = await f.call('items', 'getListItemsForReplay', { listId: 'L2', operationIds: operations.map(m => m.operationId) });
  await store.cacheListSnapshot(f.session.accountId, 'L2', b.items, b.acknowledgments);
  assert.ok((await all(f)).every(m => !m.observedListIds?.includes('L1')));
  const offline = projectItems(await store.getCachedItemsByList(f.session.accountId, 'L1'), await all(f), 'L1');
  assert.deepEqual(offline.map(i => i.name), ['Saved addition']);
  const a = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: operations.map(m => m.operationId) });
  // Simulate an IDB write failure after cache deletion started: neither stale
  // cache removal nor acknowledgment observation is allowed to commit alone.
  await assert.rejects(store.cacheListSnapshot(f.session.accountId, 'L1', [{ ...a.items[0], uncloneable: () => {} }], a.acknowledgments));
  assert.equal((await store.getCachedItemsByList(f.session.accountId, 'L1'))[0]._id, 'I1');
  assert.ok((await all(f)).every(m => !m.observedListIds?.includes('L1')));
  await store.cacheListSnapshot(f.session.accountId, 'L1', a.items, a.acknowledgments);
  assert.ok((await all(f)).every(m => m.observedListIds.includes('L1')));
  const reopened = projectItems(await store.getCachedItemsByList(f.session.accountId, 'L1'), await all(f), 'L1');
  assert.deepEqual(reopened.map(i => i.name), ['Saved addition']);
  assert.ok(reopened.every(i => !i._isOptimistic));
});

test('a multi-list batch retires its overlay independently on each observed list', async () => {
  const f = await replayFixture(modules);
  f.rows.lists.push({ ...f.rows.lists[0], _id: 'L2' });
  f.rows.items.push({ ...f.rows.items[0], _id: 'I2', listId: 'L2' });
  await store.cacheItems(f.session.accountId, f.rows.items);
  await queue(f, 'batchCheckItems', { itemIds: ['I1', 'I2'] });
  await new SyncManager().sync(f.client, f.session);
  const snapshot = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: (await all(f)).map(m => m.operationId) });
  await store.cacheListSnapshot(f.session.accountId, 'L1', snapshot.items, snapshot.acknowledgments);
  assert.deepEqual((await all(f))[0].observedListIds, ['L1']);
  assert.equal(projectItems(await store.getCachedItemsByList(f.session.accountId, 'L2'), await all(f), 'L2')[0].checked, true);
  assert.equal(projectItems(await store.getCachedItemsByList(f.session.accountId, 'L2'), await all(f), 'L2')[0]._isOptimistic, true);
});

test('acknowledged create supplies a predecessor before reactive observation, including later temp-ID operations', async () => {
  const f = await replayFixture(modules);
  await queue(f, 'addItem', { listId: 'L1', name: 'New', createdAt: 1, createdByDid: f.owner.user.did });
  await new SyncManager().sync(f.client, f.session);
  let ops = await all(f);
  const create = ops[0], realId = create.ack.result, tempId = `temp-${create.operationId}`;
  // No server/cache snapshot of the new row exists yet. Projection exposes real ID.
  assert.equal(projectItems([], ops, 'L1')[0]._id, realId);
  await store.queueMutation(f.session.accountId, { type: 'updateItem', payload: { itemId: tempId, name: 'Pending temp rename' } });
  await store.queueMutation(f.session.accountId, { type: 'checkItem', payload: { itemId: realId, checkedAt: 10 } });
  ops = await all(f);
  assert.equal(ops[1].expected[0].predecessor, create.operationId);
  assert.equal(ops[2].expected[0].predecessor, ops[1].operationId);
  await new SyncManager().sync(f.client, f.session);
  assert.deepEqual(await pending(f), []);
  assert.equal(f.rows.items.find(i => i._id === realId).name, 'Pending temp rename');
  assert.equal(f.rows.items.find(i => i._id === realId).checked, true);
});

test('conflicting temp descendants resolve server IDs for inspection and explicit rebase', async () => {
  const f = await replayFixture(modules);
  await queue(f, 'addItem', { listId: 'L1', name: 'New', createdAt: 1, createdByDid: f.owner.user.did });
  const tempId = `temp-${(await all(f))[0].operationId}`;
  await store.queueMutation(f.session.accountId, { type: 'checkItem', payload: { itemId: tempId, checkedAt: 10 } });
  let first = true;
  await new SyncManager().sync({ mutation: async (...args) => {
    const ack = await f.client.mutation(...args);
    if (first) { first = false; await f.call('items', 'updateItem', { itemId: ack.result, name: 'Remote' }, f.collaborator); }
    return ack;
  } }, f.session);
  const conflict = (await pending(f))[0]; assert.equal(conflict.state, 'conflict');
  const serverId = store.resolveOperationId(conflict.expected[0].id, await all(f));
  assert.ok(!serverId.startsWith('temp-'));
  const current = await f.call('items', 'getItemForSync', { itemId: serverId });
  await store.rebaseOperation(f.session.accountId, conflict.id, [current]);
  await new SyncManager().sync(f.client, f.session);
  assert.deepEqual(await pending(f), []); assert.equal(f.rows.items.find(i => i._id === serverId).checked, true);
});

test('projection preserves untouched item identity and never mutates the cached source', async () => {
  const f = await replayFixture(modules);
  f.rows.items.push({ ...f.rows.items[0], _id: 'I2' });
  const base = structuredClone(f.rows.items);
  await queue(f, 'checkItem', { itemId: 'I1', checkedAt: 1 });
  const projected = projectItems(base, await all(f), 'L1');
  assert.equal(projected[1], base[1]); assert.notEqual(projected[0], base[0]);
  assert.equal(base[0].checked, false); assert.equal(projected[0].checked, true);
});

test('a draft based on an optimistic version chains through that exact receipt after observation', async () => {
  const f = await replayFixture(modules);
  await queue(f, 'checkItem', { itemId: 'I1', checkedAt: 1 });
  const draftSource = projectItems(structuredClone(f.rows.items), await all(f), 'L1')[0];
  await new SyncManager().sync(f.client, f.session);
  const snap = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: (await all(f)).map(m => m.operationId) });
  await store.cacheListSnapshot(f.session.accountId, 'L1', snap.items, snap.acknowledgments);
  await store.queueMutation(f.session.accountId, { type: 'updateItem', payload: { itemId: 'I1', name: 'Draft based on local check' } }, [draftSource]);
  assert.equal((await pending(f))[0].expected[0].predecessor, draftSource._operationId);
  await new SyncManager().sync(f.client, f.session);
  assert.deepEqual(await pending(f), []);
  assert.equal(f.rows.items[0].name, 'Draft based on local check');
});

test('locally created item keys remain stable across acknowledgment and a projected details snapshot is a valid edit base', async () => {
  const f = await replayFixture(modules);
  await queue(f, 'addItem', { listId: 'L1', name: 'New', createdAt: 1, createdByDid: f.owner.user.did });
  const before = projectItems([], await all(f), 'L1')[0];
  await new SyncManager().sync(f.client, f.session);
  const acknowledged = projectItems([], await all(f), 'L1')[0];
  assert.equal(acknowledged._localKey, before._localKey);
  assert.notEqual(acknowledged._id, before._id);
  await store.queueMutation(f.session.accountId, { type: 'updateItem', payload: { itemId: acknowledged._id, name: 'Edited immediately' } }, [acknowledged]);
  await new SyncManager().sync(f.client, f.session);
  assert.deepEqual(await pending(f), []);
  const snap = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: (await all(f)).map(m => m.operationId) });
  await store.cacheListSnapshot(f.session.accountId, 'L1', snap.items, snap.acknowledgments);
  const observed = projectItems(snap.items, await all(f), 'L1').find(i => i._id === acknowledged._id);
  assert.equal(observed._localKey, before._localKey);
  await store.queueMutation(f.session.accountId, { type: 'updateItem', payload: { itemId: observed._id, name: 'Edit with stable key' } }, [observed]);
  await new SyncManager().sync(f.client, f.session);
  assert.deepEqual(await pending(f), []);
});

test('overlapping enqueue calls retain invocation order and predecessor linkage', async () => {
  const f = await replayFixture(modules);
  await Promise.all([
    queue(f, 'checkItem', { itemId: 'I1', checkedAt: 1 }),
    queue(f, 'uncheckItem', { itemId: 'I1' }),
    queue(f, 'updateItem', { itemId: 'I1', name: 'Last' }),
  ]);
  const operations = await all(f);
  assert.deepEqual(operations.map(m => m.type), ['checkItem', 'uncheckItem', 'updateItem']);
  assert.equal(operations[2].expected[0].predecessor, operations[1].operationId);
  await new SyncManager().sync(f.client, f.session);
  assert.equal(f.rows.items[0].checked, false); assert.equal(f.rows.items[0].name, 'Last');
});

for (const collaboratorChanges of [false, true]) {
  test(`dirty temp draft saved with real ID preserves its create predecessor (remote rename: ${collaboratorChanges})`, async () => {
    const f = await replayFixture(modules);
    await store.queueMutation(f.session.accountId, { type: 'addItem', payload: { listId: 'L1', name: 'Original', createdAt: 1, createdByDid: f.owner.user.did } });
    const draftSource = projectItems([], await all(f), 'L1')[0];
    await new SyncManager().sync(f.client, f.session);
    const [create] = await all(f), realId = create.ack.result;
    if (collaboratorChanges) await f.call('items', 'updateItem', { itemId: realId, name: 'Collaborator name' }, f.collaborator);
    const snapshot = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: [create.operationId] });
    await store.cacheListSnapshot(f.session.accountId, 'L1', snapshot.items, snapshot.acknowledgments);
    await store.queueMutation(f.session.accountId, { type: 'updateItem', payload: { itemId: realId, name: 'Original', priority: 'high' } }, [draftSource]);
    assert.equal((await pending(f))[0].expected[0].predecessor, create.operationId);
    await new SyncManager().sync(f.client, f.session);
    if (collaboratorChanges) {
      assert.equal(f.rows.items.find(i => i._id === realId).name, 'Collaborator name');
      assert.equal((await pending(f)).length, 1);
      assert.equal((await pending(f))[0].state, 'conflict');
      assert.equal((await pending(f))[0].payload.priority, 'high');
    } else {
      assert.equal((await pending(f)).length, 0);
      assert.equal(f.rows.items.find(i => i._id === realId).priority, 'high');
    }
  });
}

for (const type of ['checkItem', 'addItem', 'removeItem']) {
  test(`receipt fence rejects delayed another-tab snapshots after acknowledged ${type}, while fresh collaborator snapshots advance`, async () => {
    const f = await replayFixture(modules);
    const stale = structuredClone(f.rows.items);
    await store.cacheItems(f.session.accountId, stale, 'L1');
    const payload = type === 'addItem' ? { listId: 'L1', name: 'Accepted addition', createdAt: 1, createdByDid: f.owner.user.did }
      : type === 'checkItem' ? { itemId: 'I1', checkedAt: 1 } : { itemId: 'I1' };
    await queue(f, type, payload);
    await new SyncManager().sync(f.client, f.session);
    const operationIds = (await all(f)).map(m => m.operationId);
    const fresh = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds });
    assert.equal(await store.cacheListSnapshot(f.session.accountId, 'L1', fresh.items, fresh.acknowledgments), true);
    assert.equal(await store.cacheListSnapshot(f.session.accountId, 'L1', stale, []), false);
    // An older upsert helper is also a cache writer and may not bypass the fence.
    await store.cacheItems(f.session.accountId, stale);
    await store.cacheItems(f.session.accountId, stale, 'L1');
    assert.deepEqual((await store.getCachedItemsByList(f.session.accountId, 'L1')).map(({ _localKey, ...item }) => item).sort((a, b) => a._id.localeCompare(b._id)), [...fresh.items].sort((a, b) => a._id.localeCompare(b._id)));
    assert.deepEqual((await store.getCachedListSnapshot(f.session.accountId, 'L1')).operationIds, operationIds);
    const offline = projectItems(await store.getCachedItemsByList(f.session.accountId, 'L1'), await all(f), 'L1');
    if (type === 'checkItem') assert.equal(offline[0].checked, true);
    if (type === 'addItem') assert.equal(offline.filter(i => i.name === 'Accepted addition').length, 1);
    if (type === 'removeItem') assert.equal(offline.length, 0);
    await f.call('items', 'addItem', { listId: 'L1', name: 'Later collaborator', createdAt: 2 }, f.collaborator);
    const later = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds });
    assert.equal(await store.cacheListSnapshot(f.session.accountId, 'L1', later.items, later.acknowledgments), true);
    assert.ok((await store.getCachedItemsByList(f.session.accountId, 'L1')).some(i => i.name === 'Later collaborator'));
  });
}

test('receipt frontier grows atomically and an older partial frontier cannot erase a later accepted deletion', async () => {
  const f = await replayFixture(modules);
  await queue(f, 'addItem', { listId: 'L1', name: 'New', createdAt: 1, createdByDid: f.owner.user.did });
  await new SyncManager().sync(f.client, f.session);
  const [create] = await all(f);
  const older = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: [create.operationId] });
  await store.cacheListSnapshot(f.session.accountId, 'L1', older.items, older.acknowledgments);
  await queue(f, 'removeItem', { itemId: create.ack.result });
  await new SyncManager().sync(f.client, f.session);
  const latest = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: (await all(f)).map(m => m.operationId) });
  // Start both writer transactions without waiting: IDB serial isolation must
  // evaluate the second writer against the frontier committed by the first.
  const writes = await Promise.all([
    store.cacheListSnapshot(f.session.accountId, 'L1', latest.items, latest.acknowledgments),
    store.cacheListSnapshot(f.session.accountId, 'L1', older.items, older.acknowledgments),
  ]);
  assert.deepEqual(writes, [true, false]);
  assert.ok(!(await store.getCachedItemsByList(f.session.accountId, 'L1')).some(i => i._id === create.ack.result));
});

test('isolated replay counters preserve legacy floors and duplicate sequences without writing auth user documents', async () => {
  const f = await replayFixture(modules);
  f.rows.users[0].replaySequence = 47;
  const before = structuredClone(f.rows.users);
  const userWrites = [];
  const patch = f.ctx.db.patch;
  f.ctx.db.patch = async (id, fields) => { if (f.rows.users.some(u => u._id === id)) userWrites.push(fields); return patch(id, fields); };
  const base = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: [] });
  assert.equal(base.sequence, 47);
  const args = { listId: 'L1', name: 'Counter migration', createdAt: 1, replay: { operationId: 'counter-create', accountId: f.session.accountId, expected: [] } };
  const ack = await f.call('items', 'addItemReplay', args);
  assert.equal(ack.sequence, 48);
  assert.equal(f.rows.replaySequences.length, 1);
  assert.equal(f.rows.replaySequences[0].accountId, f.owner.user._id);
  assert.deepEqual(await f.call('items', 'addItemReplay', args), ack);
  assert.equal(f.rows.replaySequences[0].sequence, 48);
  const later = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: [ack.operationId] });
  assert.equal(later.sequence, 48);
  assert.equal(later.acknowledgments[0].sequence, 48);
  assert.deepEqual(userWrites, []);
  assert.deepEqual(f.rows.users, before);
  const other = await f.call('items', 'addItemReplay', { ...args, name: 'Collaborator counter', replay: { operationId: 'other-counter', accountId: f.collaborator.user.turnkeySubOrgId, expected: [] } }, f.collaborator);
  assert.equal(other.sequence, 1);
  assert.equal(f.rows.replaySequences.find(r => r.accountId === f.owner.user._id).sequence, 48);
  assert.deepEqual(f.rows.users, before);
});
