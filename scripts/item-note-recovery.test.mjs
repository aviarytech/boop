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
