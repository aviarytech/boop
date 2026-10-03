import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { SignJWT } from 'jose';
import { createHash } from 'node:crypto';

process.env.JWT_SECRET = 'note-guards-test-secret-not-a-deployed-credential';
const names = ['items', 'lists', 'publication', 'users', 'notes', 'auth', 'migrations/remintUserDidDb'];
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
  const jobs = [];
  return { rows, jobs, db: {
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
  }, scheduler: { runAfter: async (_delay, _ref, args) => { jobs.push(args); }, runAt: async () => {} } };
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
  while (ctx.jobs.length) await call('users', 'continueUserDeletion', ctx, ctx.jobs.shift());
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

test('stale note writes cannot overwrite a body or its summary', async () => {
  const ctx = fixture();
  await call('notes', 'updateNoteBody', ctx, { authToken, listId:'N1', body:'first', expectedBody:'secret thoughts' });
  await assert.rejects(() => call('notes', 'updateNoteBody', ctx, {authToken,listId:'N1',body:'stale',expectedBody:'secret thoughts'}), /NOTE_CONFLICT/);
  assert.equal(ctx.rows.noteBodies[0].body, 'first');
  assert.equal(ctx.rows.lists[0].noteSummary.excerpt, 'first');
});

test('item descriptions also reject stale editor writes', async () => {
  const ctx = fixture();
  ctx.rows.items.push({_id:'I1',listId:'N1',description:'remote work'});
  await assert.rejects(() => call('items','updateItem',ctx,{authToken,itemId:'I1',description:'stale',expectedDescription:'old'}), /NOTE_CONFLICT/);
  assert.equal(ctx.rows.items[0].description, 'remote work');
});

test('conflict errors expose structured data for production RPC clients', async () => {
  const ctx = fixture();
  await assert.rejects(() => call('notes','updateNoteBody',ctx,{
    authToken,listId:'N1',body:'stale',expectedBody:'wrong base',
  }), error => {
    assert.equal(error.data?.code,'NOTE_CONFLICT');
    assert.equal(typeof error.data?.message,'string');
    return true;
  });
});

test('large account erasure bounds note reads and continues after logout', async () => {
  const ctx = fixture();
  ctx.rows.users[0].legacyDid = 'did:legacy';
  ctx.rows.lists = Array.from({ length: 121 }, (_, i) => ({
    _id: `N${i}`, ownerDid: i < 61 ? 'did:owner' : 'did:legacy',
    name: 'Journal', kind: 'note', createdAt: 1, assetDid: `did:note:${i}`,
  }));
  ctx.rows.noteBodies = ctx.rows.lists.map((l, i) => ({
    _id: `NB${i}`, listId: l._id, body: '漢'.repeat(50000), updatedAt: 1,
  }));
  const pending = [];
  ctx.scheduler.runAfter = async (_delay, _ref, args) => { pending.push(args); };
  let bytes = 0, batches = 0;
  const query = ctx.db.query;
  ctx.db.query = table => {
    const q = query(table);
    if (table === 'noteBodies') {
      const collect = q.collect;
      q.collect = async () => {
        const rows = await collect();
        for (const row of rows) bytes += Buffer.byteLength(row.body);
        assert.ok(bytes <= 3_000_000, `body read budget exceeded: ${bytes}`);
        return rows;
      };
    }
    return q;
  };
  await call('users', 'deleteUserData', ctx, { authToken, userId: 'U1' });
  assert.equal(ctx.rows.noteBodies.length, 120);
  assert.ok(ctx.rows.users[0].deletionRequestedAt !== undefined);
  // An accepted deletion blocks new writes, even with a still-valid session.
  await assert.rejects(() => call('notes', 'updateNoteBody', ctx,
    { authToken, listId: 'N30', body: 'new data' }), /User unavailable/);
  ctx.rows.accessSessions = []; // Simulate logout; jobs must not need this token.
  while (pending.length) {
    assert.ok(++batches < 400, 'continuation made no progress');
    bytes = 0;
    await call('users', 'continueUserDeletion', ctx, pending.shift());
  }
  assert.equal(ctx.rows.noteBodies.length, 0);
  assert.equal(ctx.rows.lists.length, 0);
  assert.equal(ctx.rows.users.length, 0);
  // A duplicate scheduled delivery is harmless.
  await call('users', 'continueUserDeletion', ctx, { userId: 'U1' });
});

test('deletion continuation cannot erase an account without a deletion request', async () => {
  const ctx = fixture();
  await call('users', 'continueUserDeletion', ctx, { userId: 'U1' });
  assert.equal(ctx.rows.users.length, 1);
  assert.equal(ctx.rows.noteBodies.length, 1);
});


test('erasure drains large items and children, and an authenticated owner can resume', async () => {
  const ctx = fixture();
  ctx.rows.lists[0].kind = undefined;
  ctx.rows.items = Array.from({ length: 120 }, (_, i) => ({
    _id: `I${i}`, listId: 'N1', name: 'Item', description: '漢'.repeat(50000),
    checked: false, createdByDid: 'did:owner', createdAt: i,
  }));
  ctx.rows.comments = Array.from({ length: 17 }, (_, i) => ({
    _id: `C${i}`, itemId: 'I0', body: 'x'.repeat(900000),
  }));
  ctx.rows.listEnvelopes = [{ _id: 'E1', listId: 'N1', envelope: 'private metadata' }];
  let bytes = 0;
  const query = ctx.db.query;
  ctx.db.query = table => {
    const q = query(table);
    // Meter only documents returned by each terminal operation.
    const originals = Object.fromEntries(['collect', 'take', 'first', 'unique'].map(k => [k, q[k]]));
    const meter = rows => {
      for (const row of (Array.isArray(rows) ? rows : rows ? [rows] : [])) {
        bytes += Buffer.byteLength(JSON.stringify(row));
      }
      assert.ok(bytes < 8 * 1024 * 1024, `transaction read ${bytes} bytes`);
      return rows;
    };
    for (const name of Object.keys(originals)) q[name] = async (...args) => {
      // Fixture terminals call collect internally; don't count those twice.
      Object.assign(q, originals);
      return meter(await originals[name](...args));
    };
    return q;
  };
  await call('users', 'deleteUserData', ctx, { authToken, userId: 'U1' });
  assert.ok(ctx.rows.users[0].deletionRequestedAt !== undefined);
  ctx.jobs.length = 0; // Simulate a continuation that failed before making progress.
  bytes = 0;
  await assert.rejects(() => call('users', 'deleteUserData', ctx,
    { authToken, userId: 'someone-else', ownerDid: 'did:other' }));
  bytes = 0;
  await call('users', 'deleteUserData', ctx, { authToken, userId: 'U1' });
  assert.ok(ctx.jobs.length > 0, 'resume did not schedule further work');
  let count = 0;
  while (ctx.jobs.length) {
    assert.ok(++count < 200);
    bytes = 0;
    await call('users', 'continueUserDeletion', ctx, ctx.jobs.shift());
  }
  for (const table of ['users', 'lists', 'items', 'comments', 'noteBodies', 'listEnvelopes']) {
    assert.equal(ctx.rows[table].length, 0, table);
  }
});


for (const legacyOwner of [false, true]) {
  test(`published-list writers cannot prolong erasure (legacy owner: ${legacyOwner})`, async () => {
    const guestToken = await new SignJWT({ email: 'guest@example.test' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject('guest')
      .setIssuer('originals-auth').setAudience('originals-api').setExpirationTime('1h')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const ctx = fixture();
    delete ctx.rows.lists[0].kind;
    if (legacyOwner) {
      ctx.rows.users[0].legacyDid = 'did:legacy';
      ctx.rows.lists[0].ownerDid = 'did:legacy';
    }
    ctx.rows.users.push({ _id: 'U2', did: 'did:guest', turnkeySubOrgId: 'guest', email: 'guest@example.test' });
    ctx.rows.accessSessions.push({ _id: 'S2', tokenHash: createHash('sha256').update(guestToken).digest('hex'),
      subject: 'guest', expiresAt: Date.now() + 3600000 });
    ctx.rows.publications.push({ _id: 'P1', listId: 'N1', status: 'active' });
    // Confirm this collaborator had write access before erasure began.
    await call('items', 'addItem', ctx, { authToken: guestToken, listId: 'N1', name: 'Allowed', createdAt: 1 });
    ctx.jobs.length = 0; // Notification jobs are unrelated to the deletion worker.
    await call('users', 'deleteUserData', ctx, { authToken, userId: 'U1' });
    assert.equal(ctx.rows.publications[0].status, 'active');
    for (let i = 0; i < 10; i++) {
      await assert.rejects(() => call('items', 'addItem', ctx,
        { authToken: guestToken, listId: 'N1', name: 'Replacement', createdAt: i }), /unavailable/i);
    }
    // getList uses the permission helper rather than the resource wrapper.
    assert.equal(await call('lists', 'getList', ctx, { authToken: guestToken, listId: 'N1' }), null);
    while (ctx.jobs.length) await call('users', 'continueUserDeletion', ctx, ctx.jobs.shift());
    assert.equal(ctx.rows.lists.length, 0);
    assert.equal(ctx.rows.items.length, 0);
    assert.equal(ctx.rows.publications.length, 0);
    assert.ok(!ctx.rows.users.some(u => u._id === 'U1'));
    assert.ok(ctx.rows.users.some(u => u._id === 'U2'));
  });
}


test('identity upgrades and remints are blocked during erasure; login and resume still work', async () => {
  const ctx = fixture();
  ctx.rows.users[0].did = 'did:key:old';
  ctx.rows.users[0].legacyDid = 'did:legacy';
  ctx.rows.lists[0].ownerDid = 'did:key:old';
  await call('users', 'deleteUserData', ctx, { authToken, userId: 'U1' });
  assert.deepEqual(ctx.rows.users[0].deletionDids, ['did:key:old', 'did:legacy']);
  await assert.rejects(() => call('auth', 'upsertUserInternal', ctx, {
    turnkeySubOrgId: 'owner', email: 'owner@example.test', did: 'did:webvh:new:example.test:user',
  }), /unavailable/i);
  await assert.rejects(() => call('migrations/remintUserDidDb', 'applyRemint', ctx, {
    userId: 'U1', oldDid: 'did:key:old', newDid: 'did:webvh:new:example.test:user',
  }), /deletion/i);
  assert.equal(ctx.rows.users[0].did, 'did:key:old');
  // OTP login without an identity change must remain possible to reach Resume.
  assert.equal(await call('auth', 'upsertUserInternal', ctx, {
    turnkeySubOrgId: 'owner', email: 'owner@example.test',
  }), 'U1');
  await call('users', 'deleteUserData', ctx, { authToken, userId: 'U1' });
  while (ctx.jobs.length) await call('users', 'continueUserDeletion', ctx, ctx.jobs.shift());
  assert.equal(ctx.rows.users.length, 0);
  assert.equal(ctx.rows.lists.length, 0);
  assert.equal(ctx.rows.noteBodies.length, 0);
});

test('erasure retries retain the original identity snapshot even if the user row changes', async () => {
  const ctx = fixture();
  ctx.rows.users[0].legacyDid = 'did:legacy';
  ctx.rows.lists.push({ _id: 'N2', ownerDid: 'did:legacy', name: 'Legacy', kind: 'note', createdAt: 2 });
  ctx.rows.noteBodies.push({ _id: 'NB2', listId: 'N2', body: 'must erase', updatedAt: 2 });
  await call('users', 'deleteUserData', ctx, { authToken, userId: 'U1' });
  // Simulate an out-of-band operator change. Normal identity writers now reject it.
  ctx.rows.users[0].did = 'did:changed';
  ctx.rows.users[0].legacyDid = undefined;
  await call('users', 'deleteUserData', ctx, { authToken, userId: 'U1' });
  assert.deepEqual(ctx.rows.users[0].deletionDids, ['did:owner', 'did:legacy']);
  while (ctx.jobs.length) await call('users', 'continueUserDeletion', ctx, ctx.jobs.shift());
  assert.equal(ctx.rows.users.length, 0);
  assert.equal(ctx.rows.lists.length, 0);
  assert.equal(ctx.rows.noteBodies.length, 0);
});

test('account erasure drains only its own durable replay receipts and isolated counter in bounded resumable batches', async () => {
  const ctx = fixture();
  ctx.rows.lists = []; ctx.rows.noteBodies = [];
  ctx.rows.replaySequences = [{ _id: 'counter-own', accountId: 'U1', sequence: 11 }, { _id: 'counter-other', accountId: 'U2', sequence: 3 }];
  ctx.rows.offlineReceipts = [
    ...Array.from({ length: 11 }, (_, i) => ({ _id: `receipt-${i}`, accountId: 'U1', operationId: `op-${i}` })),
    { _id: 'other-receipt', accountId: 'U2', operationId: 'other' },
  ];
  await call('users', 'deleteUserData', ctx, { authToken, userId: 'U1' });
  assert.equal(ctx.rows.offlineReceipts.length, 8);
  assert.ok(ctx.rows.users.some(u => u._id === 'U1'), 'account remains tombstoned until receipt cleanup completes');
  while (ctx.jobs.length) {
    const before = ctx.rows.offlineReceipts.length;
    await call('users', 'continueUserDeletion', ctx, ctx.jobs.shift());
    assert.ok(before - ctx.rows.offlineReceipts.length <= 4);
  }
  assert.deepEqual(ctx.rows.offlineReceipts.map(r => r._id), ['other-receipt']);
  assert.deepEqual(ctx.rows.replaySequences.map(r => r._id), ['counter-other']);
  assert.equal(ctx.rows.users.length, 0);
});
