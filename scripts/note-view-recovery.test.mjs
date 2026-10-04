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
const { Harness, state, drafts } = await import(pathToFileURL(`${process.cwd()}/tmp/note-view-fixture.mjs`));
function setup({ seed, ...overrides } = {}) {
  localStorage.clear();
  Object.assign(state, { did: 'did:editor', body: 'Original authorized source', accessCheckedAt: 1, canEdit: true, available: true, deny: false, writes: [], legacyDids: {}, identityLoading: false, ...overrides });
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
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('boop-note-draft:did:editor:')) {
          const record = JSON.parse(localStorage.getItem(key));
          assert.equal(record.base, undefined); assert.equal(record.detached, true);
        }
      }
      fireEvent.click(view.getByText('Download draft'));
      assert.equal(await blobs[0].text(), 'My independent draft');
      const ownKeys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(k => k.startsWith('boop-note-draft:'));
      assert.ok(ownKeys.length > 0, 'export must not discard drafts');
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

for (const serverLong of [false, true]) test(`viewer note metadata follows visible source (long source: ${serverLong})`, async () => {
  const server = serverLong ? 'x'.repeat(49999) : 'Visible source text';
  const draft = serverLong ? 'short draft' : 'x'.repeat(49999);
  const view = setup({ body: server });
  try {
    edit(view, draft);
    fireEvent.click(view.getByText('Downgrade to viewer'));
    assert.ok(view.getByText(serverLong ? '1 word' : '3 words'));
    assert.equal(!!view.queryByText('49999 / 50000'), serverLong);
    assert.equal(view.getByRole('textbox', { name: 'Unsent local draft' }).value, draft);
    fireEvent.click(view.getByText('Discard draft'));
    assert.equal(view.queryByRole('textbox', { name: 'Unsent local draft' }), null);
    await act(async () => { state.canEdit = true; state.deny = false; state.refresh(); });
    fireEvent.click(view.getByRole('button', { name: 'Edit', exact: true }));
    assert.equal(view.getByRole('textbox', { name: 'Note body' }).value, server);
    assert.equal(state.writes.length, 0, 'discarded draft was resurrected after permissions returned');
  } finally { await act(async () => view.unmount()); cleanup(); }
});
test('unavailable recovery discards only the displayed record and preserves revised drafts and other accounts', async () => {
  const key = 'boop-note-draft:did:editor:note:N:session:discard';
  const otherKey = 'boop-note-draft:did:other:note:N:session:keep';
  const record = text => JSON.stringify({ text, base: 'private base', revision: text, updatedAt: 1 });
  const view = setup({ available: false, seed: () => {
    localStorage.setItem(key, record('Older displayed draft'));
    localStorage.setItem(otherKey, record('Other account draft'));
  } });
  try {
    assert.equal(view.getByRole('textbox', { name: 'Unsent local draft' }).value, 'Older displayed draft');
    // Another tab changes this exact record after rendering, before the click.
    localStorage.setItem(key, record('Newer draft must survive'));
    fireEvent.click(view.getByText('Discard draft'));
    assert.equal(view.getByRole('textbox', { name: 'Unsent local draft' }).value, 'Newer draft must survive');
    assert.equal(localStorage.getItem(key), record('Newer draft must survive'));
    fireEvent.click(view.getByText('Discard draft'));
    assert.equal(localStorage.getItem(key), null);
    assert.equal(view.queryByText('Download draft'), null);
    assert.equal(view.queryByRole('textbox', { name: 'Unsent local draft' }), null);
    assert.equal(localStorage.getItem(otherKey), record('Other account draft'));
    fireEvent.click(view.getByText('Switch account'));
    assert.equal(view.getByRole('textbox', { name: 'Unsent local draft' }).value, 'Other account draft');
  } finally { await act(async () => view.unmount()); cleanup(); }
});

test('discarding one unavailable draft leaves other sessions of the same account recoverable', async () => {
  const view = setup({ available: false, seed: () => {
    for (const text of ['First session', 'Second session']) {
      localStorage.setItem(`boop-note-draft:did:editor:note:N:session:${text}`, JSON.stringify({ text, revision: text, updatedAt: 1 }));
    }
  } });
  try {
    const before = view.getAllByRole('textbox', { name: 'Unsent local draft' }).map(input => input.value);
    fireEvent.click(view.getAllByText('Discard draft')[0]);
    assert.deepEqual(view.getAllByRole('textbox', { name: 'Unsent local draft' }).map(input => input.value), before.slice(1));
  } finally { await act(async () => view.unmount()); cleanup(); }
});

for (const oldDenial of [false, true]) test(`viewer render then promotion and fresh session saves (older denied marker: ${oldDenial})`, async () => {
  let view = setup({ canEdit: false, accessCheckedAt: 99, seed: () => {
    if (oldDenial) {
      drafts.reconcileDraftAccess('did:editor:note:N', true, 98);
      drafts.reconcileDraftAccess('did:editor:note:N', false, 100);
    }
  } });
  try {
    assert.equal(localStorage.getItem('boop-note-access:did:editor:note:N'), oldDenial ? JSON.stringify({canEdit:false,checkedAt:100}) : null);
    await act(async () => { state.canEdit = true; state.accessCheckedAt = 101; state.refresh(); });
    await act(async () => view.unmount());
    view = render(React.createElement(Harness));
    edit(view, 'Fresh authorized work');
    await waitFor(() => assert.equal(state.body, 'Fresh authorized work'), { timeout: 2000 });
    assert.equal(state.writes.length, 1);
    assert.equal(view.queryByText('Download draft'), null);
  } finally { await act(async () => view.unmount()); cleanup(); }
});

test('unavailable rendering cannot repin a reconciled grant at the same server timestamp', async () => {
  const view = setup({ available: false, seed: () => {
    drafts.reconcileDraftAccess('did:editor:note:N', false, 100);
    drafts.reconcileDraftAccess('did:editor:note:N', true, 101);
  } });
  try {
    assert.deepEqual(JSON.parse(localStorage.getItem('boop-note-access:did:editor:note:N')), {canEdit:true,checkedAt:101});
    drafts.reconcileDraftAccess('did:editor:note:N', true, 101);
    assert.equal(drafts.draftIsDetached('did:editor:note:N:session:new'), false);
  } finally { await act(async () => view.unmount()); cleanup(); }
});
