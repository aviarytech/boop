import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadReplayModules, replayFixture } from './helpers/replay-fixture.mjs';
const modules = await loadReplayModules('offline-edit-base-tests');
const { offline: store, sync: { SyncManager }, optimistic: { projectItems } } = modules;
const queue = (f, type, payload, snapshots = structuredClone(f.rows.items)) => store.queueMutation(f.session.accountId, { type, payload }, snapshots);
const pending = f => store.getQueuedMutations(f.session.accountId);
const all = f => store.getOperations(f.session.accountId);

test("a draft opened on an optimistic version chains through the client's own later edits instead of conflicting", async () => {
  const f = await replayFixture(modules);
  await queue(f, 'checkItem', { itemId: 'I1', checkedAt: 1 });
  // The details modal opens on the projected (checked) row, tagged with the check.
  const draftSource = projectItems(structuredClone(f.rows.items), await all(f), 'L1')[0];
  // While it is open, the same user unchecks the row in the list.
  await queue(f, 'uncheckItem', { itemId: 'I1' });
  await queue(f, 'updateItem', { itemId: 'I1', name: 'Oat milk' }, [draftSource]);
  const [check, uncheck, update] = await all(f);
  assert.equal(uncheck.expected[0].predecessor, check.operationId);
  assert.equal(update.expected[0].predecessor, uncheck.operationId);
  await new SyncManager().sync(f.client, f.session);
  assert.deepEqual(await pending(f), []);
  assert.equal(f.rows.items[0].name, 'Oat milk');
  assert.equal(f.rows.items[0].checked, false);
});

test("a draft chains through the client's own later edit made after its base was acknowledged and observed", async () => {
  const f = await replayFixture(modules);
  await queue(f, 'checkItem', { itemId: 'I1', checkedAt: 1 });
  const draftSource = projectItems(structuredClone(f.rows.items), await all(f), 'L1')[0];
  await new SyncManager().sync(f.client, f.session);
  const observe = async () => {
    const snap = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: (await all(f)).map(m => m.operationId) });
    await store.cacheListSnapshot(f.session.accountId, 'L1', snap.items, snap.acknowledgments, snap.sequence);
    return snap.items;
  };
  // The uncheck is based on the observed server row, so it has no predecessor link.
  await queue(f, 'uncheckItem', { itemId: 'I1' }, await observe());
  assert.equal((await pending(f))[0].expected[0].predecessor, undefined);
  await new SyncManager().sync(f.client, f.session);
  await observe();
  await queue(f, 'updateItem', { itemId: 'I1', name: 'Oat milk' }, [draftSource]);
  await new SyncManager().sync(f.client, f.session);
  assert.deepEqual(await pending(f), []);
  assert.equal(f.rows.items[0].name, 'Oat milk');
  assert.equal(f.rows.items[0].checked, false);
});

test("a draft still conflicts with a collaborator's edit made after the client's own later edits", async () => {
  const f = await replayFixture(modules);
  await queue(f, 'checkItem', { itemId: 'I1', checkedAt: 1 });
  const draftSource = projectItems(structuredClone(f.rows.items), await all(f), 'L1')[0];
  await queue(f, 'uncheckItem', { itemId: 'I1' });
  await new SyncManager().sync(f.client, f.session);
  await f.call('items', 'updateItem', { itemId: 'I1', name: 'Collaborator name' }, f.collaborator);
  await queue(f, 'updateItem', { itemId: 'I1', name: 'Oat milk' }, [draftSource]);
  await new SyncManager().sync(f.client, f.session);
  const [conflict] = await pending(f);
  assert.equal(conflict.state, 'conflict');
  assert.equal(conflict.payload.name, 'Oat milk');
  assert.equal(f.rows.items[0].name, 'Collaborator name');
});

test('a rendered row is a valid edit base for an uncached item; without one the edit cannot be verified', async () => {
  const f = await replayFixture(modules);
  // No cached snapshot exists yet (e.g. a collaborator's new row, tapped before
  // the cache effect commits). The rendered row is the version the user acted on.
  await queue(f, 'batchCheckItems', { itemIds: ['I1'] }, structuredClone(f.rows.items));
  const [withBase] = await all(f);
  assert.notEqual(withBase.expected[0].revision, 'unknown');
  assert.deepEqual(withBase.listIds, ['L1']);
  await new SyncManager().sync(f.client, f.session);
  assert.deepEqual(await pending(f), []);
  assert.equal(f.rows.items[0].checked, true);
});
