import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { loadReplayModules, replayFixture } from './helpers/replay-fixture.mjs';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, fireEvent, act, waitFor, cleanup } = await import('@testing-library/react');
const fixture = globalThis.__recoveryUI = { user: null, token: null, client: null };
await build({ entryPoints: ['src/components/offline/OfflineRecovery.tsx', 'src/hooks/useOffline.tsx', 'src/lib/offline.ts', 'src/lib/sync.ts'], outdir: 'tmp/offline-recovery-ui', outbase: '.', bundle: true, jsx: 'automatic', splitting: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, external: ['react', 'react/jsx-runtime', 'convex/*', 'idb'], plugins: [{ name: 'recovery-context', setup(b) {
  b.onResolve({ filter: /\/useAuth$|\/network$|^convex\/react$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path.endsWith('/useAuth') ? 'export const useAuth=()=>globalThis.__recoveryUI;' : path.endsWith('/network') ? 'export const getNetworkStatus=()=>false;export const onNetworkChange=()=>()=>{};' : 'export const useConvex=()=>globalThis.__recoveryUI.client;' }));
} }] });
const load = p => import(pathToFileURL(`${process.cwd()}/tmp/offline-recovery-ui/${p}.mjs`));
const { OfflineRecovery } = await load('src/components/offline/OfflineRecovery');
const { useOffline } = await load('src/hooks/useOffline');
const store = await load('src/lib/offline');
const { syncManager } = await load('src/lib/sync');
const modules = await loadReplayModules('recovery-ui-backend');
const { openDB } = await import('idb');
const legacy = await openDB('lisa-offline', 1, { upgrade(db) { db.createObjectStore('mutations', { autoIncrement: true }); } });
legacy.close();
function App() { const state = useOffline(); return React.createElement(React.Fragment, null, React.createElement('div', { 'data-testid': 'sync-state' }, `${state.pendingCount}:${state.syncStatus.status}`), React.createElement(OfflineRecovery)); }
async function setup() {
  const f = await replayFixture(modules), account = f.session.accountId;
  fixture.user = f.owner.user; fixture.token = f.session.token;
  fixture.client = { query: (_ref, args) => f.call('items', 'getItemForSync', args) };
  const source = structuredClone(f.rows.items);
  for (const name of ['Root', 'Child', 'Grandchild']) await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I1', name } }, source);
  const operations = await store.getOperations(account);
  await store.saveOperation(account, { ...operations[0], state: 'conflict' });
  const view = render(React.createElement(App));
  await waitFor(() => assert.ok(view.getByText('3 saved edit(s) awaiting sync')));
  fireEvent.click(view.getByText('3 saved edit(s) awaiting sync'));
  return { f, account, source, operations, view };
}
for (const unavailable of ['deleted', 'inaccessible']) test(`rendered ${unavailable} target recovery offers safe export and confirmed cascade discard without a server version`, async () => {
  const { f, account, operations, view } = await setup();
  try {
    if (unavailable === 'deleted') f.rows.items.length = 0;
    else { f.rows.lists[0].ownerDid = f.collaborator.user.did; f.rows.publications.length = 0; }
    fireEvent.click(view.getByText('Review conflict'));
    await waitFor(() => assert.match(view.getByRole('status').textContent, /deleted or are no longer available/));
    assert.equal(view.queryByText('Apply saved edit to this version'), null);
    fireEvent.click(view.getByText('Discard saved edit'));
    assert.match(view.getByRole('alertdialog').textContent, /3 saved edit\(s\).*2 dependent edit\(s\)/);
    assert.ok(view.getByText('Export these edits'));
    fireEvent.click(view.getByText('Cancel discard'));
    assert.equal((await store.getOperations(account)).length, 3);
    fireEvent.click(view.getByText('Discard saved edit'));
    // A prior sync error must disappear along with the last discarded chain.
    await act(async () => { await syncManager.sync({ mutation: async () => { throw Error('Connection lost'); } }, f.session); });
    fireEvent.click(view.getByText('Discard edits'));
    await waitFor(() => assert.equal(view.getByTestId('sync-state').textContent, '0:idle'));
    assert.deepEqual(await store.getOperations(account), []);
    assert.equal(view.queryByRole('alertdialog'), null);
    await store.saveOperation(account, { ...operations[1], state: 'failed' });
    assert.deepEqual(await store.getOperations(account), []);
  } finally { view.unmount(); cleanup(); }
});
for (const transition of ['retry', 'rebase']) test(`rendered discard confirmation becomes invalid after ${transition}`, async () => {
  const { account, source, operations, view } = await setup();
  try {
    fireEvent.click(view.getByText('Discard saved edit'));
    await act(async () => {
      if (transition === 'rebase') await store.rebaseOperation(account, operations[0].id, source);
      else { await store.saveOperation(account, { ...operations[0], state: 'failed' }); await store.prepareOperationForSync(account, operations[0].id, operations[0].operationId); }
    });
    await waitFor(() => assert.match(view.getByRole('alertdialog').textContent, /changed or is already syncing/));
    assert.equal(view.queryByText('Discard edits'), null);
    assert.equal((await store.getOperations(account)).length, 3);
  } finally { view.unmount(); cleanup(); }
});
test('switching accounts closes the discard dialog and suppresses late inspection output', async () => {
  const { account, view } = await setup();
  let release;
  fixture.client.query = () => new Promise(resolve => { release = resolve; });
  try {
    fireEvent.click(view.getByText('Review conflict'));
    fireEvent.click(view.getByText('Discard saved edit'));
    const other = `${account}-other`;
    await store.queueMutation(other, { type: 'addItem', payload: { listId: 'L2', name: 'Other account edit', createdAt: 1 } });
    fixture.user = { turnkeySubOrgId: other, did: 'did:other' }; fixture.token = 'other-token';
    view.rerender(React.createElement(App));
    await waitFor(() => assert.ok(view.getByText('1 saved edit(s) awaiting sync')));
    await act(async () => { release({ _id: 'I1', name: 'Private previous account version' }); });
    assert.equal(view.queryByRole('alertdialog'), null);
    assert.equal(view.queryByText('Current server version'), null);
    assert.equal((await store.getOperations(account)).length, 3);
    assert.equal((await store.getOperations(other)).length, 1);
  } finally { view.unmount(); cleanup(); }
});
