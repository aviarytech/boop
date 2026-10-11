import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { buildNoteViewFixture } from './helpers/note-view-fixture.mjs';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, fireEvent, act, waitFor, cleanup } = await import('@testing-library/react');

const fixtures = [];
for (const item of [false, true]) {
  const outfile = `tmp/note-length-${item ? 'item' : 'note'}-fixture.mjs`;
  await buildNoteViewFixture(outfile, false, item);
  fixtures.push({ item, fixture: await import(pathToFileURL(`${process.cwd()}/${outfile}`)) });
}

for (const { item, fixture } of fixtures) {
  test(`${item ? 'item note' : 'note'} editor preserves oversized Unicode pastes, warns, recovers, and saves after shortening`, async () => {
    localStorage.clear();
    const { Harness, state, drafts } = fixture;
    globalThis.__noteViewFixture = state;
    Object.assign(state, { body: '', writes: [], did: 'did:editor', canEdit: true, available: true, deny: false });
    const key = `did:editor:${item ? 'item:I' : 'note:N'}`;
    const text = 'x'.repeat(49999) + '😀' + ' keep this tail';
    let view = render(React.createElement(Harness));
    try {
      fireEvent.change(view.getByRole('textbox', { name: 'Note body' }), { target: { value: text } });
      assert.equal(view.getByRole('textbox', { name: 'Note body' }).value, text);
      assert.match(view.getByRole('alert').textContent, /Not saved to server.*full draft.*50,000/);
      assert.equal(view.getByRole('textbox', { name: 'Note body' }).getAttribute('aria-describedby'), view.getByRole('alert').id);
      assert.equal(drafts.listDrafts(key)[0].text, text);
      await act(async () => await new Promise(resolve => setTimeout(resolve, 650)));
      assert.deepEqual(state.writes, []);
      assert.equal(state.body, '');
      await act(async () => view.unmount());
      view = render(React.createElement(Harness));
      assert.equal(view.getByRole('textbox', { name: 'Note body' }).value, text);
      assert.match(view.getByRole('alert').textContent, /Shorten it/);
      const allowed = 'x'.repeat(49998) + '😀';
      fireEvent.change(view.getByRole('textbox', { name: 'Note body' }), { target: { value: allowed } });
      assert.equal(view.queryByRole('alert'), null);
      await waitFor(() => assert.equal(state.writes.length, 1), { timeout: 2000 });
      assert.equal(state.writes[0][item ? 'description' : 'body'], allowed);
      assert.equal(state.writes[0][item ? 'expectedDescription' : 'expectedBody'], '');
      assert.equal(state.body, allowed);
      assert.equal(view.getByRole('textbox', { name: 'Note body' }).value, allowed);
      assert.ok(view.getByText('Saved'));
      assert.equal(drafts.listDrafts(key).length, 0);
    } finally { await act(async () => view.unmount()); cleanup(); }
  });
}
