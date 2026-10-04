import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { buildNoteViewFixture } from './helpers/note-view-fixture.mjs';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const React = await import('react');
const { render, fireEvent, cleanup } = await import('@testing-library/react');
await buildNoteViewFixture('tmp/note-sharing-controls.mjs', false, false, true);
const { Harness, state } = await import(pathToFileURL(`${process.cwd()}/tmp/note-sharing-controls.mjs`));
for (const role of ['owner', 'editor', 'viewer']) {
  test(`note ${role} menu respects ownership independently of content editing`, () => {
    localStorage.clear();
    state.did = `did:${role}`; state.canEdit = role !== 'viewer';
    const view = render(React.createElement(Harness));
    try {
      const menu = view.queryByRole('button', { name: /More actions/ });
      if (role === 'owner') {
        assert.ok(menu); fireEvent.click(menu);
        assert.ok(view.getByRole('button', { name: /Rename note/ }));
        assert.ok(view.getByRole('button', { name: /Delete note/ }));
        assert.ok(view.getByRole('button', { name: /Share with people/ }));
      } else {
        if (menu) fireEvent.click(menu);
        assert.equal(view.queryByRole('button', { name: /Rename|Delete|Share/ }), null);
        assert.ok(view.getByRole('link', { name: /Your access/ }));
      }
      assert.equal(!!view.queryByRole('button', { name: 'Edit', exact: true }), role !== 'viewer');
    } finally { cleanup(); }
  });
}
