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
const names = ['userHttp', 'users', 'didLogsHttp', 'didLogs', 'didLogValidation', 'auth', 'actorSession', 'migrations/remintUserDidDb', 'didResources', 'publication', 'lists', 'assignees', 'presence', 'comments', 'activity'];
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

// A real author DID at the owner's path (#286): its log is checked on write.
// Turnkey is mocked with local keys (scripts/helpers/author-did-fixture.ts).
await build({ entryPoints: ['scripts/helpers/author-did-fixture.ts'], outfile: `${outdir}/author-fixture.mjs`, bundle: true, platform: 'node', format: 'esm', logLevel: 'error' });
const authorFixture = await import(pathToFileURL(`${process.cwd()}/${outdir}/author-fixture.mjs`));
const ownTurnkey = await authorFixture.mockTurnkey();
const ownAuthor = await authorFixture.mintAuthor(ownTurnkey, { path: 'user-owner' });
const OWN_ACCOUNTS = await authorFixture.accountsOf(ownTurnkey);
const OWN = ownAuthor.did;
const OWN_LOG = ownAuthor.jsonl;
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
    itemAssignees: [], activities: [], presence: [], comments: [],
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
      paginate: async ({ numItems, cursor }) => {
        const all = await q.collect(); const start = Number(cursor ?? 0);
        return { page: all.slice(start, start + numItems), isDone: start + numItems >= all.length, continueCursor: String(start + numItems) };
      },
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
  // The sub-org's Turnkey accounts (read-only, parent API key) come from the mock wallet.
  ctx.accounts = OWN_ACCOUNTS;
  ctx.runQuery = ctx.runMutation = ctx.runAction = async (ref, args) => {
    const [m, f] = getFunctionName(ref).split(':');
    if (m === 'authInternal' && f === 'listSubOrgEd25519Accounts') return ctx.accounts;
    return call(m, f, ctx, args);
  };
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
  const response = await modules.userHttp.remintUserDID._handler(ctx, post('/api/user/remintDid', { did: OWN, didLog: OWN_LOG, path: 'user-owner' }));
  assert.equal(response.ok, false);
  assert.equal(ctx.rows.users[0].did, 'did:webvh:OLD:trypoo.app:user-owner');
  assert.equal(ctx.rows.lists[0].ownerDid, 'did:webvh:OLD:trypoo.app:user-owner');
  await assert.rejects(() => call('migrations/remintUserDidDb', 'applyRemint', ctx, { userId: 'U1', oldDid: ctx.rows.users[0].did, newDid: VICTIM }), /another account/);
});

test('a legitimate re-mint at the caller\'s own path moves only whole-DID references', async () => {
  const ctx = fixture();
  const old = ctx.rows.users[0].did;
  ctx.rows.publications.push({ _id: 'P1', listId: 'L1', webvhDid: `${old}/resources/list-L1`, status: 'active' }, { _id: 'P2', listId: 'LV', webvhDid: `${old}0/resources/list-LV`, status: 'active' });
  const response = await modules.userHttp.remintUserDID._handler(ctx, post('/api/user/remintDid', { did: OWN, didLog: OWN_LOG, path: 'user-owner' }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(ctx.rows.users[0].did, OWN);
  assert.deepEqual(ctx.rows.didLogs.map(r => [r.userDid, r.path, r.log, r.author]), [[OWN, 'user-owner', OWN_LOG, true]]);
  assert.equal(ctx.rows.lists[0].ownerDid, OWN);
  assert.equal(ctx.rows.lists[1].ownerDid, VICTIM);
  assert.equal(ctx.rows.publications[0].webvhDid, `${OWN}/resources/list-L1`);
  assert.equal(ctx.rows.publications[1].webvhDid, `${old}0/resources/list-LV`, 'a longer DID sharing the prefix is not rewritten');
});

test('updateDID only binds a did:webvh minted at the caller\'s own path', async () => {
  for (const did of [VICTIM, 'did:key:z6MkForged', 'did:webvh:X:boop.ad:user-owner-evil', 'did:webvh:X:boop.ad:evil:user-ownerx']) {
    const ctx = fixture(); delete ctx.rows.users[0].did;
    const response = await modules.userHttp.updateUserDID._handler(ctx, post('/api/user/updateDID', { did }));
    assert.ok([400, 403].includes(response.status), `${did} → ${response.status}`);
    assert.equal(ctx.rows.users[0].did, undefined);
  }
  const ctx = fixture(); delete ctx.rows.users[0].did;
  // #286: only after its author log is served.
  const early = await modules.userHttp.updateUserDID._handler(ctx, post('/api/user/updateDID', { did: OWN }));
  assert.equal(early.status, 409);
  const stored = await modules.didLogsHttp.storeDidLog._handler(ctx, post('/api/did/log', { userDid: OWN, path: 'user-owner', log: OWN_LOG }));
  assert.equal(stored.status, 200, await stored.clone().text());
  const response = await modules.userHttp.updateUserDID._handler(ctx, post('/api/user/updateDID', { did: OWN }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(ctx.rows.users[0].did, OWN);
});

// #286: re-genesis moves an account only onto a verifiable author DID, and
// only while it has none on the current domain.
test('re-mint requires a verifiable author DID log and refuses to walk an author DID', async () => {
  const legacy = await authorFixture.mintLegacyDid('boop.ad', 'user-owner');
  for (const [body, status] of [
    [{ did: OWN, path: 'user-owner' }, 400],
    [{ did: OWN, didLog: 'not json', path: 'user-owner' }, 422],
    [{ did: legacy.did, didLog: legacy.jsonl, path: 'user-owner' }, 422],
    [{ did: OWN, didLog: legacy.jsonl, path: 'user-owner' }, 422],
  ]) {
    const ctx = fixture(); const before = structuredClone(ctx.rows);
    const response = await modules.userHttp.remintUserDID._handler(ctx, post('/api/user/remintDid', body));
    assert.equal(response.status, status, `${JSON.stringify(body).slice(0, 80)} → ${await response.clone().text()}`);
    for (const table of ['users', 'lists', 'didLogs']) assert.deepEqual(ctx.rows[table], before[table]);
  }
  process.env.WEBVH_DOMAIN = 'boop.ad';
  try {
    const ctx = fixture();
    ctx.rows.users[0].did = OWN;
    ctx.rows.didLogs.push({ _id: 'D1', userDid: OWN, path: 'user-owner', log: OWN_LOG, author: true, updatedAt: 1 });
    const next = await authorFixture.mintAuthor(await authorFixture.mockTurnkey(), { path: 'user-owner' });
    const response = await modules.userHttp.remintUserDID._handler(ctx, post('/api/user/remintDid', { did: next.did, didLog: next.jsonl, path: 'user-owner' }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).newDid, OWN, 'an author DID on the current domain is kept');
    assert.equal(ctx.rows.users[0].did, OWN);
  } finally { delete process.env.WEBVH_DOMAIN; }
});

test('DID log writes: only a continuation of the served DID, never another DID at the same path', async () => {
  const turnkey = await authorFixture.mockTurnkey();
  const author = await authorFixture.mintAuthor(turnkey, { path: 'user-owner' });
  const updated = await authorFixture.updateAuthor(turnkey, author);
  const forged = await authorFixture.resignLastEntry(updated, author.keys.author.multikey, turnkey.secretFor("m/44'/501'/1'/0'"), author.keys.assertion.multikey);
  const store = (ctx, body) => modules.didLogsHttp.storeDidLog._handler(ctx, post('/api/did/log', body));

  const ctx = fixture(); delete ctx.rows.users[0].did;
  ctx.accounts = await authorFixture.accountsOf(turnkey);
  assert.equal((await store(ctx, { userDid: author.did, path: 'user-owner', log: author.jsonl })).status, 200);
  assert.equal((await store(ctx, { userDid: author.did, path: 'user-owner', log: forged })).status, 422, 'signed by a key that is not an update key');
  assert.equal((await store(ctx, { userDid: author.did, path: 'user-owner', log: OWN_LOG })).status, 422, 'another DID\'s log');
  // The served DID is no account's (this sign-up never adopted it), so a replacement is checked, and this one isn't the account's author DID.
  assert.equal((await store(ctx, { userDid: OWN, path: 'user-owner', log: OWN_LOG })).status, 422, 'another DID at a served path must be this account\'s author DID');
  assert.equal(ctx.rows.didLogs[0].log, author.jsonl);
  assert.equal((await store(ctx, { userDid: author.did, path: 'user-owner', log: updated })).status, 200);
  assert.deepEqual([ctx.rows.didLogs.length, ctx.rows.didLogs[0].log, ctx.rows.didLogs[0].versionId], [1, updated, JSON.parse(updated.split('\n')[1]).versionId]);

  // An account that already has a did:webvh cannot start serving a second one.
  const other = fixture();
  other.accounts = ctx.accounts;
  assert.equal((await store(other, { userDid: author.did, path: 'user-owner', log: author.jsonl })).status, 409);
  assert.equal(other.rows.didLogs.length, 0);

  // A new account's first log must be its own author DID: no unsigned, foreign-key or junk log can claim its path.
  const fresh = fixture(); delete fresh.rows.users[0].did;
  const stranger = await authorFixture.mintAuthor(await authorFixture.mockTurnkey(), { path: 'user-owner' });
  assert.equal((await store(fresh, { userDid: stranger.did, path: 'user-owner', log: stranger.jsonl })).status, 422);
  const unsigned = authorFixture.withProof(OWN_LOG, 0, []);
  assert.equal((await store(fresh, { userDid: OWN, path: 'user-owner', log: unsigned })).status, 422);
  assert.equal(fresh.rows.didLogs.length, 0);
});

// #300 review: a JWT holder's own keys never make an account's author DID, so
// the real owner can always re-genesise away from one.
test('re-mint onto an author DID with keys other than the sub-org\'s is refused, and such a DID never blocks recovery', async () => {
  const stranger = await authorFixture.mintAuthor(await authorFixture.mockTurnkey(), { path: 'user-owner' });
  const ctx = fixture();
  const refused = await modules.userHttp.remintUserDID._handler(ctx, post('/api/user/remintDid', { did: stranger.did, didLog: stranger.jsonl, path: 'user-owner' }));
  assert.equal(refused.status, 422);
  assert.match(await refused.text(), /not this account's author key|assertion key/);
  // Planted before the check existed: served, but not an author DID, so the owner can still move.
  ctx.rows.users[0].did = stranger.did;
  ctx.rows.didLogs.push({ _id: 'D1', userDid: stranger.did, path: 'user-owner', log: stranger.jsonl, author: false, updatedAt: 1 });
  const recovered = await modules.userHttp.remintUserDID._handler(ctx, post('/api/user/remintDid', { did: OWN, didLog: OWN_LOG, path: 'user-owner' }));
  assert.equal(recovered.status, 200, await recovered.clone().text());
  assert.equal(ctx.rows.users[0].did, OWN);
});

test('Turnkey being unreadable fails a DID write closed (503), storing nothing', async () => {
  const ctx = fixture(); delete ctx.rows.users[0].did;
  ctx.runAction = async ref => { if (getFunctionName(ref) === 'authInternal:listSubOrgEd25519Accounts') throw new Error('turnkey down'); throw new Error('unexpected'); };
  const response = await modules.didLogsHttp.storeDidLog._handler(ctx, post('/api/did/log', { userDid: OWN, path: 'user-owner', log: OWN_LOG }));
  assert.equal(response.status, 503);
  assert.equal(ctx.rows.didLogs.length, 0);
});

// #300 review round 2: the re-mint is paged so it fits Convex's limits, and a
// re-mint that lost a race stores nothing.
test('a paged re-mint moves every row across many pages, then the account and its log together', async () => {
  const ctx = fixture();
  const old = ctx.rows.users[0].did;
  for (let i = 0; i < 450; i += 1) ctx.rows.items.push({ _id: `IX${i}`, listId: 'L1', name: `n${i}`, checked: false, createdAt: 1, createdByDid: i % 3 ? old : VICTIM });
  const response = await modules.userHttp.remintUserDID._handler(ctx, post('/api/user/remintDid', { did: OWN, didLog: OWN_LOG, path: 'user-owner' }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(ctx.rows.items.filter(r => r.createdByDid === old).length, 0);
  assert.equal(ctx.rows.items.filter(r => r.createdByDid === OWN).length, 300);
  assert.equal(ctx.rows.items.filter(r => r.createdByDid === VICTIM).length, 150);
  assert.equal(ctx.rows.users[0].did, OWN);
  assert.equal(ctx.rows.users[0].pendingRemint, undefined);
  assert.equal(ctx.rows.didLogs.find(r => r.path === 'user-owner').userDid, OWN);
});

test('a re-mint that lost the race stores nothing, and two can\'t run at once', async () => {
  const ctx = fixture();
  const old = ctx.rows.users[0].did;
  const remint = 'migrations/remintUserDidDb';
  // Other keys: the same keys minting in the same second would give the very same DID.
  const other = await authorFixture.mintAuthor(await authorFixture.mockTurnkey(), { path: 'user-owner' });
  await call(remint, 'beginRemint', ctx, { userId: 'U1', oldDid: old, newDid: OWN });
  await assert.rejects(() => call(remint, 'beginRemint', ctx, { userId: 'U1', oldDid: old, newDid: other.did }), /Another device/);
  await call(remint, 'finishRemint', ctx, { userId: 'U1', oldDid: old, newDid: OWN, path: 'user-owner', log: OWN_LOG, scid: 's', versionId: 'v', author: true });
  // The loser: the account already moved, so it is told where, and nothing of its own is stored.
  assert.deepEqual(await call(remint, 'beginRemint', ctx, { userId: 'U1', oldDid: old, newDid: other.did }), { skipped: true, did: OWN });
  await assert.rejects(() => call(remint, 'finishRemint', ctx, { userId: 'U1', oldDid: old, newDid: other.did, path: 'user-owner', log: other.jsonl, scid: 's', versionId: 'v', author: true }), /no longer/);
  const response = await modules.userHttp.remintUserDID._handler(ctx, post('/api/user/remintDid', { did: other.did, didLog: other.jsonl, path: 'user-owner' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).newDid, OWN);
  assert.equal(ctx.rows.didLogs.find(r => r.path === 'user-owner').log, OWN_LOG, 'the winner\'s log is still the one served');
});

// #300 review round 3: a re-mint that died part-way left rows on its own new
// DID. The next claim resumes it, so nothing is stranded.
test('a stalled re-mint is resumed by the next one, which also moves the rows it had moved', async () => {
  const ctx = fixture();
  const old = ctx.rows.users[0].did;
  const remint = 'migrations/remintUserDidDb';
  const abandoned = (await authorFixture.mintAuthor(await authorFixture.mockTurnkey(), { path: 'user-owner' })).did;
  await call(remint, 'beginRemint', ctx, { userId: 'U1', oldDid: old, newDid: abandoned });
  // It moved the lists, then died.
  await call(remint, 'remintPage', ctx, { userId: 'U1', oldDid: old, newDid: abandoned, table: 'lists', cursor: null });
  assert.equal(ctx.rows.lists[0].ownerDid, abandoned);
  // Still live (heartbeat): another device can't take over yet.
  await assert.rejects(() => modules.userHttp.remintUserDID._handler(ctx, post('/api/user/remintDid', { did: OWN, didLog: OWN_LOG, path: 'user-owner' })).then(async r => { if (!r.ok) throw new Error(await r.text()); }), /Another device/);
  // Stalled past the claim: the next attempt (a fresh DID, as the client mints) takes over.
  ctx.rows.users[0].pendingRemint.startedAt -= 6 * 60 * 1000;
  const response = await modules.userHttp.remintUserDID._handler(ctx, post('/api/user/remintDid', { did: OWN, didLog: OWN_LOG, path: 'user-owner' }));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(ctx.rows.users[0].did, OWN);
  assert.equal(ctx.rows.lists[0].ownerDid, OWN, 'the abandoned re-mint\'s rows moved too');
  assert.equal(ctx.rows.lists.filter(l => l.ownerDid === abandoned).length, 0);
  assert.equal(ctx.rows.didLogs.find(r => r.path === 'user-owner').userDid, OWN);
});

test('finishRemint sweeps indexed rows written under the old DID after their table\'s pass', async () => {
  const ctx = fixture();
  const old = ctx.rows.users[0].did;
  const remint = 'migrations/remintUserDidDb';
  await call(remint, 'beginRemint', ctx, { userId: 'U1', oldDid: old, newDid: OWN });
  await call(remint, 'remintPage', ctx, { userId: 'U1', oldDid: old, newDid: OWN, table: 'lists', cursor: null });
  ctx.rows.lists.push({ _id: 'L-late', ownerDid: old, name: 'Made during the re-mint', createdAt: 2 });
  await call(remint, 'finishRemint', ctx, { userId: 'U1', oldDid: old, newDid: OWN, path: 'user-owner', log: OWN_LOG, scid: 's', versionId: 'v', author: true });
  assert.equal(ctx.rows.lists.find(l => l._id === 'L-late').ownerDid, OWN);
});

// #300 review round 4: deletion must reach rows a re-mint already moved.
test('deleting an account mid-re-mint erases the new DID too, and the re-mint stops', async () => {
  const ctx = fixture();
  const old = ctx.rows.users[0].did;
  const remint = 'migrations/remintUserDidDb';
  await call(remint, 'beginRemint', ctx, { userId: 'U1', oldDid: old, newDid: OWN });
  await call(remint, 'remintPage', ctx, { userId: 'U1', oldDid: old, newDid: OWN, table: 'lists', cursor: null });
  ctx.rows.users[0].deletionRequestedAt = Date.now();
  await assert.rejects(() => call(remint, 'remintPage', ctx, { userId: 'U1', oldDid: old, newDid: OWN, table: 'items', cursor: null }), /deletion/);
  await assert.rejects(() => call(remint, 'finishRemint', ctx, { userId: 'U1', oldDid: old, newDid: OWN, path: 'user-owner', log: OWN_LOG, scid: 's', versionId: 'v', author: true }), /deletion/);
  await call('users', 'continueUserDeletion', ctx, { userId: 'U1' });
  const dids = ctx.rows.users.find(u => u._id === 'U1')?.deletionDids;
  assert.ok(dids?.includes(OWN) && dids.includes(old), JSON.stringify(dids));
});

test('the one-shot applyRemint drops the author flag on the log row it moves', async () => {
  const ctx = fixture();
  const old = ctx.rows.users[0].did;
  ctx.rows.didLogs.push({ _id: 'D-old', userDid: old, path: 'user-owner', log: 'old log', author: true, scid: 's', versionId: 'v', updatedAt: 1 });
  await call('migrations/remintUserDidDb', 'applyRemint', ctx, { userId: 'U1', oldDid: old, newDid: OWN });
  const row = ctx.rows.didLogs.find(r => r._id === 'D-old');
  assert.deepEqual([row.userDid, row.author, row.scid, row.versionId], [OWN, false, undefined, undefined]);
});

test('the one-shot applyRemint refuses while a paged re-mint is pending', async () => {
  const ctx = fixture();
  const old = ctx.rows.users[0].did;
  await call('migrations/remintUserDidDb', 'beginRemint', ctx, { userId: 'U1', oldDid: old, newDid: OWN });
  await assert.rejects(() => call('migrations/remintUserDidDb', 'applyRemint', ctx, { userId: 'U1', oldDid: old, newDid: 'did:webvh:N2:boop.ad:user-owner' }), /paged re-mint is pending/);
  assert.equal(ctx.rows.users[0].did, old);
});

test('a final sweep that finds more stragglers than it takes makes the re-mint page again', async () => {
  const ctx = fixture();
  const old = ctx.rows.users[0].did;
  const remint = 'migrations/remintUserDidDb';
  const finish = () => call(remint, 'finishRemint', ctx, { userId: 'U1', oldDid: old, newDid: OWN, path: 'user-owner', log: OWN_LOG, scid: 's', versionId: 'v', author: true });
  await call(remint, 'beginRemint', ctx, { userId: 'U1', oldDid: old, newDid: OWN });
  await call(remint, 'remintPage', ctx, { userId: 'U1', oldDid: old, newDid: OWN, table: 'lists', cursor: null });
  for (let i = 0; i < 101; i += 1) ctx.rows.lists.push({ _id: `LL${i}`, ownerDid: old, name: `late ${i}`, createdAt: 3 });
  await assert.rejects(finish, /REMINT_SWEEP_INCOMPLETE/);
  assert.equal(ctx.rows.users[0].did, old, 'nothing moved the account');
  await call(remint, 'remintPage', ctx, { userId: 'U1', oldDid: old, newDid: OWN, table: 'lists', cursor: null });
  await finish();
  assert.equal(ctx.rows.lists.filter(l => l.ownerDid === old).length, 0);
  assert.equal(ctx.rows.users[0].did, OWN);
});

// #300 review round 11: a legacy did:key/did:temp account owns rows on that
// DID. It can't adopt a new one (rows would be orphaned); it re-mints.
test('a legacy did:key account can\'t adopt a new DID, and re-mints with its rows', async () => {
  for (const legacy of ['did:key:z6MkLegacy', 'did:temp:owner']) {
    const ctx = fixture();
    const old = ctx.rows.users[0].did;
    for (const t of ['lists', 'agentApiKeys']) for (const r of ctx.rows[t]) if (r.ownerDid === old) r.ownerDid = legacy;
    ctx.rows.users[0].did = legacy;
    const store = await modules.didLogsHttp.storeDidLog._handler(ctx, post('/api/did/log', { userDid: OWN, path: 'user-owner', log: OWN_LOG }));
    assert.equal(store.status, 409, legacy);
    ctx.rows.didLogs.push({ _id: 'Dx', userDid: OWN, path: 'user-owner', log: OWN_LOG, author: true, updatedAt: 1 });
    const adopt = await modules.userHttp.updateUserDID._handler(ctx, post('/api/user/updateDID', { did: OWN }));
    assert.equal(adopt.status, 409, legacy);
    ctx.rows.didLogs.pop();
    const remint = await modules.userHttp.remintUserDID._handler(ctx, post('/api/user/remintDid', { did: OWN, didLog: OWN_LOG, path: 'user-owner' }));
    assert.equal(remint.status, 200, await remint.clone().text());
    assert.equal(ctx.rows.users[0].did, OWN);
    assert.equal(ctx.rows.lists[0].ownerDid, OWN, `${legacy}: rows moved`);
    assert.equal(ctx.rows.agentApiKeys[0].ownerDid, OWN);
  }
});

test('a DID-less account can replace an author log no account holds, never one an account holds', async () => {
  const ctx = fixture(); delete ctx.rows.users[0].did;
  const orphan = await authorFixture.mintAuthor(ownTurnkey, { path: 'user-owner', domain: 'boop.ad' });
  ctx.rows.didLogs.push({ _id: 'D-orphan', userDid: 'did:webvh:ORPHAN:old.example:user-owner', path: 'user-owner', log: orphan.jsonl, author: true, updatedAt: 1 });
  const store = (body) => modules.didLogsHttp.storeDidLog._handler(ctx, post('/api/did/log', body));
  assert.equal((await store({ userDid: OWN, path: 'user-owner', log: OWN_LOG })).status, 200);
  assert.equal(ctx.rows.didLogs.find(r => r.path === 'user-owner').userDid, OWN);
  // Held by an account: refused.
  const held = fixture(); delete held.rows.users[0].did;
  held.rows.didLogs.push({ _id: 'D-held', userDid: VICTIM, path: 'user-owner', log: OWN_LOG, author: true, updatedAt: 1 });
  assert.equal((await modules.didLogsHttp.storeDidLog._handler(held, post('/api/did/log', { userDid: OWN, path: 'user-owner', log: OWN_LOG }))).status, 409);
});

test('DID log writes are compare-and-swap, and updateDID never reports a DID the account didn\'t take', async () => {
  const ctx = fixture();
  const row = { userDid: OWN, path: 'user-owner', log: OWN_LOG, scid: 's', versionId: 'v', author: true };
  await call('didLogs', 'upsertDidLog', ctx, { ...row, expected: null });
  await assert.rejects(() => call('didLogs', 'upsertDidLog', ctx, { ...row, expected: null }), /conflict/, 'a second first write loses');
  await assert.rejects(() => call('didLogs', 'upsertDidLog', ctx, { ...row, expected: { userDid: OWN, log: 'stale' } }), /conflict/);
  assert.equal(ctx.rows.didLogs.length, 1);

  // The account already holds a did:webvh: upsertUserInternal keeps it, so updateDID must not say yes.
  const kept = await modules.userHttp.updateUserDID._handler(ctx, post('/api/user/updateDID', { did: OWN }));
  assert.equal(kept.status, 409);
  assert.equal(ctx.rows.users[0].did, 'did:webvh:OLD:trypoo.app:user-owner');
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
  }
  await assert.rejects(() => call('lists', 'updateListCategory', ctx, { listId: 'L1', authToken: ownerToken, categoryId: 'missing' }), /Resource unavailable/);
  assert.equal(ctx.rows.lists.length, 2);
  // A category deleted on another device leaves a new list uncategorized rather than failing.
  await call('lists', 'createList', ctx, { assetDid: 'did:cel:y', name: 'New', createdAt: 2, authToken: ownerToken, categoryId: 'missing' });
  assert.equal(ctx.rows.lists.at(-1).categoryId, undefined);
  ctx.rows.lists.pop();
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
  // Comments record the key that wrote them; deletions leave an audit row for the key that removed them.
  const commentId = await call('comments', 'addComment', ctx, { apiKey: 'owner-agent-key', itemId: 'I1', text: 'from agent one' });
  assert.deepEqual(ctx.rows.comments[0].credential, { kind: 'apiKey', id: 'K1' });
  await call('comments', 'deleteComment', ctx, { apiKey: 'second-agent-key', commentId });
  assert.equal(ctx.rows.comments.length, 0);
  const deletion = ctx.rows.activities.at(-1);
  assert.deepEqual([deletion.type, deletion.credential], ['comment_deleted', { kind: 'apiKey', id: 'K2' }]);
  assert.deepEqual(JSON.parse(deletion.metadata.note), { commentId }, 'neither text nor author of the deleted comment is retained');
  // Credentials are stored for audit but never returned to readers, including published-list readers.
  await call('comments', 'addComment', ctx, { authToken: ownerToken, itemId: 'I1', text: 'visible' });
  for (const row of [...await call('activity', 'getListActivity', ctx, { authToken: editorToken, listId: 'L1' }), ...await call('comments', 'getItemComments', ctx, { authToken: editorToken, itemId: 'I1' })])
    assert.equal('credential' in row, false);
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

test('a logged-out token cannot be revived by re-encoding its signature', async () => {
  const ctx = fixture();
  ctx.rows.accessSessions = [];
  const fresh = await token('owner');
  await call('actorSession', 'establish', ctx, { authToken: fresh });
  assert.equal((await call('lists', 'getUserLists', ctx, { authToken: fresh })).length, 1);
  await call('actorSession', 'revoke', ctx, { authToken: fresh });
  // jose decodes the signature's unused trailing bits leniently; each variant is a
  // distinct string (and hash) carrying the same signature.
  const [head, body, sig] = fresh.split('.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = alphabet.indexOf(sig.at(-1));
  const variants = [1, 2, 3].map(bits => `${head}.${body}.${sig.slice(0, -1)}${alphabet[last ^ bits]}`);
  for (const variant of variants) {
    await assert.rejects(() => call('actorSession', 'establish', ctx, { authToken: variant }), /Invalid or expired token/);
    await assert.rejects(() => call('lists', 'getUserLists', ctx, { authToken: variant }), /Invalid or expired token/);
  }
  assert.equal(ctx.rows.accessSessions.filter(s => s.revokedAt === undefined).length, 0, 'no live session was created');
  await assert.rejects(() => call('lists', 'getUserLists', ctx, { authToken: fresh }), /restore your session/);
});
