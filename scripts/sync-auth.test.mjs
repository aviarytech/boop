import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConvexError, convexToJson, jsonToConvex } from 'convex/values';
import { loadReplayModules, replayFixture } from './helpers/replay-fixture.mjs';
const modules = await loadReplayModules('sync-auth');
const { offline: store, sync: { SyncManager } } = modules;
const wireError = code => new ConvexError(jsonToConvex(convexToJson({ kind: "auth", code, message: 'Account unavailable' })));
async function seed() {
  const f = await replayFixture(modules);
  await store.queueMutation(f.session.accountId, { type: 'checkItem', payload: { itemId: 'I1', checkedAt: 1 } }, f.rows.items);
  await store.queueMutation(f.session.accountId, { type: 'uncheckItem', payload: { itemId: 'I1' } }, f.rows.items);
  return f;
}
test('idle polling and acknowledged work never announce syncing', async () => {
  const f = await replayFixture(modules), manager = new SyncManager(), statuses = [];
  manager.subscribe(s => statuses.push(s.status));
  await manager.sync(f.client, f.session);
  await manager.sync(f.client, f.session);
  assert.deepEqual(statuses, ['synced', 'synced']);

  await store.queueMutation(f.session.accountId, { type: 'checkItem', payload: { itemId: 'I1', checkedAt: 1 } }, f.rows.items);
  statuses.length = 0;
  await manager.sync(f.client, f.session);
  assert.deepEqual(statuses, ['syncing', 'synced']);
  statuses.length = 0;
  await manager.sync(f.client, f.session);
  assert.deepEqual(statuses, ['synced']);
});

for (const patch of [
  { state: 'conflict' },
  { state: 'failed', retryCount: 5 },
  { state: 'failed', nextAttemptAt: Date.now() + 60_000 },
]) {
  test(`polling ineligible work stays out of syncing: ${JSON.stringify(patch)}`, async () => {
    const f = await seed(), manager = new SyncManager(), statuses = [];
    for (const operation of await store.getQueuedMutations(f.session.accountId)) {
      await store.saveOperation(f.session.accountId, { ...operation, ...patch });
    }
    manager.subscribe(s => statuses.push(s.status));
    await manager.sync({ mutation: () => { assert.fail('Ineligible edits must not be sent'); } }, f.session);
    assert.deepEqual(statuses, ['error']);
    assert.equal((await store.getQueuedMutations(f.session.accountId)).length, 2);
  });
}
for (const code of ['UNAUTHORIZED', 'INVALID_TOKEN', 'EXPIRED_TOKEN']) {
  test(`${code} across RPC preserves queue/retry budget and resumes with the same account`, async () => {
    const f = await seed(); const manager = new SyncManager(), statuses = [];
    manager.subscribe(s => statuses.push(s));
    await manager.sync({ mutation: async () => { throw wireError(code); }, query: () => { throw Error('No preflight allowed'); } }, f.session);
    let queue = await store.getQueuedMutations(f.session.accountId);
    assert.equal(queue.length, 2); assert.ok(queue.every(m => m.retryCount === 0));
    assert.equal(statuses.at(-1).status, 'error'); assert.equal(manager.syncing, false);
    assert.match(statuses.at(-1).message, /changes are still saved/);
    await manager.sync(f.client, f.session);
    assert.equal((await store.getQueuedMutations(f.session.accountId)).length, 0);
    assert.equal(statuses.at(-1).status, 'synced'); assert.equal(f.rows.items[0].checked, false);
  });
}
for (const error of [new Error('Transport down')]) {
  test(`${error.message}: exhaustion retains failed work and its successors, unrelated edits proceed, explicit retry recovers`, async () => {
    const f = await seed(); const manager = new SyncManager(), statuses = [];
    manager.subscribe(s => statuses.push(s));
    let failures = 0;
    const failing = { mutation: async (ref, args) => { if (args.itemId === 'I1') { failures++; throw error; } return f.client.mutation(ref, args); } };
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = `healthy-${attempt}`;
      f.rows.items.push({ ...f.rows.items[0], _id: id });
      await store.queueMutation(f.session.accountId, { type: 'checkItem', payload: { itemId: id, checkedAt: 1 } }, f.rows.items);
      // Advance the retry deadline without introducing waits in this regression.
      for (const m of await store.getQueuedMutations(f.session.accountId)) if (m.nextAttemptAt) await store.saveOperation(f.session.accountId, { ...m, nextAttemptAt: 0 });
      await manager.sync(failing, f.session);
      assert.equal(f.rows.items.find(i => i._id === id).checked, true);
    }
    const queue = await store.getQueuedMutations(f.session.accountId);
    assert.equal(queue.length, 2); assert.equal(queue[0].retryCount, 5); assert.equal(queue[1].retryCount, 0);
    assert.equal(statuses.at(-1).status, 'error');
    await new SyncManager().sync(failing, f.session); assert.equal(failures, 5, 'reload/reconnect does not consume more attempts');
    await store.retryOperations(f.session.accountId);
    await new SyncManager().sync(f.client, f.session);
    assert.equal((await store.getQueuedMutations(f.session.accountId)).length, 0);
    assert.equal(f.rows.items[0].checked, false);
  });
}
test('rapid sync calls share one in-flight attempt and honor persisted backoff', async () => {
  const f = await seed(), manager = new SyncManager();
  let release, started;
  const gate = new Promise(resolve => { started = resolve; });
  let calls = 0;
  const client = { mutation: async () => { calls++; started(); await new Promise(resolve => { release = resolve; }); throw Error('Transport down'); } };
  const running = manager.sync(client, f.session);
  await gate;
  await manager.sync(client, f.session); await manager.sync(client, f.session);
  assert.equal(calls, 1); assert.equal(manager.syncing, true);
  release(); await running;
  await new SyncManager().sync(client, f.session);
  assert.equal(calls, 1); assert.equal(manager.syncing, false);
});
test('HTTP recognizes serialized authentication errors without matching their prose', () => {
  const request = new Request('https://example.test');
  for (const code of ['UNAUTHORIZED', 'INVALID_TOKEN', 'EXPIRED_TOKEN']) assert.equal(modules.http.handlerErrorResponse(request, wireError(code), 'Failed').status, 401);
  assert.equal(modules.http.handlerErrorResponse(request, new Error('Missing scope: write'), 'Failed').status, 403);
  assert.equal(modules.http.handlerErrorResponse(request, wireError('FORBIDDEN'), 'Failed').status, 403);
});

test('edits enqueued during an active request drain immediately without waiting for polling', async () => {
  const f = await seed(), manager = new SyncManager();
  let release, started;
  const gate = new Promise(resolve => { started = resolve; });
  const response = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const client = { mutation: async (...args) => {
    calls++;
    const ack = await f.client.mutation(...args);
    if (calls === 1) { started(); await response; }
    return ack;
  } };
  const running = manager.sync(client, f.session);
  await gate;
  await store.queueMutation(f.session.accountId, { type: 'updateItem', payload: { itemId: 'I1', name: 'Rapid edit' } }, f.rows.items);
  await manager.sync(client, f.session);
  release(); await running;
  assert.equal(f.rows.items[0].name, 'Rapid edit');
  assert.equal(calls, 3);
  assert.equal((await store.getQueuedMutations(f.session.accountId)).length, 0);
});

test('rerun belongs to its account/session; switching accounts cannot send the old queued edit', async () => {
  const a = await seed(), b = await seed(), manager = new SyncManager();
  let current = a.session.accountId, release, started;
  const gate = new Promise(resolve => { started = resolve; });
  const response = new Promise(resolve => { release = resolve; });
  let oldCalls = 0;
  const client = { mutation: async (...args) => { oldCalls++; const ack = await a.client.mutation(...args); started(); await response; return ack; } };
  const isA = () => current === a.session.accountId;
  const running = manager.sync(client, a.session, isA);
  await gate;
  await manager.sync(client, a.session, isA);
  current = b.session.accountId;
  await manager.sync(b.client, b.session, () => current === b.session.accountId);
  release(); await running;
  assert.equal(oldCalls, 1);
  assert.equal((await store.getQueuedMutations(a.session.accountId)).length, 1);
  assert.equal((await store.getQueuedMutations(b.session.accountId)).length, 0);
  current = a.session.accountId;
  await manager.sync(a.client, a.session, isA);
  assert.equal((await store.getQueuedMutations(a.session.accountId)).length, 0);
});

test('FORBIDDEN parks the whole dependency chain permanently; manual retry cannot resend or rebase denied work', async () => {
  const f = await seed(), manager = new SyncManager();
  let calls = 0;
  const denied = { mutation: async () => { calls++; throw wireError('FORBIDDEN'); } };
  await manager.sync(denied, f.session);
  const queue = await store.getQueuedMutations(f.session.accountId);
  assert.equal(calls, 1);
  assert.ok(queue.every(m => m.state === 'conflict' && m.denied));
  await store.retryOperations(f.session.accountId);
  await manager.sync(denied, f.session);
  await new SyncManager().sync(denied, f.session);
  assert.equal(calls, 1);
  await assert.rejects(() => store.rebaseOperation(f.session.accountId, queue[0].id, f.rows.items), /Only a rejected conflict/);
  assert.equal(f.rows.items[0].checked, false);
  assert.equal(modules.optimistic.projectItems(f.rows.items, queue, 'L1')[0].checked, false);
});
