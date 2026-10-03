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
for (const error of [wireError('FORBIDDEN'), new Error('Transport down')]) {
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
