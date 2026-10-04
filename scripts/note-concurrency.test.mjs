import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { fixture, credentials } from './helpers/private-sharing-fixture.mjs';

await build({ entryPoints: ['convex/notes.ts'], outfile: 'tmp/note-concurrency.mjs', bundle: true,
  platform: 'node', format: 'esm', external: ['convex/*'] });
const notes = await import(pathToFileURL(`${process.cwd()}/tmp/note-concurrency.mjs`));
const make = () => fixture({ notes });
const conflict = error => {
  assert.deepEqual(error.data, { code: 'NOTE_CONFLICT', message: 'The note changed. Review both versions before saving.' });
  return true;
};
const denied = error => {
  assert.deepEqual(error.data, { kind: 'auth', code: 'FORBIDDEN', message: 'Resource unavailable' });
  return true;
};
for (const endpoint of ['updateNoteBody', 'updateNoteBodyInternal']) {
  for (const auth of [credentials('editor'), { apiKey: 'key-editor' }]) {
    test(`${endpoint} (${auth.apiKey ? 'API key' : 'session'}): stale, omitted and empty expected bodies cannot bypass CAS`, async () => {
      const ctx = make();
      const save = args => notes[endpoint]._handler(ctx, { ...auth, listId: 'N', ...args });
      const initial = await notes.getNoteBody._handler(ctx, { ...auth, listId: 'N' });
      await notes.updateNoteBody._handler(ctx, { ...credentials('owner'), listId: 'N', body: 'Owner changed it', expectedBody: initial.body });
      const before = structuredClone(ctx.rows);
      for (const expected of [{}, { expectedBody: initial.body }, { expectedBody: '' }]) {
        await assert.rejects(() => save({ body: 'Unsent editor draft', ...expected }), conflict);
        assert.deepEqual(ctx.rows, before);
      }
      // Reconciliation is conditional too: a second writer may win again.
      const current = await notes.getNoteBody._handler(ctx, { ...auth, listId: 'N' });
      await save({ body: 'Reconciled draft', expectedBody: current.body });
      await assert.rejects(() => save({ body: 'Late reconciliation', expectedBody: current.body }), conflict);
      assert.equal(ctx.rows.noteBodies[0].body, 'Reconciled draft');
      assert.equal(ctx.rows.lists.find(l => l._id === 'N').noteSummary.excerpt, 'Reconciled draft');
    });
    test(`${endpoint} (${auth.apiKey ? 'API key' : 'session'}): current permission precedes concurrency and body reads`, async () => {
      for (const state of ['revoked', 'viewer']) for (const expected of [{}, { expectedBody: 'Private note body' }, { expectedBody: 'stale' }]) {
        const ctx = make();
        const grant = ctx.rows.listGrants.find(g => g._id === 'G-N-editor');
        if (state === 'revoked') ctx.rows.listGrants = ctx.rows.listGrants.filter(g => g !== grant); else grant.role = 'viewer';
        const before = structuredClone(ctx.rows.noteBodies);
        await assert.rejects(() => notes[endpoint]._handler(ctx, { ...auth, listId: 'N', body: 'Draft', ...expected }), denied);
        assert.deepEqual(ctx.rows.noteBodies, before);
        assert.ok(!ctx.reads.some(r => r.table === 'noteBodies'));
        if (state === 'revoked') assert.equal(await notes.getNoteBody._handler(ctx, { ...auth, listId: 'N' }), null);
      }
    });
  }
}
test('new/legacy body-less notes require the explicit empty base, including empty saves', async () => {
  const ctx = make(); ctx.rows.noteBodies = [];
  const save = args => notes.updateNoteBody._handler(ctx, { ...credentials('owner'), listId: 'N', ...args });
  await assert.rejects(() => save({ body: '' }), conflict);
  assert.equal(ctx.rows.noteBodies.length, 0);
  await save({ body: 'First version', expectedBody: '' });
  assert.equal(ctx.rows.noteBodies[0].body, 'First version');
  await assert.rejects(() => save({ body: 'Second initializer', expectedBody: '' }), conflict);
});
test('API write scope is still mandatory with a matching base', async () => {
  const ctx = make(); ctx.rows.agentApiKeys.find(k => k._id === 'KEY-editor').scopes = ['lists:read'];
  await assert.rejects(() => notes.updateNoteBodyInternal._handler(ctx, {
    apiKey: 'key-editor', listId: 'N', expectedBody: 'Private note body', body: 'Attempt',
  }), error => error.data?.code === 'FORBIDDEN');
  assert.equal(ctx.rows.noteBodies[0].body, 'Private note body');
});
