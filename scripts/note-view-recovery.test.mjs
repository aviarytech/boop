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
function setup({ seed, ...overrides } = {}) {
  localStorage.clear();
  Object.assign(state, { did: 'did:editor', body: 'Original authorized source', canEdit: true, available: true, deny: false, writes: [], legacyDids: {}, identityLoading: false, ...overrides });
  seed?.();
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

function seedMigratedOwnerDrafts() {
  for (const [did, text] of [
    ['did:legacy-owner', 'Migrated owner unsent draft'],
    ['did:unrelated-owner', 'Unrelated account secret draft'],
  ]) {
    localStorage.setItem(`boop-note-draft:${did}:note:N:session:old`, JSON.stringify({
      text, base: 'Pre-upgrade base', updatedAt: 1, revision: 'old',
    }));
  }
}
const migratedOwner = {
  did: 'did:editor', legacyDids: { 'did:editor': 'did:legacy-owner' },
  list: { _id: 'N', ownerDid: 'did:legacy-owner', name: 'Fixture note', kind: 'note', createdAt: 1 },
  seed: seedMigratedOwnerDrafts,
};
test('migrated owner recovers a legacy draft, reconciles conditionally and writes new edits to canonical namespace', async () => {
  const view = setup(migratedOwner);
  try {
    assert.ok(view.getByRole('alert'));
    fireEvent.click(view.getByRole('button', { name: 'Edit', exact: true }));
    assert.equal(view.getByRole('textbox', { name: 'Note body' }).value, 'Migrated owner unsent draft');
    assert.ok(!view.container.textContent.includes('Unrelated account secret draft'));
    assert.equal(state.writes.length, 0);
    fireEvent.change(view.getByRole('textbox', { name: 'Note body' }), { target: { value: 'Reconciled migrated draft' } });
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    assert.ok(keys.some(k => k.startsWith('boop-note-draft:did:editor:note:N:session:')));
    fireEvent.click(view.getByText('Replace server version with my draft'));
    await waitFor(() => assert.equal(state.body, 'Reconciled migrated draft'));
    assert.equal(state.writes.at(-1).expectedBody, 'Original authorized source');
    // Unknown old sessions are retained: an alias must not weaken draft ownership.
    assert.ok(localStorage.getItem('boop-note-draft:did:legacy-owner:note:N:session:old'));
  } finally { await act(async () => view.unmount()); cleanup(); }
});
for (const available of [true, false]) {
  test(`verified legacy alias is isolated across account switches (source available: ${available})`, async () => {
    const view = setup({ ...migratedOwner, available });
    try {
      if (available) assert.ok(view.getByRole('alert'));
      else {
        assert.equal(view.getByRole('textbox', { name: 'Unsent local draft' }).value, 'Migrated owner unsent draft');
        assert.ok(view.getByText('Download draft'));
        assert.ok(!view.container.textContent.includes('Pre-upgrade base'));
        assert.ok(!view.container.textContent.includes('Original authorized source'));
      }
      assert.ok(!view.container.textContent.includes('Unrelated account secret draft'));
      fireEvent.click(view.getByText('Switch account'));
      assert.equal(view.queryByRole('textbox', { name: 'Unsent local draft' }), null);
      assert.equal(view.queryByRole('alert'), null);
      assert.ok(!view.container.textContent.includes('Migrated owner unsent draft'));
      assert.ok(!view.container.textContent.includes('Unrelated account secret draft'));
      fireEvent.click(view.getByText('Switch account'));
      if (available) assert.ok(view.getByRole('alert'));
      else assert.equal(view.getByRole('textbox', { name: 'Unsent local draft' }).value, 'Migrated owner unsent draft');
      assert.equal(state.writes.length, 0);
    } finally { await act(async () => view.unmount()); cleanup(); }
  });
}
test('legacy alias recovery waits for verified account identity and remains available after revocation', async () => {
  const view = setup({ ...migratedOwner, identityLoading: true });
  try {
    assert.ok(!view.container.textContent.includes('Migrated owner unsent draft'));
    assert.equal(view.queryByRole('alert'), null);
    await act(async () => { state.identityLoading = false; state.refresh(); });
    assert.ok(view.getByRole('alert'));
    fireEvent.click(view.getByText('Revoke access'));
    assert.equal(view.getByRole('textbox', { name: 'Unsent local draft' }).value, 'Migrated owner unsent draft');
    assert.ok(!view.container.textContent.includes('Original authorized source'));
    assert.ok(!view.container.textContent.includes('Pre-upgrade base'));
    assert.equal(state.writes.length, 0);
  } finally { await act(async () => view.unmount()); cleanup(); }
});
