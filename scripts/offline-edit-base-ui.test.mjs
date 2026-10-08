import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { render, fireEvent, waitFor, cleanup } = await import('@testing-library/react');
const { createElement } = await import('react');
const fixture = globalThis.__editBase = { queued: [] };
await build({ entryPoints: ['src/components/BatchOperations.tsx', 'src/components/ListItem.tsx'], outdir: 'tmp/offline-edit-base-ui', outbase: '.', bundle: true, splitting: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'react-dom'], plugins: [{ name: 'edit-base-fixtures', setup(b) {
  b.onResolve({ filter: /\/useOffline$|\/useSettings$|\/SubItems$|\/ItemAttribution$|\/ItemDetailsModal$|\/share$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents:
    path.endsWith('/useOffline') ? 'export const useOffline=()=>({queueMutation:async(input,snapshots)=>{globalThis.__editBase.queued.push({input,snapshots});return 1;}});' :
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
const item = (id, name, extra = {}) => ({ _id: id, _creationTime: 1, listId: 'L1', name, checked: false, createdByDid: 'did:a', createdAt: 1, updatedAt: 1, ...extra });

// Without the rendered rows, an uncached target is queued with an 'unknown'
// revision and the server rejects the user's own edit as a conflict.
test('batch operations queue the selected rendered rows as their edit base', async () => {
  const rows = [item('I1', 'Milk'), item('I2', 'Bread', { _operationId: 'op-prior', _isOptimistic: true }), item('I3', 'Eggs')];
  for (const [label, type] of [['Check all selected items', 'batchCheckItems'], ['Uncheck all selected items', 'batchUncheckItems']]) {
    fixture.queued = [];
    const view = render(createElement(BatchOperations, { selectedIds: new Set(['I1', 'I2']), items: rows, onClearSelection() {}, userDid: 'did:a' }));
    try {
      fireEvent.click(view.getByLabelText(label));
      await waitFor(() => assert.equal(fixture.queued.length, 1));
      assert.equal(fixture.queued[0].input.type, type);
      assert.deepEqual(fixture.queued[0].snapshots?.map(i => i._id), ['I1', 'I2']);
    } finally { cleanup(); }
  }
});

test('row remove and fallback toggles queue the rendered row as their edit base', async () => {
  const row = item('I1', 'Milk');
  for (const [label, type] of [['Remove Milk', 'removeItem'], ['Check Milk', 'checkItem']]) {
    fixture.queued = [];
    const view = render(createElement(ListItem, { item: row, userDid: 'did:a' }));
    try {
      fireEvent.click(view.getByLabelText(label));
      await waitFor(() => assert.equal(fixture.queued.length, 1));
      assert.equal(fixture.queued[0].input.type, type);
      assert.deepEqual(fixture.queued[0].snapshots, [row]);
    } finally { cleanup(); }
  }
});
