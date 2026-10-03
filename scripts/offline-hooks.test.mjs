import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { renderHook, act, waitFor, cleanup } = await import('@testing-library/react');
const fixture = globalThis.__offlineHooks = {
  user: { turnkeySubOrgId: 'hook-account-a', did: 'did:a' }, token: 'token-a', online: false,
  snapshots: new Map(), calls: [], networkListeners: new Set(), client: { mutation() { throw Error('Unexpected network call while offline'); } },
};
await build({ entryPoints: ['src/hooks/useOptimisticItems.tsx', 'src/hooks/useItemDetailsDraft.ts', 'src/lib/offline.ts'], outdir: 'tmp/offline-hooks', outbase: '.', bundle: true, splitting: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, external: ['react', 'react/jsx-runtime', 'convex/server', 'convex/values', 'idb'], plugins: [{ name: 'offline-hook-fixtures', setup(b) {
  b.onResolve({ filter: /\/useAuth$|\/authenticatedConvex$|\/network$|^convex\/react$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents:
    path.endsWith('/useAuth') ? 'export const useAuth=()=>globalThis.__offlineHooks;' :
    path.endsWith('/authenticatedConvex') ? `export const useQuery=(_ref,args)=>{const f=globalThis.__offlineHooks;f.calls.push(args);return f.snapshots.get(f.user.turnkeySubOrgId+':'+args.listId);};` :
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
