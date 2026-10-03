import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { getFunctionName } from 'convex/server';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { loadReplayModules, replayFixture } from './helpers/replay-fixture.mjs';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h } = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const { render, fireEvent, waitFor, cleanup, act } = await import('@testing-library/react');
const modules = await loadReplayModules('item-details-replay');
// Render the real modal, portal, and all server-only child components. Only
// transport/context boundaries are replaced; reject invalid IDs even when the
// backend is reachable but the create has not yet been acknowledged.
await build({ stdin: { contents: 'export { ItemDetailsModal } from "./src/components/ItemDetailsModal"; export { NestedListItem } from "./src/components/NestedListItem"; export { useOptimisticItems } from "./src/hooks/useOptimisticItems"; export { matchesItemId } from "./src/lib/optimisticItems";', resolveDir: process.cwd() }, outfile: 'tmp/item-details-offline.mjs', bundle: true, jsx: 'automatic', platform: 'node', format: 'esm', packages: 'external', define: { 'import.meta.env.MODE': '"test"' }, plugins: [{ name: 'detail-contexts', setup(b) {
  b.onResolve({ filter: /\/(authenticatedConvex|useOffline|useSettings|useCurrentUser|originals|observability)$/ }, args => ({ path: args.path, namespace: 'detail-fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'detail-fixture' }, ({ path }) => ({ contents:
    path.endsWith('/authenticatedConvex') ? `export const useQuery=(ref,args)=>globalThis.__detailFixture.query(ref,args); export const useMutation=ref=>args=>globalThis.__detailFixture.mutate(ref,args); export const useAction=useMutation;` :
    path.endsWith('/useOffline') ? 'export const useOffline=()=>globalThis.__detailFixture.offline;' :
    path.endsWith('/useSettings') ? 'export const useSettings=()=>({haptic:()=>{}});' :
    path.endsWith('/useCurrentUser') ? 'export const useCurrentUser=()=>({did:globalThis.__detailFixture.did});' :
    path.endsWith('/observability') ? 'export const recordLatencyMs=()=>{};' :
    'export const verifyListEnvelope=()=>{}; export const isRetroactiveGenesis=()=>false; export const createListAsset=()=>{};',
  }));
} }] });
const { ItemDetailsModal, NestedListItem, useOptimisticItems, matchesItemId } = await import(pathToFileURL(`${process.cwd()}/tmp/item-details-offline.mjs`));
for (const acknowledgeWhileEditing of [false, true]) {
  test(`rendered temporary details preserve and queue edits ${acknowledgeWhileEditing ? 'across reconnect acknowledgment' : 'while offline'}`, async () => {
    const f = await replayFixture(modules);
    const account = f.session.accountId;
    const store = modules.offline;
    await store.queueMutation(account, { type: 'addItem', payload: { listId: 'L1', name: 'Draft original', createdAt: 1, createdByDid: f.owner.user.did } });
    const source = modules.optimistic.projectItems([], await store.getOperations(account), 'L1')[0];
    const calls = [];
    const validate = (ref, args) => {
      const name = getFunctionName(ref);
      assert.ok(!JSON.stringify(args).includes('temp-'), `${name} sent a temporary ID`);
      calls.push({ name, args });
      return name;
    };
    globalThis.__detailFixture = {
      did: f.owner.user.did,
      offline: { isOnline: false, queueMutation: (mutation, snapshots) => store.queueMutation(account, mutation, snapshots) },
      query(ref, args) {
        if (args === 'skip') return undefined;
        const name = validate(ref, args);
        if (name === 'lists:getList') return f.rows.lists[0];
        if (name === 'users:getUsersByDids') return {};
        return [];
      },
      mutate(ref, args) { validate(ref, args); throw Error('Draft edits must use the durable queue'); },
    };
    let closed = false;
    const props = { userDid: f.owner.user.did, canEdit: true, onClose: () => { closed = true; } };
    const tree = item => h(MemoryRouter, null, h(ItemDetailsModal, { ...props, item }));
    const view = render(tree(source));
    try {
      assert.equal(view.getByRole('button', { name: /notes/i }).disabled, true);
      assert.equal(view.queryByRole('button', { name: 'Originals Provenance' }), null);
      fireEvent.change(view.getByDisplayValue('Draft original'), { target: { value: 'Draft edited' } });
      fireEvent.click(view.getByRole('button', { name: /High/ }));
      fireEvent.change(view.getByRole('combobox'), { target: { value: f.owner.user.did } });
      if (acknowledgeWhileEditing) {
        globalThis.__detailFixture.offline.isOnline = true;
        view.rerender(tree({ ...source })); // connected, create still in flight
        await new modules.sync.SyncManager().sync(f.client, f.session);
        const current = modules.optimistic.projectItems([], await store.getOperations(account), 'L1')[0];
        assert.ok(!current._id.startsWith('temp-'));
        view.rerender(tree(current));
        assert.equal(view.getByDisplayValue('Draft edited').value, 'Draft edited');
        assert.equal(view.getByRole('button', { name: /notes/i }).disabled, false);
        assert.ok(view.getByRole('button', { name: 'Originals Provenance' }));
        for (const name of ['bitcoinAnchors:getItemAnchors', 'attachments:getAttachmentUrls', 'comments:getItemComments', 'items:getSubItems', 'tags:getListTags']) {
          assert.ok(calls.some(call => call.name === name), `${name} should resume with the server ID`);
        }
      } else {
        assert.ok(!calls.some(call => call.args.itemId || call.args.parentId));
      }
      fireEvent.click(view.getByRole('button', { name: 'Save' }));
      await waitFor(() => assert.equal(closed, true));
      const operations = await store.getOperations(account);
      const edit = operations.find(op => op.type === 'updateItem');
      assert.equal(edit.payload.name, 'Draft edited');
      assert.equal(edit.payload.priority, 'high');
      assert.equal(edit.payload.assigneeDid, f.owner.user.did);
      assert.ok(edit.expected.some(expected => expected.predecessor === source._operationId));
      await new modules.sync.SyncManager().sync(f.client, f.session);
      assert.equal((await store.getQueuedMutations(account)).length, 0);
      const created = f.rows.items.find(item => item.name === 'Draft edited');
      assert.equal(created.priority, 'high');
      assert.equal(created.assigneeDid, f.owner.user.did);
    } finally { view.unmount(); cleanup(); }
  });
}

for (const receiptSource of ['live', 'cache']) {
  test(`open row modal survives ${receiptSource} create receipt before mutation response and queue observer`, async () => {
    const f = await replayFixture(modules);
    const store = modules.offline;
    const accountId = f.session.accountId;
    await store.queueMutation(accountId, { type: 'addItem', payload: { listId: 'L1', name: 'Draft regression', createdAt: 1, createdByDid: f.owner.user.did } });
    const operations = await store.getOperations(accountId);
    const tempId = `temp-${operations[0].operationId}`;
    const state = globalThis.__detailFixture = {
      did: f.owner.user.did, snapshot: undefined,
      offline: { accountId, operations, isOnline: false, queueMutation: (m, snapshots) => store.queueMutation(accountId, m, snapshots) },
      query(ref, args) {
        if (args === 'skip') return undefined;
        const name = getFunctionName(ref);
        assert.ok(!JSON.stringify(args).includes('temp-'), `${name} sent temporary ID`);
        if (name === 'items:getListItemsForReplay') return state.snapshot;
        if (name === 'lists:getList') return f.rows.lists[0];
        if (name === 'users:getUsersByDids') return {};
        return [];
      },
      mutate() { throw Error('Unexpected direct mutation'); },
    };
    let projected;
    function Rows() {
      const { items } = useOptimisticItems('L1');
      projected = items;
      return items.map(item => h(NestedListItem, { key: item._localKey ?? item._id, item, userDid: f.owner.user.did, canEdit: true }));
    }
    const tree = () => h(MemoryRouter, null, h(Rows));
    const view = render(tree());
    let releaseResponse;
    const responseGate = new Promise(resolve => { releaseResponse = resolve; });
    let sync;
    try {
      fireEvent.click(view.getByText('Draft regression'));
      const input = await view.findByDisplayValue('Draft regression');
      fireEvent.click(view.getByRole('button', { name: /High/ }));
      let committed;
      const commitGate = new Promise(resolve => { committed = resolve; });
      sync = new modules.sync.SyncManager().sync({ mutation: async (...args) => {
        const result = await f.client.mutation(...args);
        committed();
        await responseGate;
        return result;
      } }, f.session);
      await commitGate;
      const snapshot = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: operations.map(m => m.operationId) });
      assert.equal(operations[0].ack, undefined, 'queue observer still lacks create result');
      state.offline.isOnline = true;
      if (receiptSource === 'live') {
        state.snapshot = snapshot;
        view.rerender(tree());
      } else {
        await act(async () => {
          await store.cacheListSnapshot(accountId, 'L1', snapshot.items, snapshot.acknowledgments);
          state.offline.operations = [...operations]; // refresh cache while observer remains stale
          view.rerender(tree());
        });
      }
      await waitFor(() => assert.ok(projected.some(item => item._localKey === operations[0].operationId && !item._id.startsWith('temp-'))));
      assert.equal(view.getByDisplayValue('Draft regression'), input, 'open modal must never remount');
      const created = projected.find(item => matchesItemId(item, tempId));
      assert.ok(created, 'keyboard selection captured as temporary ID must still resolve');
      assert.equal(created._id, snapshot.acknowledgments[0].result);
      if (receiptSource === 'live') {
        state.snapshot = undefined; // last snapshot fallback must carry the alias too
        view.rerender(tree());
        assert.equal(view.getByDisplayValue('Draft regression'), input);
      }
      await act(async () => { releaseResponse(); await sync; });
      state.offline.operations = await store.getOperations(accountId);
      view.rerender(tree());
      assert.equal(view.getByDisplayValue('Draft regression'), input, 'later queue acknowledgment must keep the same key');
      fireEvent.click(view.getByRole('button', { name: 'Save' }));
      await waitFor(async () => assert.ok((await store.getOperations(accountId)).some(m => m.type === 'updateItem')));
      await waitFor(() => assert.ok(!view.queryByDisplayValue('Draft regression')));
      const edit = (await store.getOperations(accountId)).find(m => m.type === 'updateItem');
      assert.equal(edit.payload.priority, 'high', 'unsaved priority survives receipt and delayed response');
      assert.equal(edit.expected[0].predecessor, operations[0].operationId);
      await new modules.sync.SyncManager().sync(f.client, f.session);
      assert.equal(f.rows.items.find(item => item._id === created._id).priority, 'high');
    } finally { releaseResponse(); await sync; view.unmount(); cleanup(); }
  });
}

test('sleeping tab keeps an open temporary draft when another tab acknowledges and compacts its create', async () => {
  const f = await replayFixture(modules), store = modules.offline, accountId = f.session.accountId;
  await store.queueMutation(accountId, { type: 'addItem', payload: { listId: 'L1', name: 'Sleeping draft', createdAt: 1, createdByDid: f.owner.user.did } });
  const operations = await store.getOperations(accountId), create = operations[0];
  const enqueue = (m, snapshots) => store.queueMutation(accountId, m, snapshots);
  const state = globalThis.__detailFixture = {
    did: f.owner.user.did, snapshot: undefined,
    offline: { accountId, operations, isOnline: false, queueMutation: enqueue },
    query(ref, args) {
      if (args === 'skip') return undefined;
      const name = getFunctionName(ref);
      assert.ok(!JSON.stringify(args).includes('temp-'), `${name} sent temporary ID`);
      if (name === 'items:getListItemsForReplay') return state.snapshot;
      if (name === 'lists:getList') return f.rows.lists[0];
      if (name === 'users:getUsersByDids') return {};
      return [];
    },
    mutate() { throw Error('Unexpected direct mutation'); },
  };
  function Rows() {
    return useOptimisticItems('L1').items.map(item => h(NestedListItem, { key: item._localKey ?? item._id, item, userDid: f.owner.user.did, canEdit: true }));
  }
  const tree = () => h(MemoryRouter, null, h(Rows));
  const view = render(tree());
  try {
    fireEvent.click(view.getByText('Sleeping draft'));
    const input = await view.findByDisplayValue('Sleeping draft');
    fireEvent.click(view.getByRole('button', { name: /High/ }));
    await new modules.sync.SyncManager().sync(f.client, f.session);
    const observe = async () => {
      const ops = await store.getOperations(accountId);
      const snap = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: store.replayOperationIds(ops, 'L1') });
      await store.cacheListSnapshot(accountId, 'L1', snap.items, snap.acknowledgments, snap.sequence);
    };
    await observe();
    const realId = (await store.getOperations(accountId))[0].ack.result;
    for (let index = 0; index < 40; index++) {
      await store.queueMutation(accountId, { type: 'updateItem', payload: { itemId: 'I1', name: `Other item ${index}` } }, f.rows.items);
      await new modules.sync.SyncManager().sync(f.client, f.session);
      await observe();
    }
    assert.ok(!(await store.getOperations(accountId)).some(m => m.operationId === create.operationId));
    // Wake: both the queue and durable aliases arrive in one observer read.
    const saved = await store.getOfflineState(accountId);
    state.offline = { ...saved, compaction: saved, accountId, isOnline: true, queueMutation: enqueue };
    state.snapshot = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: [] });
    view.rerender(tree());
    assert.ok(view.queryByDisplayValue('Sleeping draft') === input, 'same mounted draft survives the missed acknowledgment');
    await f.call('items', 'updateItem', { itemId: realId, name: 'Collaborator while sleeping' }, f.collaborator);
    state.snapshot = await f.call('items', 'getListItemsForReplay', { listId: 'L1', operationIds: [] });
    view.rerender(tree());
    assert.ok(view.queryByDisplayValue('Sleeping draft') === input);
    fireEvent.click(view.getByRole('button', { name: 'Save' }));
    await waitFor(() => assert.ok(!view.queryByDisplayValue('Sleeping draft')));
    const edit = (await store.getQueuedMutations(accountId))[0];
    assert.equal(edit.payload.priority, 'high');
    assert.equal(edit.expected[0].predecessor, create.operationId);
    await new modules.sync.SyncManager().sync(f.client, f.session);
    assert.equal((await store.getQueuedMutations(accountId))[0].state, 'conflict');
    assert.equal(f.rows.items.find(i => i._id === realId).name, 'Collaborator while sleeping');
  } finally { view.unmount(); cleanup(); }
});
