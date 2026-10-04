import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { buildNoteViewFixture } from './helpers/note-view-fixture.mjs';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, fireEvent, act, waitFor, cleanup } = await import('@testing-library/react');
await buildNoteViewFixture('tmp/item-note-fixture.mjs', false, true);
const { Harness, state } = await import(pathToFileURL(`${process.cwd()}/tmp/item-note-fixture.mjs`));
test('item-note caller presents permission denial from shared autosave hook as independent recovery', async () => {
  localStorage.clear();
  const view = render(React.createElement(Harness));
  try {
    state.deny = true;
    fireEvent.change(view.getByRole('textbox', { name: 'Note body' }), { target: { value: 'Unsent item note' } });
    await waitFor(() => assert.ok(view.getByText('Download draft')), { timeout: 2000 });
    assert.equal(view.getByRole('textbox', { name: 'Unsent local draft' }).value, 'Unsent item note');
    assert.equal(view.queryByRole('textbox', { name: 'Note body' }), null);
    assert.equal(view.queryByText('Retry'), null);
    assert.ok(!view.container.textContent.includes('Original authorized source'));
    assert.ok(!view.container.textContent.includes('Fixture item'));
    assert.equal(state.writes.length, 1);
    assert.equal(state.writes[0].expectedDescription, 'Original authorized source');
    fireEvent.click(view.getByText('Switch account'));
    assert.equal(view.queryByRole('textbox', { name: 'Unsent local draft' }), null);
  } finally { await act(async () => view.unmount()); cleanup(); }
});

for (const serverLong of [false, true]) test(`viewer item-note counts visible source and hides editing toggle (long source: ${serverLong})`, async () => {
  localStorage.clear();
  const server = serverLong ? 'x'.repeat(49999) : 'Visible source';
  Object.assign(state, { did: 'did:editor', body: server, canEdit: true, available: true, deny: false, writes: [] });
  const view = render(React.createElement(Harness));
  try {
    fireEvent.change(view.getByRole('textbox', { name: 'Note body' }), { target: { value: serverLong ? 'short draft' : 'x'.repeat(49999) } });
    fireEvent.click(view.getByText('Downgrade to viewer'));
    assert.equal(view.queryByRole('button', { name: 'Edit', exact: true }), null);
    assert.equal(view.queryByRole('button', { name: 'Preview', exact: true }), null);
    assert.equal(!!view.queryByText('49999 / 50000'), serverLong);
    fireEvent.click(view.getByText('Discard draft'));
    assert.equal(view.queryByRole('textbox', { name: 'Unsent local draft' }), null);
    await act(async () => { state.canEdit = true; state.deny = false; state.refresh(); });
    assert.equal(view.getByRole('textbox', { name: 'Note body' }).value, server);
    assert.equal(state.writes.length, 0);
  } finally { await act(async () => view.unmount()); cleanup(); }
});
