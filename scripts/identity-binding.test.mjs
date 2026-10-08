// #236 regressions: an authenticated account can only bind, publish under, file into,
// or act with identities and resources that server state says are its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { getFunctionName } from 'convex/server';

process.env.JWT_SECRET = 'identity-binding-test-secret-not-a-deployed-credential';
delete process.env.WEBVH_DOMAIN;
const outdir = 'tmp/identity-binding-test';
const names = ['userHttp', 'auth', 'actorSession', 'migrations/remintUserDidDb', 'didResources', 'publication', 'lists', 'assignees', 'presence'];
await build({
  entryPoints: names.map(n => `convex/${n}.ts`), outdir, outbase: 'convex', bundle: true, platform: 'node', format: 'esm',
  outExtension: { '.js': '.mjs' }, packages: 'external', logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
});
const modules = Object.fromEntries(await Promise.all(names.map(async n => [n, await import(pathToFileURL(`${process.cwd()}/${outdir}/${n}.mjs`))])));
const call = (module, name, ctx, args) => modules[module][name]._handler(ctx, args);
const hash = value => createHash('sha256').update(value).digest('hex');
const token = subject => new SignJWT({ email: `${subject}@example.test` }).setProtectedHeader({ alg: 'HS256' })
  .setSubject(subject).setIssuer('originals-auth').setAudience('originals-api').setExpirationTime('1h')
  .sign(new TextEncoder().encode(process.env.JWT_SECRET));
const [ownerToken, editorToken] = await Promise.all([token('owner'), token('editor')]);

const OWN = 'did:webvh:NEW:boop.ad:user-owner';
const VICTIM = 'did:webvh:V:boop.ad:user-victimsuborg000';

function fixture() {
  const rows = {
    users: [
      { _id: 'U1', turnkeySubOrgId: 'owner', email: 'owner@example.test', did: 'did:webvh:OLD:trypoo.app:user-owner', legacyDid: 'did:legacy-owner', isCanonicalLogin: true },
      { _id: 'U2', turnkeySubOrgId: 'victimsuborg0000', email: 'victim@example.test', did: VICTIM, isCanonicalLogin: true },
      { _id: 'U3', turnkeySubOrgId: 'editor', email: 'editor@example.test', did: 'did:editor', isCanonicalLogin: true },
    ],
    lists: [
      { _id: 'L1', ownerDid: 'did:webvh:OLD:trypoo.app:user-owner', name: 'Owner list', createdAt: 1 },
      { _id: 'LV', ownerDid: VICTIM, name: 'Victim list', createdAt: 1 },
    ],
    items: [{ _id: 'I1', listId: 'L1', name: 'Private plan', checked: false, createdAt: 1 }],
    categories: [{ _id: 'C-own', ownerDid: 'did:legacy-owner', name: 'Mine', order: 0, createdAt: 1 }, { _id: 'C-victim', ownerDid: VICTIM, name: 'Theirs', order: 0, createdAt: 1 }],
    listGrants: [{ _id: 'G1', listId: 'L1', recipientId: 'U3', role: 'editor' }],
    publications: [], didLogs: [], listTemplates: [], agentApiKeys: [{ _id: 'K1', ownerDid: 'did:webvh:OLD:trypoo.app:user-owner', keyHash: hash('owner-agent-key'), scopes: ['lists:read', 'items:write'] }, { _id: 'K2', ownerDid: 'did:webvh:OLD:trypoo.app:user-owner', keyHash: hash('second-agent-key'), scopes: ['items:write'] }],
    itemAssignees: [], activities: [], presence: [],
    accessSessions: [['S-owner', ownerToken, 'owner'], ['S-editor', editorToken, 'editor']].map(([_id, t, subject]) => ({ _id, tokenHash: hash(t), subject, expiresAt: Date.now() + 3600000 })), noteBodies: [], listEnvelopes: [], referrals: [], bookmarks: [],
  };
  let next = 1;
  const find = id => Object.values(rows).flat().find(row => row._id === id) ?? null;
  const query = table => {
    const predicates = [];
    const q = {
      withIndex: (_i, fn) => { const b = { eq: (k, v) => { predicates.push(r => r[k] === v); return b; }, gte: () => b, lte: () => b }; fn?.(b); return q; },
      order: () => q, filter: () => q,
      collect: async () => (rows[table] ?? []).filter(r => predicates.every(p => p(r))),
      take: async n => (await q.collect()).slice(0, n),
      first: async () => (await q.collect())[0] ?? null,
      unique: async () => (await q.collect())[0] ?? null,
    };
    return q;
  };
  const ctx = { rows, db: {
    get: async id => find(id), query,
    insert: async (table, value) => { const row = { ...value, _id: `${table}-${next++}` }; (rows[table] ??= []).push(row); return row._id; },
    patch: async (id, patch) => { Object.assign(find(id), patch); },
    delete: async id => { for (const t of Object.values(rows)) { const i = t.findIndex(r => r._id === id); if (i >= 0) t.splice(i, 1); } },
  }, scheduler: { runAfter: async () => {}, runAt: async () => {} } };
  ctx.runQuery = ctx.runMutation = async (ref, args) => { const [m, f] = getFunctionName(ref).split(':'); return call(m, f, ctx, args); };
  return ctx;
}
const post = (path, body, authToken = ownerToken) => new Request(`https://test${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` }, body: JSON.stringify(body),
});

test('re-mint cannot move an account onto another account\'s DID', async () => {
  for (const body of [{ did: VICTIM }, { did: VICTIM, didLog: 'log', path: 'user-owner' }, { did: VICTIM, didLog: 'log', path: 'user-victimsuborg000' }]) {
    const ctx = fixture(); const before = structuredClone(ctx.rows);
    const response = await modules.userHttp.remintUserDID._handler(ctx, post('/api/user/remintDid', body));
    assert.equal(response.status, 403, JSON.stringify(body));
    for (const table of ['users', 'lists', 'didLogs', 'agentApiKeys']) assert.deepEqual(ctx.rows[table], before[table]);
  }
});

test('re-mint rejects a DID already held by another account, even at the caller\'s own path', async () => {
  const ctx = fixture();
  ctx.rows.users[1].legacyDid = OWN; // e.g. an orphaned/migrated identity
  const response = await modules.userHttp.remintUserDID._handler(ctx, post('/api/user/remintDid', { did: OWN }));
  assert.equal(response.ok, false);
  assert.equal(ctx.rows.users[0].did, 'did:webvh:OLD:trypoo.app:user-owner');
  assert.equal(ctx.rows.lists[0].ownerDid, 'did:webvh:OLD:trypoo.app:user-owner');
  await assert.rejects(() => call('migrations/remintUserDidDb', 'applyRemint', ctx, { userId: 'U1', oldDid: ctx.rows.users[0].did, newDid: VICTIM }), /another account/);
});

test('a legitimate re-mint at the caller\'s own path moves only whole-DID references', async () => {
  const ctx = fixture();
  const old = ctx.rows.users[0].did;
  ctx.rows.publications.push({ _id: 'P1', listId: 'L1', webvhDid: `${old}/resources/list-L1`, status: 'active' }, { _id: 'P2', listId: 'LV', webvhDid: `${old}0/resources/list-LV`, status: 'active' });
  const response = await modules.userHttp.remintUserDID._handler(ctx, post('/api/user/remintDid', { did: OWN }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(ctx.rows.users[0].did, OWN);
  assert.equal(ctx.rows.lists[0].ownerDid, OWN);
  assert.equal(ctx.rows.lists[1].ownerDid, VICTIM);
  assert.equal(ctx.rows.publications[0].webvhDid, `${OWN}/resources/list-L1`);
  assert.equal(ctx.rows.publications[1].webvhDid, `${old}0/resources/list-LV`, 'a longer DID sharing the prefix is not rewritten');
});

test('updateDID only binds a did:webvh minted at the caller\'s own path', async () => {
  for (const did of [VICTIM, 'did:key:z6MkForged', 'did:webvh:X:boop.ad:user-owner-evil', 'did:webvh:X:boop.ad:evil:user-ownerx']) {
    const ctx = fixture(); ctx.rows.users[0].did = 'did:temp:owner';
    const response = await modules.userHttp.updateUserDID._handler(ctx, post('/api/user/updateDID', { did }));
    assert.ok([400, 403].includes(response.status), `${did} → ${response.status}`);
    assert.equal(ctx.rows.users[0].did, 'did:temp:owner');
  }
  const ctx = fixture(); ctx.rows.users[0].did = 'did:temp:owner';
  const response = await modules.userHttp.updateUserDID._handler(ctx, post('/api/user/updateDID', { did: OWN }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(ctx.rows.users[0].did, OWN);
});

test('publication DIDs name the publisher, and the resolver fallback requires the list owner as controller', async () => {
  const ctx = fixture();
  const own = 'did:webvh:OLD:trypoo.app:user-owner';
  for (const webvhDid of [`${VICTIM}/resources/list-L1`, `${own}/resources/list-LV`, 'did:webvh:public'])
    await assert.rejects(() => call('publication', 'publishList', ctx, { authToken: ownerToken, listId: 'L1', webvhDid }), /own resource DID/);
  assert.equal(ctx.rows.publications.length, 0);
  await call('publication', 'publishList', ctx, { authToken: ownerToken, listId: 'L1', webvhDid: `did:legacy-owner/resources/list-L1` });
  assert.equal(ctx.rows.publications[0].publishedByDid, own);

  // A pre-existing publication claiming the victim's path never resolves there.
  ctx.rows.publications[0].webvhDid = `${VICTIM}/resources/list-L1`;
  assert.equal(await call('didResources', 'getPublishedListForPath', ctx, { listId: 'L1', userPath: 'user-victimsuborg000' }), null);
  // The owner's current and legacy identities still resolve their own publication.
  for (const controller of [own, 'did:legacy-owner']) {
    ctx.rows.publications[0].webvhDid = `${controller}/resources/list-L1`;
    const path = controller.split(':').at(-1);
    assert.equal((await call('didResources', 'getPublishedListForPath', ctx, { listId: 'L1', userPath: path }))?.controllerDid, controller);
  }
  ctx.rows.publications[0].status = 'unpublished';
  assert.equal(await call('didResources', 'getPublishedListForPath', ctx, { listId: 'L1', userPath: 'user-owner' }), null);
  assert.equal(await call('didResources', 'getPublishedListForPath', ctx, { listId: 'not-an-id', userPath: 'user-owner' }), null);
});

test('lists can only be filed in the caller\'s own categories', async () => {
  const ctx = fixture();
  for (const [name, args] of [['createList', { assetDid: 'did:cel:x', name: 'New', createdAt: 2 }], ['updateListCategory', { listId: 'L1' }]]) {
    await assert.rejects(() => call('lists', name, ctx, { ...args, authToken: ownerToken, categoryId: 'C-victim' }), /Resource unavailable/);
    await assert.rejects(() => call('lists', name, ctx, { ...args, authToken: ownerToken, categoryId: 'missing' }), /Resource unavailable/);
  }
  assert.equal(ctx.rows.lists.length, 2);
  assert.equal(ctx.rows.lists[0].categoryId, undefined);
  // A migrated owner's category under the legacy DID still counts as their own.
  await call('lists', 'updateListCategory', ctx, { authToken: ownerToken, listId: 'L1', categoryId: 'C-own' });
  assert.equal(ctx.rows.lists[0].categoryId, 'C-own');
});

test('activity rows record which session or specific API key acted, not just the account', async () => {
  const ctx = fixture();
  await call('assignees', 'assignItem', ctx, { authToken: ownerToken, itemId: 'I1', assigneeDid: 'did:a' });
  await call('assignees', 'assignItem', ctx, { apiKey: 'owner-agent-key', itemId: 'I1', assigneeDid: 'did:b' });
  await call('assignees', 'unassignItem', ctx, { apiKey: 'second-agent-key', itemId: 'I1', assigneeDid: 'did:a' });
  await call('presence', 'heartbeat', ctx, { apiKey: 'second-agent-key', listId: 'L1' });
  const rows = ctx.rows.activities.filter(r => r.actorDid !== 'system:assignment-reconciliation');
  assert.deepEqual(rows.map(r => [r.type, r.actorDid, r.credential]), [
    ['item_assigned', 'did:webvh:OLD:trypoo.app:user-owner', { kind: 'session', id: 'S-owner' }],
    ['item_assigned', 'did:webvh:OLD:trypoo.app:user-owner', { kind: 'apiKey', id: 'K1' }],
    ['item_unassigned', 'did:webvh:OLD:trypoo.app:user-owner', { kind: 'apiKey', id: 'K2' }],
    ['presence_heartbeat', 'did:webvh:OLD:trypoo.app:user-owner', { kind: 'apiKey', id: 'K2' }],
  ]);
  // A credential named in arguments is never what gets recorded.
  await call('assignees', 'assignItem', ctx, { apiKey: 'owner-agent-key', itemId: 'I1', assigneeDid: 'did:c', credential: { kind: 'apiKey', id: 'K2' } });
  assert.deepEqual(ctx.rows.activities.at(-1).credential, { kind: 'apiKey', id: 'K1' });
});

test('the boundary resolves which credential acted: a specific API key, distinct from the owner\'s session', async () => {
  const ctx = fixture();
  const viaSession = await call('actorSession', 'resolve', ctx, { authToken: ownerToken });
  const viaKey = await call('actorSession', 'resolve', ctx, { apiKey: 'owner-agent-key' });
  assert.equal(viaSession.userId, 'U1'); assert.equal(viaKey.userId, 'U1');
  assert.deepEqual(viaSession.credential, { kind: 'session', id: 'S-owner' });
  assert.deepEqual(viaKey.credential, { kind: 'apiKey', id: 'K1' });
  assert.deepEqual(viaKey.scopes, ['lists:read', 'items:write']);
  ctx.rows.agentApiKeys[0].revokedAt = Date.now();
  await assert.rejects(() => call('actorSession', 'resolve', ctx, { apiKey: 'owner-agent-key' }), /Invalid API key/);
});
