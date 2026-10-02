import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { SignJWT } from 'jose';
import { createHash } from 'node:crypto';

process.env.JWT_SECRET = 'note-guards-test-secret-not-a-deployed-credential';
const names = ['items', 'lists', 'publication', 'users', 'notes'];
await build({ entryPoints: names.map(n => `convex/${n}.ts`), outdir: 'tmp/note-guards-test', bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, external: ['convex/*', '@originals/*', '@turnkey/*', 'didwebvh-ts', '@noble/*'] });
const modules = Object.fromEntries(await Promise.all(names.map(async n => [n, await import(pathToFileURL(`${process.cwd()}/tmp/note-guards-test/${n}.mjs`))])));
const call = (module, name, ctx, args) => modules[module][name]._handler(ctx, args);

const authToken = await new SignJWT({ email: 'owner@example.test' }).setProtectedHeader({ alg: 'HS256' })
  .setSubject('owner').setIssuer('originals-auth').setAudience('originals-api')
  .setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));

function fixture() {
  const rows = {
    users: [{ _id: 'U1', turnkeySubOrgId: 'owner', did: 'did:owner', email: 'owner@example.test' }],
    lists: [{ _id: 'N1', ownerDid: 'did:owner', name: 'Journal', kind: 'note', createdAt: 1, assetDid: 'did:note' }],
    noteBodies: [{ _id: 'NB1', listId: 'N1', body: 'secret thoughts', updatedAt: 1 }],
    items: [], publications: [],
    accessSessions: [{ _id: 'S1', tokenHash: createHash('sha256').update(authToken).digest('hex'), subject: 'owner', expiresAt: Date.now() + 3600000 }],
    bookmarks: [], listEnvelopes: [], subscriptions: [], referrals: [], categories: [], agentApiKeys: [],
  };
  let next = 1;
  const find = id => Object.values(rows).flat().find(row => row._id === id) ?? null;
  return { rows, db: {
    get: async id => find(id),
    patch: async (id, patch) => Object.assign(find(id), patch),
    insert: async (table, values) => { const row = { ...values, _id: `new${next++}` }; (rows[table] ??= []).push(row); return row._id; },
    delete: async id => { for (const table of Object.values(rows)) { const at = table.findIndex(row => row._id === id); if (at >= 0) table.splice(at, 1); } },
    query: table => {
      const predicates = [];
      const q = {
        withIndex: (_index, fn) => { const b = { eq: (key, value) => { predicates.push(row => row[key] === value); return b; } }; fn?.(b); return q; },
        order: () => q,
        filter: fn => { const b = { field: key => row => row[key], eq: (l, r) => row => (typeof l === 'function' ? l(row) : l) === r, or: (...ps) => row => ps.some(p => p(row)), and: (...ps) => row => ps.every(p => p(row)) }; predicates.push(fn(b)); return q; },
        collect: async () => (rows[table] ?? []).filter(row => predicates.every(p => p(row))),
        take: async count => (await q.collect()).slice(0, count),
        first: async () => (await q.collect())[0] ?? null,
        unique: async () => (await q.collect())[0] ?? null,
      };
      return q;
    },
  }, scheduler: { runAfter: async () => {}, runAt: async () => {} } };
}

test('a note cannot be published, directly or through the internal path', async () => {
  for (const fn of ['publishList', 'publishListInternal']) {
    const ctx = fixture();
    await assert.rejects(() => call('publication', fn, ctx, { authToken, listId: 'N1', webvhDid: 'did:webvh:note' }), /note/i, fn);
    assert.equal(ctx.rows.publications.length, 0, `${fn} left a publication`);
  }
});

test('deleting a user removes their note bodies', async () => {
  const ctx = fixture();
  await call('users', 'deleteUserData', ctx, { authToken, userId: 'U1' });
  assert.equal(ctx.rows.lists.length, 0);
  assert.deepEqual(ctx.rows.noteBodies, [], 'an orphaned body outlives the erasure');
});

test('items cannot be added to a note', async () => {
  for (const fn of ['addItem', 'addItemInternal']) {
    const ctx = fixture();
    await assert.rejects(() => call('items', fn, ctx, { authToken, listId: 'N1', name: 'smuggled', createdAt: 1 }), /note/i, fn);
    assert.equal(ctx.rows.items.length, 0, `${fn} inserted an item`);
  }
});

test('a note cannot be copied as a list', async () => {
  const ctx = fixture();
  await assert.rejects(() => call('lists', 'copyList', ctx, { authToken, sourceListId: 'N1', assetDid: 'did:copy', celEnvelope: '{}', name: 'Journal (copy)', createdAt: 2 }), /note/i);
  assert.equal(ctx.rows.lists.length, 1, 'copy inserted a list');
});

test('generated api.d.ts registers every Convex module', async () => {
  const api = await readFile('convex/_generated/api.d.ts', 'utf8');
  const modules = (await readdir('convex', { recursive: true }))
    .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.startsWith('_generated') && f !== 'schema.ts' && !f.endsWith('.config.ts'))
    .map(f => f.slice(0, -3));
  for (const m of modules) {
    const alias = m.replaceAll('/', '_');
    assert.ok(api.includes(`import type * as ${alias} from "../${m}.js";`), `missing import for ${m}`);
    assert.match(api, new RegExp(`\\s"?${m}"?: typeof ${alias};`), `missing entry for ${m}`);
  }
});


test('body writes maintain summaries and summary reads never load full bodies', async () => {
  const ctx = fixture();
  await call('notes', 'updateNoteBody', ctx, { authToken, listId: 'N1', body: '# Hello world' });
  assert.equal(ctx.rows.noteBodies[0].body, '# Hello world');
  assert.equal(ctx.rows.lists[0].noteSummary.excerpt, 'Hello world');
  assert.equal(ctx.rows.lists[0].noteSummary.wordCount, 3);
  const query = ctx.db.query;
  ctx.db.query = table => {
    assert.notEqual(table, 'noteBodies', 'summary query read a full body');
    return query(table);
  };
  const cards = await call('notes', 'getNoteCards', ctx, { authToken, listIds: ['N1'] });
  assert.equal(cards[0].excerpt, 'Hello world');
  assert.equal(cards[0].updatedAt, ctx.rows.noteBodies[0].updatedAt);
});

test('summary fallback is bounded and legacy notes remain readable', async () => {
  const ctx = fixture();
  const cards = await call('notes', 'getNoteCards', ctx, { authToken, listIds: ['N1'] });
  assert.equal(cards[0].excerpt, 'secret thoughts');
  await assert.rejects(() => call('notes', 'getNoteCards', ctx, {
    authToken, listIds: Array(51).fill('N1'),
  }), /at most 50/);
});

test('stored summaries retain note access checks', async () => {
  const ctx = fixture();
  ctx.rows.lists[0].ownerDid = 'did:someone-else';
  ctx.rows.lists[0].noteSummary = { excerpt: 'private', wordCount: 1, updatedAt: 1 };
  assert.deepEqual(await call('notes', 'getNoteCards', ctx, { authToken, listIds: ['N1'] }), []);
  await assert.rejects(() => call('notes', 'updateNoteBody', ctx, { authToken, listId: 'N1', body: 'attack' }));
  assert.equal(ctx.rows.noteBodies[0].body, 'secret thoughts');
});
