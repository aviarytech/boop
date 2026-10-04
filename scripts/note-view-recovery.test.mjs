import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { buildNoteViewFixture } from './helpers/note-view-fixture.mjs';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, fireEvent, act, waitFor, cleanup } = await import('@testing-library/react');
await buildNoteViewFixture('tmp/note-view-fixture.mjs');
const { Harness, state } = await import(pathToFileURL(`${process.cwd()}/tmp/note-view-fixture.mjs`));
function setup() {
  localStorage.clear();
  Object.assign(state, { did: 'did:editor', body: 'Original authorized source', canEdit: true, available: true, deny: false, writes: [] });
  return render(React.createElement(Harness));
}
const edit = (view, text) => {
  fireEvent.click(view.getByRole('button', { name: 'Edit', exact: true }));
  fireEvent.change(view.getByRole('textbox', { name: 'Note body' }), { target: { value: text } });
};
test('rendered conflict preserves draft, compares authorized source, then conditionally reconciles', async () => {
  const view = setup();
  try {
    edit(view, 'My reconciled work');
    fireEvent.click(view.getByText('Remote edit'));
    await waitFor(() => assert.ok(view.getByRole('alert')), { timeout: 2000 });
    assert.equal(view.getByRole('textbox', { name: 'Note body' }).value, 'My reconciled work');
    assert.match(view.getByRole('alert').textContent, /Remote authorized change/);
    assert.equal(state.body, 'Remote authorized change');
    fireEvent.click(view.getByText('Replace server version with my draft'));
    await waitFor(() => assert.equal(state.body, 'My reconciled work'));
    assert.equal(state.writes.at(-1).expectedBody, 'Remote authorized change');
  } finally { await act(async () => view.unmount()); cleanup(); }
});
for (const loss of ['Revoke access', 'Downgrade to viewer', 'Save denied before subscription']) {
  test(`rendered ${loss}: only local unsent text is exportable and accounts are isolated`, async () => {
    const view = setup();
    const blobs = [];
    const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    const click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = blob => { blobs.push(blob); return 'blob:test'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = () => {};
    try {
      edit(view, 'My independent draft');
      if (loss === 'Save denied before subscription') {
        state.deny = true;
        await waitFor(() => assert.ok(view.getByText('Download draft')), { timeout: 2000 });
      } else fireEvent.click(view.getByText(loss));
      assert.equal(view.getByRole('textbox', { name: 'Unsent local draft' }).value, 'My independent draft');
      assert.equal(view.queryByText('Compare with the server version'), null);
      assert.equal(view.queryByRole('textbox', { name: 'Note body' }), null);
      fireEvent.click(view.getByText('Download draft'));
      assert.equal(await blobs[0].text(), 'My independent draft');
      const ownKeys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(k => k.startsWith('boop-note-draft:'));
      assert.ok(ownKeys.every(k => k.startsWith('boop-note-draft:did:editor:note:N:')));
      if (loss !== 'Downgrade to viewer') assert.ok(!view.container.textContent.includes('Original authorized source'));
      if (loss === 'Save denied before subscription') state.available = false;
      fireEvent.click(view.getByText('Switch account'));
      assert.equal(view.queryByRole('textbox', { name: 'Unsent local draft' }), null);
      assert.ok(!view.container.textContent.includes('My independent draft'));
      fireEvent.click(view.getByText('Switch account'));
      assert.equal(view.getByRole('textbox', { name: 'Unsent local draft' }).value, 'My independent draft');
    } finally {
      await act(async () => view.unmount()); cleanup();
      URL.createObjectURL = create; URL.revokeObjectURL = revoke; HTMLAnchorElement.prototype.click = click;
    }
  });
}
