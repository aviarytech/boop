import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { render, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
const { createElement } = await import('react');
const fixture = globalThis.__editBase = { direct: [] };
await build({ entryPoints: ['src/components/BatchOperations.tsx', 'src/components/ListItem.tsx'], outdir: 'tmp/offline-edit-base-ui', outbase: '.', bundle: true, splitting: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'react-dom'], plugins: [{ name: 'edit-base-fixtures', setup(b) {
  b.onResolve({ filter: /\/useOffline$|\/useSettings$|\/SubItems$|\/ItemAttribution$|\/ItemDetailsModal$|\/share$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents:
    path.endsWith('/useOffline') ? 'export const useOffline=()=>({queueMutation:async(input,snapshots)=>{globalThis.__editBase.direct.push({input,snapshots});return 1;}});' :
    path.endsWith('/useSettings') ? 'export const useSettings=()=>({haptic(){}});' :
    path.endsWith('/SubItems') ? 'export const useSubItemProgress=()=>null;' :
    path.endsWith('/ItemAttribution') ? 'export const ItemAttribution=()=>null;' :
    path.endsWith('/ItemDetailsModal') ? 'export const ItemDetailsModal=()=>null;' :
    'export const shareItem=async()=>{};',
  }));
} }] });
const load = path => import(pathToFileURL(`${process.cwd()}/tmp/offline-edit-base-ui/${path}.mjs`));
const { BatchOperations } = await load('src/components/BatchOperations');
const { ListItem } = await load('src/components/ListItem');
const item = (id, name) => ({ _id: id, _creationTime: 1, listId: 'L1', name, checked: false, createdByDid: 'did:a', createdAt: 1, updatedAt: 1 });

// Without a base snapshot, an uncached target is queued with an 'unknown'
// revision and the server rejects the user's own edit as a conflict. These
// entry points must use useOptimisticItems, which queues against base rows.
test('batch operations queue through the list hook, never directly', async () => {
  for (const [label, type] of [['Check all selected items', 'batchCheckItems'], ['Uncheck all selected items', 'batchUncheckItems']]) {
    const batches = [];
    const view = render(createElement(BatchOperations, { selectedIds: new Set(['I1', 'temp-op']), queueBatch: async (...args) => { batches.push(args); }, onClearSelection() {}, userDid: 'did:a' }));
    try {
      fireEvent.click(view.getByLabelText(label));
      await waitFor(() => assert.equal(batches.length, 1));
      assert.equal(batches[0][0], type);
      assert.deepEqual(batches[0][1].itemIds, ['I1', 'temp-op']);
      assert.deepEqual(fixture.direct, []);
    } finally { cleanup(); }
  }
});

test('row remove queues through the list hook when provided', async () => {
  const removed = [];
  const view = render(createElement(ListItem, { item: item('I1', 'Milk'), userDid: 'did:a', onRemove: async (...args) => { removed.push(args); } }));
  try {
    fireEvent.click(view.getByLabelText('Remove Milk'));
    await waitFor(() => assert.equal(removed.length, 1));
    assert.deepEqual(removed[0], ['I1', 'did:a', undefined]);
    assert.deepEqual(fixture.direct, []);
  } finally { cleanup(); }
});
