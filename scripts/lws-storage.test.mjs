// LWS storage resources, phase 2 (docs/lws-agent-auth.md "Storage"): the HTTP
// adapter, the storage operations and the app's own item operations, run on an
// in-memory Convex. Access tokens and agents are seeded rows (phase 1's
// lws-agent-auth.test.mjs covers how they are issued). Transactions are not
// simulated: the in-memory database has no OCC retries, so what is tested
// here is that preconditions are evaluated against the state the write sees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { getFunctionName } from 'convex/server';

process.env.LWS_BASE_URL = 'https://lws.test';
process.env.JWT_SECRET = 'lws-storage-test-secret-not-a-deployed-credential';
console.info = () => {}; // withMutationObservability's metrics
const B = 'https://lws.test';
const U = 'user-sub-org';
const S = `${B}/lws/${U}`;
const DID = `did:webvh:QmScid:boop.test:${U}`;
const FRIEND = 'did:webvh:QmOther:boop.test:user-friend';

const outdir = 'tmp/lws-storage-test';
await mkdir(outdir, { recursive: true });
const entries = { http: 'convex/lwsStorageHttp.ts', storage: 'convex/lwsStorage.ts', lib: 'convex/lib/lwsStorage.ts' };
await build({
  entryPoints: entries, outdir, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  outExtension: { '.js': '.mjs' }, packages: 'external', logLevel: 'error',
});
const load = name => import(`${pathToFileURL(`${process.cwd()}/${outdir}/${name}.mjs`).href}`);
const [http, storage, lib] = await Promise.all(Object.keys(entries).map(load));
const hash = value => createHash('sha256').update(value).digest('hex');

// ---------------------------------------------------------------------------
// In-memory Convex. Ids are `${table}x…`, alphanumeric like real ones, so
// normalizeId can tell tables apart.
// ---------------------------------------------------------------------------

function convex(rows) {
  let next = 1;
  const all = () => Object.values(rows).flat();
  const effects = [];
  const db = {
    normalizeId: (table, id) => typeof id === 'string' && /^[A-Za-z0-9]+$/.test(id) && id.startsWith(`${table}x`) ? id : null,
    get: async id => all().find(row => row._id === id) ?? null,
    insert: async (table, value) => { const _id = `${table}x${next++}`; (rows[table] ??= []).push({ _id, _creationTime: Date.now(), ...value }); return _id; },
    patch: async (id, patch) => {
      const row = all().find(r => r._id === id); assert.ok(row, `missing ${id}`);
      for (const [key, value] of Object.entries(patch)) { if (value === undefined) delete row[key]; else row[key] = value; }
    },
    delete: async id => { for (const table of Object.values(rows)) { const at = table.findIndex(row => row._id === id); if (at >= 0) table.splice(at, 1); } },
    query: table => {
      const predicates = [];
      let index = null;
      let descending = false;
      // Index order for the indexes whose order a caller relies on; undefined sorts first, as in Convex.
      const ORDER = { by_list_updated: 'updatedAt' };
      const key = r => (r[ORDER[index]] === undefined ? -Infinity : r[ORDER[index]]);
      const q = {
        withIndex: (name, fn) => {
          index = name;
          const b = { eq: (k, v) => { predicates.push(r => r[k] === v); return b; } };
          fn?.(b); return q;
        },
        order: direction => { descending = direction === 'desc'; return q; },
        collect: async () => {
          const found = (rows[table] ?? []).filter(r => predicates.every(p => p(r)));
          if (ORDER[index]) found.sort((a, b) => key(a) - key(b) || a._creationTime - b._creationTime);
          return descending ? found.reverse() : found;
        },
        take: async n => (await q.collect()).slice(0, n),
        first: async () => (await q.collect())[0] ?? null,
        unique: async () => (await q.collect())[0] ?? null,
      };
      return q;
    },
  };
  const ctx = { rows, effects, db, scheduler: { runAfter: async (_ms, ref) => { effects.push(getFunctionName(ref)); }, runAt: async () => {} } };
  ctx.runQuery = ctx.runMutation = async (ref, args) => {
    const [module, fn] = getFunctionName(ref).split(':');
    assert.equal(module, 'lwsStorage', `unexpected ${module}:${fn}`);
    // Function arguments cross a serialization boundary in Convex.
    return storage[fn]._handler(ctx, JSON.parse(JSON.stringify(args)));
  };
  return ctx;
}

const TOKEN = 'lwsat_full-access';
const READ_TOKEN = 'lwsat_read-only';
const OTHER_TOKEN = 'lwsat_other-storage';
const DAY = 24 * 3600 * 1000;
const DUE = Date.UTC(2026, 10, 9, 9);

const ALL = ['read', 'create', 'update', 'delete'];
function world() {
  const token = (id, value, scopes, storageUri = S, actions = scopes.includes('items:write') ? ALL : ['read']) => ({ _id: id, tokenHash: hash(value), agentId: 'lwsAgentsx1', userId: 'usersx1', storage: storageUri, scopes, actions, expiresAt: Date.now() + 3600000 });
  return convex({
    users: [
      { _id: 'usersx1', did: DID, turnkeySubOrgId: 'owner', displayName: 'Owner', createdAt: 500 },
      { _id: 'usersx2', did: FRIEND, turnkeySubOrgId: 'friend', displayName: 'Friend', createdAt: 1 },
    ],
    didLogs: [{ _id: 'didLogsx1', userDid: DID, path: U, log: '', author: true, updatedAt: 700 }],
    lwsAgents: [{ _id: 'lwsAgentsx1', userId: 'usersx1', ownerDid: DID, fragment: 'agent-abcdefghij', vmId: `${DID}#agent-abcdefghij`, publicKeyMultibase: 'z6Mk', name: 'Bot', actions: ['read', 'create', 'update', 'delete'], scopes: ['lists:read', 'items:read', 'items:write'], requestId: 'r', createdAt: 1 }],
    lwsAccessTokens: [
      token('lwsAccessTokensx1', TOKEN, ['lists:read', 'items:read', 'items:write']),
      token('lwsAccessTokensx2', READ_TOKEN, ['lists:read', 'items:read']),
      token('lwsAccessTokensx3', OTHER_TOKEN, ['lists:read', 'items:read', 'items:write'], `${B}/lws/user-other`),
    ],
    lists: [
      { _id: 'listsxown', ownerDid: DID, name: 'Groceries', createdAt: 1000 },
      { _id: 'listsxnote', ownerDid: DID, name: 'A note', kind: 'note', createdAt: 1100 },
      { _id: 'listsxshared', ownerDid: FRIEND, name: "Friend's list", createdAt: 1200 },
    ],
    listGrants: [{ _id: 'listGrantsx1', listId: 'listsxshared', recipientId: 'usersx1', role: 'editor', acceptedAt: 1 }],
    items: [
      { _id: 'itemsxmilk', listId: 'listsxown', name: 'Milk', checked: false, createdByDid: DID, createdAt: 2000, updatedAt: 3000, order: 1, description: 'Oat', priority: 'high' },
      { _id: 'itemsxbread', listId: 'listsxown', name: 'Bread', checked: false, createdByDid: DID, createdAt: 2100, updatedAt: 2100, order: 2, dueDate: DUE, recurrence: { frequency: 'weekly' } },
      { _id: 'itemsxfriend', listId: 'listsxshared', name: 'Secret', checked: false, createdByDid: FRIEND, createdAt: 1, order: 1 },
    ],
    itemAssignees: [], activities: [], actionRecords: [], publications: [], bookmarks: [], rateLimits: [],
  });
}

const call = (ctx, path, { method = 'GET', token = TOKEN, headers = {}, body } = {}) => http.lwsStorage._handler(ctx, new Request(`https://deployment.convex.site/lws/${U}${path}`, {
  method,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
}));
const links = response => (response.headers.get('Link') ?? '').split(/,\s*(?=<)/);
const hasLink = (response, href, rel) => links(response).some(l => l.startsWith(`<${href}>`) && l.includes(`rel="${rel}"`));
const json = { 'Content-Type': 'application/json' };
const merge = { 'Content-Type': 'application/merge-patch+json' };
const jsonPatch = { 'Content-Type': 'application/json-patch+json' };
const MILK = `${S}/listsxown/itemsxmilk`;

// ---------------------------------------------------------------------------

test('the storage description is public', async () => {
  const ctx = world();
  const response = await call(ctx, '', { token: null });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/lws+cid');
  assert.ok(hasLink(response, S, 'https://www.w3.org/ns/lws#storage'));
  assert.ok(response.headers.get('ETag'));
  const description = await response.json();
  assert.deepEqual(description['@context'], ['https://www.w3.org/ns/cid/v1', 'https://www.w3.org/ns/lws/v1']);
  assert.equal(description.id, S);
  assert.equal(description.type, 'Storage');
  assert.deepEqual(description.service[0], { type: 'StorageRoot', serviceEndpoint: `${S}/` });
  assert.equal(description.service[1].type, 'AccessRequestService');
  assert.equal(description.service[1].serviceEndpoint, `${B}/lws-access/requests`);
  assert.equal(description.service[1].conformsTo, undefined, 'boop refuses the AccessProfile constraints, so it does not claim the profile');
  assert.ok(!description.capability, 'no MoveResource: the up link is not modifiable');
  ctx.rows.didLogs[0].author = false;
  assert.equal((await call(ctx, '', { token: null })).status, 404, 'not an author DID');
  assert.equal((await call(ctx, '', { method: 'POST', token: null, body: '{}' })).status, 405);
});

test('authentication: 401 with the challenge, audience and scope', async () => {
  const ctx = world();
  const none = await call(ctx, '/', { token: null });
  assert.equal(none.status, 401);
  assert.equal(none.headers.get('Content-Type'), 'application/problem+json');
  assert.equal(none.headers.get('WWW-Authenticate'), `Bearer resource_metadata="${B}/.well-known/oauth-protected-resource/lws/${U}/"`);
  assert.ok(hasLink(none, S, 'https://www.w3.org/ns/lws#storage'));
  // Only a presented Bearer credential earns error="invalid_token" (RFC 6750 3.1).
  const basic = await call(ctx, '/', { token: null, headers: { Authorization: 'Basic dXNlcjpwYXNz' } });
  assert.equal(basic.status, 401);
  assert.doesNotMatch(basic.headers.get('WWW-Authenticate'), /error=/);
  const lowercase = await call(ctx, '/', { token: null, headers: { Authorization: `bearer ${TOKEN}` } });
  assert.equal(lowercase.status, 200, 'the scheme is case-insensitive');
  for (const token of ['lwsat_forged', 'a.session.jwt']) {
    const bad = await call(ctx, '/listsxown/', { token });
    assert.equal(bad.status, 401, token);
    assert.match(bad.headers.get('WWW-Authenticate'), /resource_metadata="https:\/\/lws\.test\/\.well-known\/oauth-protected-resource\/lws\/user-sub-org\/listsxown\/", error="invalid_token"/);
  }
  // A token for another storage fails audience validation.
  const other = await call(ctx, '/listsxown/', { token: OTHER_TOKEN });
  assert.equal(other.status, 401);
  assert.match(other.headers.get('WWW-Authenticate'), /error="invalid_token"/);
  // A revoked agent's or an expired token is unknown.
  ctx.rows.lwsAccessTokens[0].expiresAt = Date.now() - 1;
  assert.equal((await call(ctx, '/')).status, 401);
  ctx.rows.lwsAccessTokens[0].expiresAt = Date.now() + 3600000;
  ctx.rows.lwsAgents[0].revokedAt = Date.now();
  assert.equal((await call(ctx, '/')).status, 401);
  delete ctx.rows.lwsAgents[0].revokedAt;
  // Scope: read-only may read, not write.
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { token: READ_TOKEN })).status, 200);
  const write = await call(ctx, '/listsxown/', { method: 'POST', token: READ_TOKEN, headers: json, body: { name: 'Eggs' } });
  assert.equal(write.status, 403);
  assert.match(write.headers.get('WWW-Authenticate'), /error="insufficient_scope"/);
  assert.equal(ctx.rows.items.length, 3);
  // OPTIONS needs no token and says what is allowed.
  const options = await call(ctx, '/listsxown/itemsxmilk', { method: 'OPTIONS', token: null, headers: { Origin: 'https://agent.example' } });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get('Allow'), 'GET, HEAD, PUT, PATCH, DELETE, OPTIONS');
  assert.match(options.headers.get('Access-Control-Allow-Methods'), /PATCH/);
  assert.match(options.headers.get('Access-Control-Expose-Headers'), /ETag.*Link.*Location.*WWW-Authenticate/);
});

test("the root container lists the user's own lists, not notes or shared lists", async () => {
  const ctx = world();
  const response = await call(ctx, '/');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/lws+json');
  assert.ok(hasLink(response, `${S}/.meta`, 'linkset'));
  assert.ok(hasLink(response, 'https://www.w3.org/ns/lws#Container', 'type'));
  assert.ok(hasLink(response, S, 'https://www.w3.org/ns/lws#storage'));
  assert.ok(!links(response).some(l => l.includes('rel="up"')), 'the root has no parent');
  const root = await response.json();
  assert.deepEqual(root, {
    '@context': 'https://www.w3.org/ns/lws/v1', id: `${S}/`, type: 'Container', totalItems: 1,
    items: [{ type: 'Container', id: `${S}/listsxown/`, format: 'application/lws+json', title: 'Groceries', modified: new Date(3000).toISOString() }],
  });
  const etag = response.headers.get('ETag');
  assert.match(etag, /^"[0-9a-f]{32}"$/);
  assert.equal((await call(ctx, '/', { headers: { 'If-None-Match': etag } })).status, 304);
  // A deletion changes the ETag even though no time records it.
  ctx.rows.items.splice(0, 1);
  assert.notEqual((await call(ctx, '/')).headers.get('ETag'), etag);
  const post = await call(ctx, '/', { method: 'POST', headers: json, body: { name: 'New list' } });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET, HEAD, OPTIONS');
});

test("the root includes lists under the user's legacy DID, and reads one item per list", async () => {
  const ctx = world();
  const LEGACY = 'did:webvh:QmOld:trypoo.app:user-sub-org';
  ctx.rows.users[0].legacyDid = LEGACY;
  ctx.rows.lists.push({ _id: 'listsxlegacy', ownerDid: LEGACY, name: 'From before', createdAt: 900 });
  ctx.rows.lists.push({ _id: 'listsxempty', ownerDid: DID, name: 'Empty', createdAt: 1300 });
  ctx.rows.items.push({ _id: 'itemsxold', listId: 'listsxlegacy', name: 'Old', checked: false, createdByDid: LEGACY, createdAt: 950, updatedAt: 4000 });
  ctx.rows.items.push({ _id: 'itemsxolder', listId: 'listsxlegacy', name: 'Older', checked: false, createdByDid: LEGACY, createdAt: 920 });
  const reads = [];
  const query = ctx.db.query;
  ctx.db.query = table => { const q = query(table); const withIndex = q.withIndex; q.withIndex = (name, fn) => { reads.push(`${table}.${name}`); return withIndex(name, fn); }; return q; };
  const root = await (await call(ctx, '/')).json();
  assert.deepEqual(root.items.map(m => [m.title, m.modified]), [
    ['From before', new Date(4000).toISOString()],
    ['Groceries', new Date(3000).toISOString()],
    ['Empty', new Date(1300).toISOString()],
  ], 'modified is the latest item, else the list');
  assert.ok(root.items.every(m => !('size' in m)));
  assert.ok(!reads.includes('items.by_list'), 'no list has its items scanned');
  assert.equal(reads.filter(r => r === 'items.by_list_updated').length, 3);
  // The legacy list is the agent's to read, too.
  assert.equal((await call(ctx, '/listsxlegacy/')).status, 200);
});

test('a list longer than a page is paginated by Link headers', async () => {
  const ctx = world();
  const size = lib.LIST_PAGE_SIZE;
  for (let i = 0; i < size * 2 + 3; i++) {
    ctx.rows.items.push({ _id: `itemsxp${i}`, listId: 'listsxown', name: `Item ${i}`, checked: false, createdByDid: DID, createdAt: 5000 + i, order: 10 + i });
  }
  const total = size * 2 + 5;
  const pageLinks = response => Object.fromEntries(links(response).map(l => /<([^>]*)>;\s*rel="(first|last|prev|next)"/.exec(l)).filter(Boolean).map(m => [m[2], m[1]]));
  const first = await call(ctx, '/listsxown/');
  assert.equal(first.status, 200);
  const one = await first.json();
  assert.equal(one.totalItems, total, 'the whole membership');
  assert.equal(one.items.length, size);
  assert.deepEqual(one.items.slice(0, 2).map(i => i.id), [MILK, `${S}/listsxown/itemsxbread`], 'list order across pages');
  assert.deepEqual(pageLinks(first), { first: `${S}/listsxown/`, last: `${S}/listsxown/?page=3`, next: `${S}/listsxown/?page=2` });
  assert.ok(hasLink(first, `${S}/`, 'up') && hasLink(first, `${S}/listsxown/.meta`, 'linkset'), 'the container links too');
  const second = await http.lwsStorage._handler(ctx, new Request(pageLinks(first).next.replace(B, 'https://deployment.convex.site'), { headers: { Authorization: `Bearer ${TOKEN}` } }));
  assert.equal(second.status, 200);
  assert.deepEqual(pageLinks(second), { first: `${S}/listsxown/`, last: `${S}/listsxown/?page=3`, prev: `${S}/listsxown/`, next: `${S}/listsxown/?page=3` });
  const two = await second.json();
  assert.equal(two.id, `${S}/listsxown/`);
  assert.equal(two.totalItems, total);
  assert.equal(two.items.length, size);
  assert.notEqual(second.headers.get('ETag'), first.headers.get('ETag'));
  const last = await call(ctx, '/listsxown/?page=3');
  assert.deepEqual(pageLinks(last), { first: `${S}/listsxown/`, last: `${S}/listsxown/?page=3`, prev: `${S}/listsxown/?page=2` });
  assert.equal((await last.json()).items.length, 5);
  const seen = new Set([...one.items, ...two.items].map(i => i.id));
  assert.equal(seen.size, size * 2, 'no member twice');
  for (const page of ['4', '0', 'x', '-1']) {
    const missing = await call(ctx, `/listsxown/?page=${page}`);
    assert.equal(missing.status, 404, page);
    assert.ok(hasLink(missing, S, 'https://www.w3.org/ns/lws#storage'), page);
  }
  // A list that fits on one page has no pagination links.
  ctx.rows.items = ctx.rows.items.filter(i => !i._id.startsWith('itemsxp'));
  assert.deepEqual(pageLinks(await call(ctx, '/listsxown/')), {});
});

test('a list container: its items as JSON data resources', async () => {
  const ctx = world();
  const response = await call(ctx, '/listsxown/');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/lws+json');
  assert.equal(response.headers.get('Accept-Post'), 'application/json');
  assert.ok(hasLink(response, `${S}/`, 'up'));
  assert.ok(hasLink(response, `${S}/listsxown/.meta`, 'linkset'));
  assert.ok(response.headers.get('Last-Modified'));
  const list = await response.json();
  assert.equal(list.id, `${S}/listsxown/`);
  assert.equal(list.type, 'Container');
  assert.equal(list.title, 'Groceries');
  assert.equal(list.totalItems, 2);
  assert.deepEqual(list.items.map(i => i.id), [MILK, `${S}/listsxown/itemsxbread`], 'in list order');
  const milk = await (await call(ctx, '/listsxown/itemsxmilk')).text();
  assert.deepEqual(list.items[0], { type: 'DataResource', id: MILK, format: 'application/json', size: Buffer.byteLength(milk), modified: new Date(3000).toISOString() });
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const refused = await call(ctx, '/listsxown/', { method, headers: json, body: '{}' });
    assert.equal(refused.status, 405, method);
    assert.equal(refused.headers.get('Allow'), 'GET, HEAD, POST, OPTIONS');
  }
});

test('an item: representation and headers, HEAD, ranges and conditional GET', async () => {
  const ctx = world();
  const response = await call(ctx, '/listsxown/itemsxmilk');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/json');
  const etag = response.headers.get('ETag');
  assert.match(etag, /^"[0-9a-f]{32}"$/);
  assert.equal(response.headers.get('Last-Modified'), new Date(3000).toUTCString());
  assert.ok(hasLink(response, `${MILK}.meta`, 'linkset'));
  assert.ok(links(response).some(l => l.includes('type="application/linkset+json"')));
  assert.ok(hasLink(response, `${S}/listsxown/`, 'up'));
  assert.ok(hasLink(response, 'https://www.w3.org/ns/lws#DataResource', 'type'));
  assert.ok(hasLink(response, S, 'https://www.w3.org/ns/lws#storage'));
  assert.equal(response.headers.get('Accept-Patch'), 'application/merge-patch+json, application/json-patch+json');
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), {
    id: MILK, name: 'Milk', checked: false, checkedAt: null, description: 'Oat', dueDate: null, url: null, priority: 'high',
    recurrence: null, parent: null, createdAt: new Date(2000).toISOString(), updatedAt: new Date(3000).toISOString(),
  });
  const bread = await (await call(ctx, '/listsxown/itemsxbread')).json();
  assert.deepEqual(bread.recurrence, { frequency: 'weekly' });
  assert.equal(bread.dueDate, new Date(DUE).toISOString());

  const head = await call(ctx, '/listsxown/itemsxmilk', { method: 'HEAD' });
  assert.equal(head.status, 200);
  const rangedHead = await call(ctx, '/listsxown/itemsxmilk', { method: 'HEAD', headers: { Range: 'bytes=0-9' } });
  assert.equal(rangedHead.status, 200, 'Range applies to GET only');
  assert.equal(rangedHead.headers.get('Content-Range'), null);
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'HEAD', headers: { Range: 'bytes=99999-' } })).status, 200);
  assert.equal(head.headers.get('ETag'), etag);
  assert.equal(head.headers.get('Link'), response.headers.get('Link'));
  assert.equal(await head.text(), '');

  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { headers: { 'If-None-Match': `W/${etag}, "other"` } })).status, 304, 'weak comparison');
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { headers: { 'If-Modified-Since': new Date(3000).toUTCString() } })).status, 304);
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { headers: { 'If-Modified-Since': new Date(2000).toUTCString() } })).status, 200);
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { headers: { 'If-Match': '"stale"' } })).status, 412);

  const partial = await call(ctx, '/listsxown/itemsxmilk', { headers: { Range: 'bytes=0-9' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('Content-Range'), `bytes 0-9/${Buffer.byteLength(text)}`);
  assert.equal(await partial.text(), text.slice(0, 10));
  assert.equal(await (await call(ctx, '/listsxown/itemsxmilk', { headers: { Range: 'bytes=-5' } })).text(), text.slice(-5));
  const unsatisfiable = await call(ctx, '/listsxown/itemsxmilk', { headers: { Range: 'bytes=99999-' } });
  assert.equal(unsatisfiable.status, 416);
  assert.match(unsatisfiable.headers.get('Cache-Control'), /no-transform/, 'it carries an ETag');
  const failed = await call(ctx, '/listsxown/itemsxmilk', { headers: { 'If-Match': '"stale"' } });
  assert.ok(failed.headers.get('ETag'));
  assert.match(failed.headers.get('Cache-Control'), /no-transform/, 'a 412 with an ETag too');
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { headers: { Range: 'bytes=0-1,4-5' } })).status, 200, 'several ranges: the whole');
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { headers: { Range: 'bytes=0-9', 'If-Range': '"stale"' } })).status, 200);
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { headers: { Range: 'bytes=0-9', 'If-Range': etag } })).status, 206);
});

test('POST creates an item: 201, Location, links, attribution', async () => {
  const ctx = world();
  const before = ctx.rows.items.length;
  const response = await call(ctx, '/listsxown/', { method: 'POST', headers: { ...json, Slug: 'eggs' }, body: { name: 'Eggs', dueDate: '2026-11-20', priority: 'low', description: 'x'.repeat(3000) } });
  assert.equal(response.status, 201, await response.clone().text());
  const location = response.headers.get('Location');
  assert.match(location, new RegExp(`^${S}/listsxown/itemsx\\d+$`));
  assert.equal(response.headers.get('Content-Location'), location);
  assert.ok(hasLink(response, `${location}.meta`, 'linkset'));
  assert.ok(hasLink(response, `${S}/listsxown/`, 'up'));
  assert.ok(hasLink(response, 'https://www.w3.org/ns/lws#DataResource', 'type'));
  const created = await response.json();
  assert.equal(created.id, location);
  assert.equal(created.name, 'Eggs');
  assert.equal(created.dueDate, '2026-11-20T00:00:00.000Z');
  assert.equal(created.description.length, 3000, "longer than addItem's cap, written in the same transaction");
  assert.equal(ctx.rows.items.length, before + 1);
  const row = ctx.rows.items.at(-1);
  assert.equal(row.createdByDid, DID, 'the user, as the item creator');
  // The action record names the agent credential, unsigned.
  const record = ctx.rows.actionRecords.find(r => r.itemId === row._id);
  assert.equal(record.status, 'unsigned');
  assert.deepEqual(JSON.parse(record.attested).credential, { kind: 'agent', id: 'lwsAgentsx1' });
  assert.ok(ctx.effects.includes('notificationActions:sendListNotificationInternal'), 'notifies like the app does');
  assert.ok(ctx.rows.lwsAgents[0].lastUsedAt > Date.now() - 5000);
  // The new item reads back with the same ETag.
  const read = await http.lwsStorage._handler(ctx, new Request(location.replace(B, 'https://deployment.convex.site'), { headers: { Authorization: `Bearer ${TOKEN}` } }));
  assert.equal(read.headers.get('ETag'), response.headers.get('ETag'));

  // A sub-item names its parent.
  const child = await call(ctx, '/listsxown/', { method: 'POST', headers: json, body: { name: 'Free range', parent: location, checked: true } });
  assert.equal(child.status, 201);
  const childDoc = await child.json();
  assert.equal(childDoc.parent, location);
  assert.equal(childDoc.checked, true);
  const tooDeep = await call(ctx, '/listsxown/', { method: 'POST', headers: json, body: { name: 'x', parent: childDoc.id } });
  assert.equal(tooDeep.status, 409);

  const refused = async (init, status, what) => {
    const count = ctx.rows.items.length;
    const r = await call(ctx, '/listsxown/', { method: 'POST', ...init });
    assert.equal(r.status, status, `${what}: ${await r.clone().text()}`);
    assert.equal(r.headers.get('Content-Type'), 'application/problem+json', what);
    const problem = await r.json();
    assert.equal(problem.status, status);
    assert.doesNotMatch(JSON.stringify(problem), /at |\.ts|Error/, `${what}: no stack or internals`);
    assert.equal(ctx.rows.items.length, count, `${what}: nothing written`);
  };
  await refused({ headers: json, body: { name: 'x', id: `${S}/listsxown/mine` } }, 400, 'a read-only member');
  await refused({ headers: json, body: { name: 'x', colour: 'red' } }, 400, 'an unknown member');
  await refused({ headers: json, body: { name: '' } }, 400, 'no name');
  await refused({ headers: json, body: { name: 'x'.repeat(501) } }, 400, 'a long name');
  await refused({ headers: json, body: { name: 'x', dueDate: 'tomorrow' } }, 400, 'a bad date');
  await refused({ headers: json, body: { name: 'x', priority: 'urgent' } }, 400, 'a bad priority');
  await refused({ headers: json, body: { name: 'x', recurrence: { frequency: 'hourly' } } }, 400, 'a bad recurrence');
  await refused({ headers: json, body: '{"name":' }, 400, 'not JSON');
  await refused({ headers: json, body: { name: 'x', parent: `${S}/listsxshared/itemsxfriend` } }, 409, "another list's item as parent");
  await refused({ headers: { 'Content-Type': 'text/plain' }, body: 'Eggs' }, 415, 'not JSON media');
  await refused({ headers: { ...json, Link: '<https://www.w3.org/ns/lws#Container>; rel="type"' }, body: '{}' }, 409, 'a container');
  await refused({ headers: { ...json, 'If-Match': '"stale"' }, body: { name: 'x' } }, 412, 'a stale container ETag');
  await refused({ headers: json, body: { name: 'x' }, token: null }, 401, 'no token');
  // Not into a note or a shared list.
  for (const list of ['listsxnote', 'listsxshared']) {
    const r = await call(ctx, `/${list}/`, { method: 'POST', headers: json, body: { name: 'x' } });
    assert.equal(r.status, 404, list);
  }
  // The container's current ETag is a precondition that holds.
  const etag = (await call(ctx, '/listsxown/')).headers.get('ETag');
  assert.equal((await call(ctx, '/listsxown/', { method: 'POST', headers: { ...json, 'If-Match': etag }, body: { name: 'Jam' } })).status, 201);
});

// Found on dev (phase 4): Cloudflare in front of convex.site gzips
// application/json and weakens its strong ETag to W/"…", which If-Match never
// matches, so every PATCH after a GET was a 412. no-transform prevents that.
test('representations with a strong ETag say no-transform, so the edge keeps the ETag strong', async () => {
  const ctx = world();
  const cases = [
    ['', { token: null }], ['/', {}], ['/listsxown/', {}], ['/listsxown/itemsxmilk', {}], ['/listsxown/itemsxmilk', { method: 'HEAD' }],
    ['/listsxown/itemsxmilk.meta', {}],
    ['/listsxown/itemsxmilk', { method: 'PATCH', headers: merge, body: { name: 'Oat milk' } }],
    ['/listsxown/', { method: 'POST', headers: json, body: { name: 'Eggs' } }],
  ];
  for (const [path, options] of cases) {
    const response = await call(ctx, path, options);
    assert.ok(response.status < 300, `${options.method ?? 'GET'} ${path}: ${response.status}`);
    assert.match(response.headers.get('ETag'), /^"[0-9a-f]{32}"$/);
    assert.match(response.headers.get('Cache-Control'), /(^|,\s*)no-transform(,|$)/, `${options.method ?? 'GET'} ${path}`);
  }
});

test('PATCH and PUT: If-Match, 412, unconditional writes, and read-only members', async () => {
  const ctx = world();
  const etag = (await call(ctx, '/listsxown/itemsxmilk')).headers.get('ETag');
  const ok = await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', headers: { ...merge, 'If-Match': etag }, body: { name: 'Whole milk', priority: null } });
  assert.equal(ok.status, 200, await ok.clone().text());
  const patched = await ok.json();
  assert.equal(patched.name, 'Whole milk');
  assert.equal(patched.priority, null);
  assert.equal(patched.description, 'Oat', 'untouched');
  const next = ok.headers.get('ETag');
  assert.notEqual(next, etag);
  assert.equal(ctx.rows.items[0].priority, undefined);

  // The old ETag is stale now: 412, nothing changes.
  const stale = await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', headers: { ...merge, 'If-Match': etag }, body: { name: 'Lost update' } });
  assert.equal(stale.status, 412);
  assert.equal(ctx.rows.items[0].name, 'Whole milk');
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'PUT', headers: { ...json, 'If-Match': etag }, body: { name: 'Lost' } })).status, 412);
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'DELETE', headers: { 'If-Match': etag } })).status, 412);
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', headers: { ...merge, 'If-None-Match': '*' }, body: { name: 'x' } })).status, 412);
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', headers: { ...merge, 'If-Unmodified-Since': new Date(0).toUTCString() }, body: { name: 'x' } })).status, 412);
  assert.equal(ctx.rows.items[0].name, 'Whole milk');

  // update-resource.md: clients SHOULD send If-Match; an unconditional write is accepted.
  const unconditional = await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', headers: merge, body: { url: 'https://shop.example/milk' } });
  assert.equal(unconditional.status, 200);
  assert.equal(ctx.rows.items[0].url, 'https://shop.example/milk');

  // JSON Patch, which LWS requires.
  const current = (await call(ctx, '/listsxown/itemsxmilk')).headers.get('ETag');
  const jp = await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', headers: { ...jsonPatch, 'If-Match': current }, body: [
    { op: 'test', path: '/name', value: 'Whole milk' }, { op: 'replace', path: '/name', value: 'Skimmed' }, { op: 'add', path: '/dueDate', value: '2026-12-01T10:00:00Z' },
  ] });
  assert.equal(jp.status, 200, await jp.clone().text());
  assert.equal((await jp.json()).name, 'Skimmed');
  assert.equal(ctx.rows.items[0].dueDate, Date.UTC(2026, 11, 1, 10));
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', headers: jsonPatch, body: [{ op: 'test', path: '/name', value: 'Nope' }, { op: 'replace', path: '/name', value: 'x' }] })).status, 409, 'a failed test');
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', headers: jsonPatch, body: { op: 'replace' } })).status, 400, 'not a patch');
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', headers: jsonPatch, body: [{ op: 'remove', path: '/nothing' }] })).status, 409);
  assert.equal(ctx.rows.items[0].name, 'Skimmed');

  // Read-only and fixed members.
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', headers: merge, body: { createdAt: '2020-01-01T00:00:00.000Z' } })).status, 409);
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', headers: merge, body: { parent: `${S}/listsxown/itemsxbread` } })).status, 409);
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', headers: merge, body: { tags: ['x'] } })).status, 400);
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', headers: json, body: { name: 'x' } })).status, 415, 'PATCH needs a patch format');
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'PUT', headers: merge, body: { name: 'x' } })).status, 415);

  // PUT replaces: what it leaves out is cleared; read-only members may be echoed back unchanged.
  const doc = await (await call(ctx, '/listsxown/itemsxmilk')).json();
  const put = await call(ctx, '/listsxown/itemsxmilk', { method: 'PUT', headers: json, body: { id: doc.id, createdAt: doc.createdAt, updatedAt: doc.updatedAt, name: 'Milk' } });
  assert.equal(put.status, 200, await put.clone().text());
  const replaced = await put.json();
  assert.equal(replaced.description, null);
  assert.equal(replaced.url, null);
  assert.equal(replaced.dueDate, null);
  // A write that changes nothing writes nothing.
  const updatedAt = ctx.rows.items[0].updatedAt;
  const same = await call(ctx, '/listsxown/itemsxmilk', { method: 'PUT', headers: json, body: { name: 'Milk' } });
  assert.equal(same.status, 200);
  assert.equal(ctx.rows.items[0].updatedAt, updatedAt);
  assert.equal(same.headers.get('ETag'), put.headers.get('ETag'));
});

test('checking through PATCH runs the app’s check: recurrence, action records', async () => {
  const ctx = world();
  const count = ctx.rows.items.length;
  const checked = await call(ctx, '/listsxown/itemsxbread', { method: 'PATCH', headers: merge, body: { checked: true } });
  assert.equal(checked.status, 200, await checked.clone().text());
  const doc = await checked.json();
  assert.equal(doc.checked, true);
  assert.ok(doc.checkedAt);
  const bread = ctx.rows.items.find(i => i._id === 'itemsxbread');
  assert.equal(bread.checkedByDid, DID);
  // The next occurrence, a week on, as checkItem makes it.
  assert.equal(ctx.rows.items.length, count + 1);
  const copy = ctx.rows.items.at(-1);
  assert.equal(copy.name, 'Bread');
  assert.equal(copy.checked, false);
  assert.equal(copy.dueDate, DUE + 7 * DAY);
  assert.deepEqual(copy.recurrence, { frequency: 'weekly' });
  const records = ctx.rows.actionRecords.map(r => ({ change: JSON.parse(r.payload), attested: JSON.parse(r.attested) }));
  assert.ok(records.some(r => r.change.action === 'item.completed' && r.change.subject.itemId === 'itemsxbread'), JSON.stringify(records.map(r => r.change.action)));
  assert.ok(records.some(r => r.change.action === 'item.created' && r.attested.itemId === copy._id));
  assert.ok(records.every(r => r.attested.credential.kind === 'agent' && r.attested.credential.id === 'lwsAgentsx1'));
  // The new occurrence is a member of the list container.
  assert.ok((await (await call(ctx, '/listsxown/')).json()).items.some(i => i.id === `${S}/listsxown/${copy._id}`));
  // Unchecking is the app's uncheck.
  const unchecked = await call(ctx, '/listsxown/itemsxbread', { method: 'PATCH', headers: jsonPatch, body: [{ op: 'replace', path: '/checked', value: false }] });
  assert.equal(unchecked.status, 200);
  assert.equal(bread.checked, false);
  assert.equal(bread.checkedByDid, undefined);
  assert.ok(ctx.rows.actionRecords.some(r => JSON.parse(r.payload).action === 'item.reopened'));
  assert.equal(ctx.rows.items.length, count + 1, 'unchecking makes no copy');
});

test('DELETE: 204, gone from the container, sub-items first', async () => {
  const ctx = world();
  const etag = (await call(ctx, '/listsxown/itemsxmilk')).headers.get('ETag');
  ctx.rows.items.push({ _id: 'itemsxchild', listId: 'listsxown', parentId: 'itemsxmilk', name: 'Child', checked: false, createdByDid: DID, createdAt: 1 });
  const blocked = await call(ctx, '/listsxown/itemsxmilk', { method: 'DELETE', headers: { 'If-Match': etag } });
  assert.equal(blocked.status, 409);
  assert.equal((await call(ctx, '/listsxown/itemsxchild', { method: 'DELETE' })).status, 204);
  const deleted = await call(ctx, '/listsxown/itemsxmilk', { method: 'DELETE', headers: { 'If-Match': etag } });
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), '');
  assert.ok(!ctx.rows.items.some(i => i._id === 'itemsxmilk'));
  assert.equal((await call(ctx, '/listsxown/itemsxmilk')).status, 404);
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'DELETE' })).status, 404);
  assert.ok(!(await (await call(ctx, '/listsxown/')).json()).items.some(i => i.id === MILK));
  assert.equal((await call(ctx, '/listsxown/itemsxbread', { method: 'DELETE', token: READ_TOKEN })).status, 403);
});

test("an agent can't reach lists shared with the user; unknown paths and bad ids are 404", async () => {
  const ctx = world();
  for (const path of ['/listsxshared/', '/listsxshared/itemsxfriend', '/listsxshared/.meta', '/listsxown/itemsxfriend', '/listsxnote/']) {
    const response = await call(ctx, path);
    assert.equal(response.status, 404, path);
    assert.doesNotMatch(await response.text(), /Secret|Friend/, path);
  }
  assert.equal((await call(ctx, '/listsxshared/itemsxfriend', { method: 'PATCH', headers: merge, body: { name: 'mine now' } })).status, 404);
  assert.equal((await call(ctx, '/listsxshared/itemsxfriend', { method: 'DELETE' })).status, 404);
  assert.equal(ctx.rows.items.find(i => i._id === 'itemsxfriend').name, 'Secret');
  for (const path of ['/itemsxmilk/', '/listsxown/listsxown', '/listsxown/itemsxnope', '/nonsense/', '/listsxown/itemsxmilk/', '/a/b/c', '/listsx%20own/', '/listsxown//itemsxmilk', '/listsxown/itemsxmilk.meta/', '/listsxown/.meta.meta']) {
    const response = await call(ctx, path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('Content-Type'), 'application/problem+json', path);
    assert.ok(hasLink(response, S, 'https://www.w3.org/ns/lws#storage'), `${path}: a 404 under a storage names it`);
  }
  // A path outside any storage.
  const outside = await http.lwsStorage._handler(ctx, new Request(`${B}/lws/not-a-user/`, { headers: { Authorization: `Bearer ${TOKEN}` } }));
  assert.equal(outside.status, 404);
  // Another user's storage: the token is not for it.
  const elsewhere = await http.lwsStorage._handler(ctx, new Request(`${B}/lws/user-friend/`, { headers: { Authorization: `Bearer ${TOKEN}` } }));
  assert.equal(elsewhere.status, 401);
});

test('linksets: read-only server-managed links', async () => {
  const ctx = world();
  const response = await call(ctx, '/listsxown/itemsxmilk.meta');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/linkset+json');
  assert.equal(response.headers.get('Allow'), 'GET, HEAD, PATCH, OPTIONS');
  assert.equal(response.headers.get('Accept-Patch'), 'application/json-patch+json');
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.equal((await call(ctx, '/listsxown/itemsxmilk.meta', { headers: { Range: 'bytes=0-0' } })).status, 206);
  assert.equal((await call(ctx, '/listsxown/', { headers: { Range: 'bytes=0-0' } })).status, 200, 'a container listing is never partial');
  assert.ok(response.headers.get('ETag'));
  assert.deepEqual(links(response), [`<${S}>; rel="https://www.w3.org/ns/lws#storage"`], 'no linkset, up or type links pointing at itself');
  assert.deepEqual(await response.json(), { linkset: [{
    anchor: MILK, up: [{ href: `${S}/listsxown/` }], type: [{ href: 'https://www.w3.org/ns/lws#DataResource' }], 'https://www.w3.org/ns/lws#storage': [{ href: S }],
  }] });
  const root = await (await call(ctx, '/.meta')).json();
  assert.equal(root.linkset[0].anchor, `${S}/`);
  assert.ok(!root.linkset[0].up);
  assert.equal((await call(ctx, '/listsxown/.meta')).status, 200);
  assert.equal((await call(ctx, '/listsxown/itemsxmilk.meta', { method: 'PUT', headers: { 'Content-Type': 'application/linkset+json' }, body: '{}' })).status, 405);
  const noop = await call(ctx, '/listsxown/itemsxmilk.meta', { method: 'PATCH', headers: jsonPatch, body: [{ op: 'test', path: '/linkset/0/anchor', value: MILK }] });
  assert.equal(noop.status, 204);
  const move = await call(ctx, '/listsxown/itemsxmilk.meta', { method: 'PATCH', headers: jsonPatch, body: [{ op: 'replace', path: '/linkset/0/up/0/href', value: `${S}/listsxnote/` }] });
  assert.equal(move.status, 409, 'no moves: up is server-managed');
  assert.equal((await call(ctx, '/listsxown/itemsxmilk.meta', { method: 'PATCH', headers: merge, body: {} })).status, 415);
  assert.equal((await call(ctx, '/listsxown/itemsxmilk.meta', { method: 'PATCH', headers: { ...jsonPatch, 'If-Match': '"stale"' }, body: [] })).status, 412);
  assert.equal((await call(ctx, '/listsxown/itemsxmilk.meta', { method: 'PATCH', token: READ_TOKEN, headers: jsonPatch, body: [] })).status, 403);
  assert.equal((await call(ctx, '/listsxshared/itemsxfriend.meta')).status, 404);
});

/** world(), plus a token for an agent that holds only `actions`. */
function withActions(ctx, actions, value = `lwsat_${actions.join('-')}`) {
  const scopes = [...new Set(actions.flatMap(a => a === 'read' ? ['lists:read', 'items:read'] : ['items:write']))];
  ctx.rows.lwsAgents.push({ ...ctx.rows.lwsAgents[0], _id: `lwsAgentsx${actions.join('')}`, actions, scopes, fragment: 'agent-bbbbbbbbbb' });
  ctx.rows.lwsAccessTokens.push({ _id: `lwsAccessTokensx${actions.join('')}`, tokenHash: hash(value), agentId: `lwsAgentsx${actions.join('')}`, userId: 'usersx1', storage: S, scopes, actions: actions.map(a => a === 'modify' ? 'update' : a), expiresAt: Date.now() + 3600000 });
  return value;
}

test('each operation checks its own action: read, create, update, delete', async () => {
  const ctx = world();
  // An agent approved for [read, create] has items:write, but may not update or delete.
  const readCreate = withActions(ctx, ['read', 'create']);
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { token: readCreate })).status, 200);
  const created = await call(ctx, '/listsxown/', { method: 'POST', token: readCreate, headers: json, body: { name: 'Eggs' } });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).name, 'Eggs', 'with read, the new item is the body');
  for (const [method, headers, body] of [['PATCH', merge, { name: 'x' }], ['PATCH', jsonPatch, [{ op: 'replace', path: '/name', value: 'x' }]], ['PUT', json, { name: 'x' }], ['DELETE', {}, undefined]]) {
    const refused = await call(ctx, '/listsxown/itemsxmilk', { method, token: readCreate, headers, body });
    assert.equal(refused.status, 403, method);
    assert.match(refused.headers.get('WWW-Authenticate'), /error="insufficient_scope"/, method);
  }
  assert.equal((await call(ctx, '/listsxown/itemsxmilk.meta', { method: 'PATCH', token: readCreate, headers: jsonPatch, body: [] })).status, 403, 'a linkset PATCH is an update');
  assert.equal(ctx.rows.items.find(i => i._id === 'itemsxmilk').name, 'Milk');

  // Without read: nothing to read, and writes answer without a body.
  const writeOnly = withActions(ctx, ['create', 'update', 'delete'], 'lwsat_write-only');
  for (const path of ['/', '/listsxown/', '/listsxown/itemsxmilk', '/listsxown/itemsxmilk.meta']) {
    assert.equal((await call(ctx, path, { token: writeOnly })).status, 403, path);
  }
  const blind = await call(ctx, '/listsxown/', { method: 'POST', token: writeOnly, headers: json, body: { name: 'Jam' } });
  assert.equal(blind.status, 201);
  assert.ok(blind.headers.get('Location'));
  assert.match(blind.headers.get('ETag'), /^"[0-9a-f]{32}"$/);
  assert.equal(blind.headers.get('Content-Type'), null);
  assert.equal(await blind.text(), '');
  const updated = await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', token: writeOnly, headers: merge, body: { name: 'Oat milk' } });
  assert.equal(updated.status, 204);
  assert.equal(await updated.text(), '');
  assert.match(updated.headers.get('Cache-Control'), /no-transform/);
  const etag = updated.headers.get('ETag');
  assert.equal(etag, (await call(ctx, '/listsxown/itemsxmilk')).headers.get('ETag'), 'the ETag of the new representation');
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', token: writeOnly, headers: { ...merge, 'If-Match': etag }, body: { priority: 'low' } })).status, 204);
  // A JSON Patch test reads the item: refused without read, whatever it would find.
  const probe = await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', token: writeOnly, headers: jsonPatch, body: [{ op: 'test', path: '/description', value: 'Oat' }, { op: 'replace', path: '/name', value: 'x' }] });
  assert.equal(probe.status, 403);
  assert.equal(ctx.rows.items.find(i => i._id === 'itemsxmilk').name, 'Oat milk');
  assert.equal((await call(ctx, '/listsxown/itemsxbread', { method: 'DELETE', token: writeOnly })).status, 204);

  // `modify` is `update`.
  const modify = withActions(ctx, ['read', 'modify'], 'lwsat_modify');
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'PATCH', token: modify, headers: merge, body: { name: 'Milk' } })).status, 200);
  assert.equal((await call(ctx, '/listsxown/', { method: 'POST', token: modify, headers: json, body: { name: 'x' } })).status, 403);

  // Fail closed: a token that records no actions grants none, and never more than the agent holds now.
  delete ctx.rows.lwsAccessTokens[0].actions;
  assert.equal((await call(ctx, '/')).status, 403);
  ctx.rows.lwsAccessTokens[0].actions = ALL;
  ctx.rows.lwsAgents[0].actions = ['read'];
  assert.equal((await call(ctx, '/listsxown/itemsxmilk', { method: 'DELETE' })).status, 403);
});

test('JSON Patch and merge patch, by the RFCs', () => {
  const doc = { a: { b: 'c' }, list: [1, 2, 3] };
  const apply = patch => lib.applyJsonPatch(doc, patch);
  assert.deepEqual(apply([{ op: 'add', path: '/list/1', value: 9 }]).value.list, [1, 9, 2, 3]);
  assert.deepEqual(apply([{ op: 'add', path: '/list/-', value: 9 }]).value.list, [1, 2, 3, 9]);
  assert.deepEqual(apply([{ op: 'remove', path: '/list/0' }]).value.list, [2, 3]);
  assert.deepEqual(apply([{ op: 'move', from: '/a/b', path: '/d' }]).value, { a: {}, list: [1, 2, 3], d: 'c' });
  assert.deepEqual(apply([{ op: 'copy', from: '/a', path: '/e' }]).value.e, { b: 'c' });
  assert.deepEqual(apply([{ op: 'add', path: '/a~1b~0', value: 1 }]).value['a/b~'], 1);
  assert.deepEqual(apply([]).value, doc);
  assert.equal(apply([{ op: 'move', from: '/a', path: '/a/x' }]).status, 409);
  assert.equal(apply([{ op: 'add', path: '/list/7', value: 1 }]).status, 409);
  assert.equal(apply([{ op: 'add', path: 'no-slash', value: 1 }]).status, 400);
  assert.equal(apply([{ op: 'add', path: '/x' }]).status, 400);
  assert.equal(apply([{ op: 'frobnicate', path: '/x' }]).status, 400);
  assert.deepEqual(doc, { a: { b: 'c' }, list: [1, 2, 3] }, 'the input is never changed');
  // A key named __proto__ stays a key (and is then refused as an unknown member).
  assert.ok(Object.keys(apply([{ op: 'add', path: '/__proto__', value: { polluted: true } }]).value).includes('__proto__'));
  assert.equal({}.polluted, undefined);
  assert.ok(Object.keys(lib.mergePatch({}, JSON.parse('{"__proto__":{"polluted":true}}'))).includes('__proto__'));
  assert.equal({}.polluted, undefined);
  assert.deepEqual(lib.mergePatch({ a: 'b', c: { d: 'e', f: 'g' } }, { a: 'z', c: { f: null } }), { a: 'z', c: { d: 'e' } });
  assert.deepEqual(lib.mergePatch({ a: [1] }, { a: [2] }), { a: [2] });
  assert.deepEqual(lib.mergePatch({ a: 1 }, ['x']), ['x']);
});
