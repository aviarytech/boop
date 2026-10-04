import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { renderHook, render, fireEvent, act, waitFor, cleanup } = await import('@testing-library/react');
const fixture = globalThis.__offlineHooks = {
  user: { turnkeySubOrgId: 'hook-account-a', did: 'did:a' }, token: 'token-a', online: false,
  snapshots: new Map(), calls: [], networkListeners: new Set(), client: { mutation() { throw Error('Unexpected network call while offline'); } },
};
await build({ entryPoints: ['src/hooks/useOptimisticItems.tsx', 'src/hooks/useItemDetailsDraft.ts', 'src/lib/offline.ts', 'src/lib/offlineObserver.ts', 'src/hooks/useOffline.tsx', 'src/lib/sync.ts'], outdir: 'tmp/offline-hooks', outbase: '.', bundle: true, splitting: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, external: ['react', 'react/jsx-runtime', 'convex/server', 'convex/values', 'idb'], plugins: [{ name: 'offline-hook-fixtures', setup(b) {
  b.onResolve({ filter: /\/useAuth$|\/authenticatedConvex$|\/network$|^convex\/react$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents:
    path.endsWith('/useAuth') ? 'export const useAuth=()=>globalThis.__offlineHooks;' :
    path.endsWith('/authenticatedConvex') ? `export const useQuery=(_ref,args)=>{const f=globalThis.__offlineHooks;f.calls.push(args);return f.snapshots.get((f.user?.turnkeySubOrgId ?? '')+':'+args.listId);};` :
    path.endsWith('/network') ? `export const getNetworkStatus=()=>globalThis.__offlineHooks.online;export const onNetworkChange=fn=>{globalThis.__offlineHooks.networkListeners.add(fn);return ()=>globalThis.__offlineHooks.networkListeners.delete(fn)};` :
    'export const useConvex=()=>globalThis.__offlineHooks.client;',
  }));
} }] });
const load = path => import(pathToFileURL(`${process.cwd()}/tmp/offline-hooks/${path}.mjs`));
const { useOptimisticItems } = await load('src/hooks/useOptimisticItems');
const { useItemDetailsDraft } = await load('src/hooks/useItemDetailsDraft');
const store = await load('src/lib/offline');
const item = (id = 'I1') => ({ _id: id, _creationTime: 1, listId: 'L1', name: 'Milk', checked: false, createdByDid: 'did:a', createdAt: 1, updatedAt: 1 });

test('hook remount rebuilds optimistic check-uncheck and additions from IDB; switching accounts exposes neither queue nor cache', async () => {
  await store.cacheItems('hook-account-a', [item()], 'L1');
  let view = renderHook(() => useOptimisticItems('L1'));
  try {
    await waitFor(() => assert.equal(view.result.current.items.length, 1));
    await act(async () => { await view.result.current.checkItem('I1', 'did:a'); await view.result.current.uncheckItem('I1', 'did:a'); await view.result.current.addItem({ name: 'Milk', createdByDid: 'did:a', createdAt: 1 }); });
    await waitFor(() => assert.equal(view.result.current.items.length, 2));
    assert.equal(view.result.current.items[0].checked, false);
    assert.ok(view.result.current.items.every(i => i._isOptimistic));
    view.unmount();
    view = renderHook(() => useOptimisticItems('L1'));
    await waitFor(() => assert.equal(view.result.current.items.length, 2));
    const oldCallback = view.result.current.checkItem;
    fixture.user = { turnkeySubOrgId: 'hook-account-b', did: 'did:b' }; fixture.token = 'token-b';
    view.rerender();
    assert.deepEqual(view.result.current.items, []);
    await assert.rejects(oldCallback('I1', 'did:a'), /Sign in/);
    await waitFor(() => assert.equal(view.result.current.isLoading, false));
    assert.deepEqual(await store.getOperations('hook-account-b'), []);
    fixture.user = { turnkeySubOrgId: 'hook-account-a', did: 'did:a' }; fixture.token = 'token-a';
    view.rerender();
    await waitFor(() => assert.equal(view.result.current.items.length, 2));
    assert.equal(view.result.current.items.find(i => i._id === 'I1').checked, false);
  } finally { view.unmount(); cleanup(); }
});

test('unchanged projected items retain identity through queue refreshes and unrelated remote updates; receipts requested only for this list', async () => {
  fixture.user = { turnkeySubOrgId: 'hook-identity', did: 'did:a' }; fixture.token = 'token-identity';
  const base = [item(), item('I2')];
  fixture.snapshots.set('hook-identity:L1', { items: base, acknowledgments: [] });
  const view = renderHook(() => useOptimisticItems('L1'));
  try {
    await waitFor(() => assert.equal(view.result.current.items.length, 2));
    const first = view.result.current.items[0];
    view.rerender(); assert.equal(view.result.current.items[0], first);
    await act(async () => { await store.queueMutation('hook-identity', { type: 'addItem', payload: { listId: 'L2', name: 'Elsewhere', createdAt: 1 } }); });
    await waitFor(() => assert.equal(fixture.calls.at(-1).listId, 'L1'));
    assert.equal(view.result.current.items[0], first);
    assert.deepEqual(fixture.calls.at(-1).operationIds, []);
    fixture.snapshots.set('hook-identity:L1', { items: [structuredClone(base[0]), { ...base[1], name: 'Remote I2' }], acknowledgments: [] });
    view.rerender(); assert.equal(view.result.current.items[0], first); assert.equal(view.result.current.items[1].name, 'Remote I2');
  } finally { view.unmount(); cleanup(); }
});

test('dirty item detail fields survive cloned item props and collaborator updates; saving still uses the edited base version', () => {
  const original = item();
  const view = renderHook(({ current }) => useItemDetailsDraft(current), { initialProps: { current: original } });
  try {
    act(() => { view.result.current.set('name', 'Unsaved groceries'); view.result.current.set('url', 'https://example.test/draft'); view.result.current.set('priority', 'high'); });
    view.rerender({ current: { ...original } });
    assert.equal(view.result.current.draft.name, 'Unsaved groceries');
    view.rerender({ current: { ...original, checked: true, updatedAt: 9, name: 'Collaborator name' } });
    assert.equal(view.result.current.draft.name, 'Unsaved groceries');
    assert.equal(view.result.current.draft.url, 'https://example.test/draft');
    assert.equal(view.result.current.draft.priority, 'high');
    assert.equal(view.result.current.source.current, original, 'dirty save must not silently adopt collaborator revision');
    view.rerender({ current: { ...item('I2'), name: 'Other item' } });
    assert.equal(view.result.current.draft.name, 'Other item');
    assert.equal(view.result.current.draft.url, '');
    view.rerender({ current: { ...item('I2'), name: 'Clean remote refresh' } });
    assert.equal(view.result.current.draft.name, 'Clean remote refresh');
  } finally { view.unmount(); cleanup(); }
});

test('dirty draft survives a temporary item acquiring its acknowledged server ID', () => {
  const source = { ...item('temp-create'), _localKey: 'create-op' };
  const view = renderHook(({ current }) => useItemDetailsDraft(current), { initialProps: { current: source } });
  try {
    act(() => view.result.current.set('name', 'Still typing'));
    view.rerender({ current: { ...source, _id: 'server-created-item' } });
    assert.equal(view.result.current.draft.name, 'Still typing');
    assert.equal(view.result.current.source.current, source);
  } finally { view.unmount(); cleanup(); }
});

test('versioned cross-tab cache fences the stale fallback without querying observed receipt history', async () => {
  const accountId = 'hook-cross-tab';
  fixture.user = { turnkeySubOrgId: accountId, did: 'did:a' }; fixture.token = 'token-cross-tab';
  const stale = [item()];
  fixture.snapshots.set(`${accountId}:L1`, { items: stale, acknowledgments: [], sequence: 0 });
  const view = renderHook(() => useOptimisticItems('L1'));
  try {
    await waitFor(() => assert.equal(view.result.current.items.length, 1));
    // Model another tab using the shared IDB connection directly: no in-process
    // subscribeOffline notification is emitted for these writes.
    const db = await store.getOfflineDB(accountId);
    const operationId = 'other-tab-check';
    const ack = { operationId, result: null, revisions: { I1: 'checked-revision' } };
    const tx = db.transaction(['items', 'mutations', 'metadata'], 'readwrite');
    await tx.objectStore('metadata').put({ key: 'sequence:L1', sequence: 1 });
    await tx.objectStore('items').put({ ...item(), checked: true });
    await tx.objectStore('mutations').add({ accountId, operationId, type: 'checkItem', payload: { itemId: 'I1', checkedAt: 1 }, expected: [], timestamp: 1, retryCount: 0, state: 'acked', listIds: ['L1'], observedListIds: ['L1'], ack });
    await tx.done;
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'boop-offline-change', newValue: 'nonce' })); });
    await waitFor(() => assert.equal(view.result.current.items[0]?.checked, true));
    assert.deepEqual(fixture.calls.at(-1).operationIds, [], 'observed history is fenced by the sequence, not requeried');
    assert.equal((await store.getCachedItemsByList(accountId, 'L1'))[0].checked, true);
    // A genuinely newer snapshot that includes the frontier must not be frozen.
    fixture.snapshots.set(`${accountId}:L1`, { items: [{ ...item(), checked: false, name: 'Later collaborator' }], acknowledgments: [], sequence: 1 });
    view.rerender();
    await waitFor(() => assert.equal(view.result.current.items[0]?.name, 'Later collaborator'));
    await waitFor(async () => assert.equal((await store.getCachedItemsByList(accountId, 'L1'))[0].name, 'Later collaborator'));
    assert.equal(view.result.current.items[0].checked, false);
  } finally { view.unmount(); cleanup(); }
});

// Freeze the independently loaded queue to reproduce the observer race: cache
// data/receipts advance in IDB while useOffline still exposes its earlier read.
await build({ entryPoints: ['src/hooks/useOptimisticItems.tsx'], outfile: 'tmp/offline-hooks-stale-observer.mjs', bundle: true, platform: 'node', format: 'esm', external: ['react', 'convex/server', 'idb'], plugins: [{ name: 'stale-queue-observer', setup(b) {
  b.onResolve({ filter: /^\.\/useOffline$|\/authenticatedConvex$/ }, args => ({ path: args.path, namespace: 'stale-observer' }));
  b.onLoad({ filter: /.*/, namespace: 'stale-observer' }, ({ path }) => ({ contents: path.endsWith('/useOffline')
    ? 'export const useOffline=()=>globalThis.__staleOfflineObserver;'
    : 'export const useQuery=()=>globalThis.__staleOfflineObserver.snapshot;' }));
} }] });
const { useOptimisticItems: useStaleObserverItems } = await import(pathToFileURL(`${process.cwd()}/tmp/offline-hooks-stale-observer.mjs`));
for (const fallback of ['cache', 'last']) {
  test(`${fallback} fallback carries receipt IDs when cached data is newer than the separately loaded operation queue`, async () => {
    const accountId = `hook-stale-operations-${fallback}`;
    const original = { ...item(), name: 'Original' };
    await store.cacheItems(accountId, [original], 'L1');
    await store.queueMutation(accountId, { type: 'updateItem', payload: { itemId: 'I1', name: 'Local' } }, [original]);
    const operations = await store.getOperations(accountId);
    const ack = { operationId: operations[0].operationId, result: 'I1', revisions: { I1: 'revision' } };
    const snapshot = { items: [{ ...original, name: 'Later collaborator' }], acknowledgments: [ack] };
    await store.cacheListSnapshot(accountId, 'L1', snapshot.items, snapshot.acknowledgments);
    const observer = globalThis.__staleOfflineObserver = { accountId, operations, isOnline: false, queueMutation: () => {}, snapshot: fallback === 'last' ? snapshot : undefined };
    const view = renderHook(() => useStaleObserverItems('L1'));
    try {
      await waitFor(() => assert.equal(view.result.current.items[0]?.name, 'Later collaborator'));
      assert.equal(observer.operations[0].state, 'pending', 'operation observer deliberately has not caught up');
      if (fallback === 'last') {
        observer.snapshot = undefined;
        view.rerender();
        assert.equal(view.result.current.items[0]?.name, 'Later collaborator');
      }
      assert.ok(!view.result.current.items[0]._isOptimistic);
    } finally { view.unmount(); cleanup(); }
  });
}

test('many mounted queue consumers share one account read and one polling timer', async () => {
  const { offlineObserver } = await load('src/lib/offlineObserver');
  const account = 'shared-observer-many-rows';
  await store.queueMutation(account, { type: 'addItem', payload: { listId: 'L1', name: 'Shared', createdAt: 1, createdByDid: 'did:a' } });
  const observer = offlineObserver(account);
  const getAll = IDBObjectStore.prototype.getAll;
  const interval = globalThis.setInterval;
  let mutationReads = 0, timers = 0;
  IDBObjectStore.prototype.getAll = function (...args) { if (this.name === 'mutations' && this.transaction.db.name === `boop-offline-v2:${account}`) mutationReads++; return getAll.apply(this, args); };
  globalThis.setInterval = (...args) => { if (args[1] === 5000) timers++; return interval(...args); };
  const unsubscribes = [];
  try {
    for (let i = 0; i < 80; i++) unsubscribes.push(observer.subscribe(() => {}, () => {}));
    await waitFor(() => assert.equal(observer.getSnapshot().operations.length, 1));
    assert.equal(mutationReads, 1, 'one getAll across 80 subscribers');
    assert.equal(timers, 1, 'one polling timer across 80 subscribers');
  } finally {
    unsubscribes.forEach(unsubscribe => unsubscribe());
    IDBObjectStore.prototype.getAll = getAll;
    globalThis.setInterval = interval;
  }
});

test('shared atomic cache advances immediately when compaction removes the separately rendered fallback history', async () => {
  const accountId = 'hook-shared-compaction-race';
  const original = item();
  await store.cacheListSnapshot(accountId, 'L1', [original], [], 0);
  const observer = globalThis.__staleOfflineObserver = { accountId, operations: [], isOnline: false, queueMutation: () => {}, snapshot: undefined };
  const view = renderHook(() => useStaleObserverItems('L1'));
  try {
    await waitFor(() => assert.equal(view.result.current.items[0]?.name, 'Milk'));
    // Another tab has compacted its history. The shared observer carries both
    // newer data and fence before this hook's async per-list read can finish.
    const newer = { ...original, name: 'After compaction', _localKey: 'retired-create' };
    observer.aliases = { I1: 'retired-create' };
    observer.compaction = { operations: [], items: [newer], sequences: { L1: 40 }, aliases: observer.aliases, retiredThrough: 10, retainedOperationIds: [] };
    view.rerender();
    assert.equal(view.result.current.items[0]?.name, 'After compaction');
    assert.equal(view.result.current.items[0]?._localKey, 'retired-create');
  } finally { view.unmount(); cleanup(); }
});

test('unmounted queue consumers cannot keep authorizing old callbacks after their account UI is gone', async () => {
  fixture.user = { turnkeySubOrgId: 'unmounted-account', did: 'did:a' }; fixture.token = 'old-token';
  const view = renderHook(() => useOptimisticItems('L1'));
  const add = view.result.current.addItem;
  view.unmount();
  await assert.rejects(add({ name: 'Old callback', createdAt: 1, createdByDid: 'did:a' }), /Sign in/);
  assert.deepEqual(await store.getOperations('unmounted-account'), []);
  cleanup();
});

for (const transition of ['keep-list', 'logout', 'switch-account', 'rotate-token', 'teardown']) {
  test(`two removed rows hand an active drain to the account session: ${transition}`, async () => {
    const { createElement: h } = await import('react');
    const { useOffline } = await load('src/hooks/useOffline');
    const { syncManager } = await load('src/lib/sync');
    const accountId = `row-drain-${transition}`, token = `token-${transition}`;
    fixture.user = { turnkeySubOrgId: accountId, did: 'did:a' };
    fixture.token = token; fixture.online = true;
    fixture.snapshots.set(`${accountId}:L1`, { items: [item('I1'), item('I2')], acknowledgments: [], sequence: 0 });
    let releaseFirst, firstStarted;
    const firstGate = new Promise(resolve => { firstStarted = resolve; });
    const responseGate = new Promise(resolve => { releaseFirst = resolve; });
    const calls = [], enqueues = [];
    fixture.client = { mutation: async (_ref, args) => {
      calls.push(args);
      if (calls.length === 1) { firstStarted(); await responseGate; }
      return { operationId: args.replay.operationId, result: null, revisions: { [args.itemId]: 'removed' }, sequence: calls.length };
    } };
    function Row({ current }) {
      const { queueMutation } = useOffline();
      return h('button', { onClick: () => enqueues.push(queueMutation({ type: 'removeItem', payload: { itemId: current._id } }, [current])) }, `Remove ${current._id}`);
    }
    function List() {
      const { items } = useOptimisticItems('L1');
      return h('div', { 'data-testid': 'mounted-list' }, items.map(current => h(Row, { key: current._localKey ?? current._id, current })));
    }
    const view = render(h(List));
    let unmounted = false;
    try {
      // Let the list's empty mount-time sync finish. The first removal must be
      // initiated by a row, so this catches row-owned liveness regressions.
      await waitFor(() => assert.equal(syncManager.syncing, false));
      await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Remove I1' })); await enqueues[0]; });
      await firstGate;
      await waitFor(() => assert.ok(!view.queryByRole('button', { name: 'Remove I1' })));
      await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Remove I2' })); await enqueues[1]; });
      await waitFor(() => assert.ok(!view.queryByRole('button', { name: 'Remove I2' })));
      assert.ok(view.getByTestId('mounted-list'));
      assert.equal(calls.length, 1, 'second removal is queued behind the delayed response');
      if (transition === 'logout') { fixture.user = null; fixture.token = null; view.rerender(h(List)); }
      if (transition === 'switch-account') { fixture.user = { turnkeySubOrgId: 'replacement-account', did: 'did:b' }; fixture.token = 'replacement-token'; view.rerender(h(List)); }
      if (transition === 'rotate-token') { fixture.token = 'replacement-token'; view.rerender(h(List)); }
      if (transition === 'teardown') { view.unmount(); unmounted = true; }
      await act(async () => { releaseFirst(); });
      await waitFor(() => assert.equal(syncManager.syncing, false), { timeout: 2000 });
      const operations = await store.getOperations(accountId);
      assert.equal(operations[0].state, 'acked', 'in-flight acknowledgment persists to its original account');
      if (transition === 'keep-list' || transition === 'rotate-token') {
        assert.equal(calls.length, 2, 'drains immediately, before the five-second poll');
        assert.equal(calls[1].itemId, 'I2');
        assert.equal(calls[1].authToken, transition === 'rotate-token' ? 'replacement-token' : token);
        assert.equal(operations[1].state, 'acked');
      } else {
        assert.equal(calls.length, 1, 'revoked session cannot send the queued removal');
        assert.equal(operations[1].state, 'pending');
      }
    } finally {
      fixture.online = false;
      releaseFirst();
      if (!unmounted) view.unmount();
      await waitFor(() => assert.equal(syncManager.syncing, false));
      cleanup();
    }
  });
}

test('revocation notification clears mounted cache fallbacks and denied optimistic additions even with a stale content subscription', async () => {
  const accountId = 'hook-revoked';
  fixture.user = { turnkeySubOrgId: accountId, did: 'did:a' }; fixture.token = 'token-revoked';
  fixture.snapshots.set(`${accountId}:L1`, { items: [item()], acknowledgments: [], sequence: 0 });
  const view = renderHook(() => useOptimisticItems('L1'));
  try {
    await waitFor(() => assert.equal(view.result.current.items.length, 1));
    await act(async () => { await view.result.current.addItem({ name: 'Only my new text', createdByDid: 'did:a', createdAt: 1 }); });
    await waitFor(() => assert.equal(view.result.current.items.length, 2));
    await act(async () => { await store.reconcileOfflineAccess(accountId, [{ listId: 'L1', canRead: false, canEdit: false, checkedAt: 2 }]); });
    await waitFor(() => assert.deepEqual(view.result.current.items, []));
    assert.deepEqual(await store.getCachedItemsByList(accountId, 'L1'), []);
    fixture.snapshots.delete(`${accountId}:L1`); view.rerender();
    assert.deepEqual(view.result.current.items, []);
    assert.equal((await store.getOperations(accountId))[0].payload.name, 'Only my new text');
  } finally { view.unmount(); cleanup(); }
});
