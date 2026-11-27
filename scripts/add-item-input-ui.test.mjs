// Render the actual component using the repository's esbuild + Happy DOM convention.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, cleanup, fireEvent, act } = await import('@testing-library/react');
const fixture = globalThis.__addItemInputUi = { did: 'did:owner', feedback: [] };

await build({
  entryPoints: [process.env.ADD_ITEM_SOURCE ?? 'src/components/AddItemInput.tsx'],
  outfile: 'tmp/add-item-input-ui.mjs', bundle: true, jsx: 'automatic',
  platform: 'node', format: 'esm', external: ['react', 'react/jsx-runtime'],
  plugins: [{ name: 'add-item-input-fixtures', setup(b) {
    b.onResolve({ filter: /\/hooks\/(useCurrentUser|useSettings)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path.endsWith('/useCurrentUser')
      ? 'export const useCurrentUser=()=>({did:globalThis.__addItemInputUi.did});'
      : 'export const useSettings=()=>({haptic:value=>globalThis.__addItemInputUi.feedback.push(value)});' }));
  } }],
});
const { AddItemInput } = await import(pathToFileURL(`${process.cwd()}/tmp/add-item-input-ui.mjs`));
afterEach(() => { cleanup(); fixture.did = 'did:owner'; fixture.feedback = []; });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function mount() {
  const calls = [], requests = [];
  const ref = React.createRef();
  const props = { assetDid: 'asset:A', ref, onAddItem: args => {
    calls.push(args); const request = deferred(); requests.push(request); return request.promise;
  } };
  const element = () => React.createElement(React.StrictMode, null, React.createElement(AddItemInput, props));
  const view = render(element());
  const input = () => view.getByRole('textbox', { name: 'Add new item' });
  const type = value => fireEvent.change(input(), { target: { value } });
  const submit = () => fireEvent.submit(view.getByRole('form', { name: 'Add new item' }));
  return { view, calls, requests, props, ref, input, type, submit, rerender: () => view.rerender(element()) };
}

test('rendered input keeps B when the deferred local acceptance of A rejects', async () => {
  const f = mount(); f.type('A'); f.submit(); f.type('B');
  await act(async () => f.requests[0].reject(new Error('local queue unavailable')));
  assert.equal(f.input().value, 'B');
  assert.equal(f.ref.current, f.input());
  assert.ok(f.view.getByRole('button', { name: 'Retry adding A' }));
  assert.match(f.view.getByRole('status').textContent, /haven't been saved on this device/);
  assert.match(f.view.getByRole('status').textContent, /Keep this page open/);
});

test('rendered retry preserves B and its subsequent edits until A is accepted', async () => {
  const f = mount(); f.type('A'); f.submit(); f.type('B');
  await act(async () => f.requests[0].reject(new Error('local queue unavailable')));
  fireEvent.click(f.view.getByRole('button', { name: 'Retry adding A' }));
  assert.equal(f.input().value, 'B');
  assert.deepEqual(f.calls[1], f.calls[0]);
  f.type('B edited');
  await act(async () => f.requests[1].resolve());
  assert.equal(f.input().value, 'B edited');
  assert.equal(f.view.queryByRole('button', { name: 'Retry adding A' }), null);
  assert.equal(f.view.queryByRole('status'), null);
});

for (const scope of ['list', 'account']) {
  for (const fails of [false, true]) test(`${scope} remount isolates drafts/ref and late ${fails ? 'failure' : 'success'}`, async () => {
    const f = mount(); f.type('A'); f.submit(); f.type('Old draft');
    const oldInput = f.input();
    if (scope === 'list') f.props.assetDid = 'asset:B'; else fixture.did = 'did:other';
    f.rerender();
    assert.notEqual(f.input(), oldInput);
    assert.equal(f.ref.current, f.input());
    assert.equal(f.input().value, '');
    f.type('C'); f.submit(); f.type('New draft');
    const feedback = [...fixture.feedback];
    await act(async () => { if (fails) f.requests[0].reject(new Error('late old failure')); else f.requests[0].resolve(); });
    assert.equal(f.input().value, 'New draft');
    assert.deepEqual(fixture.feedback, feedback);
    assert.equal(f.view.queryByRole('status'), null);
    // The old finally block must not unlock the new pending attempt.
    f.submit(); assert.equal(f.calls.length, 2);
    await act(async () => f.requests[1].resolve());
    assert.equal(f.input().value, 'New draft');
  });
}

test('rapid rendered submits and retry clicks queue only one acceptance at a time', async () => {
  const f = mount(); f.type('A');
  act(() => { f.submit(); f.submit(); });
  assert.equal(f.calls.length, 1);
  await act(async () => f.requests[0].reject(new Error('local queue unavailable')));
  const retry = f.view.getByRole('button', { name: 'Retry adding A' });
  act(() => { fireEvent.click(retry); fireEvent.click(retry); });
  assert.equal(f.calls.length, 2);
  await act(async () => f.requests[1].resolve());
});
