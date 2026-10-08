// Exhaustive #236 boundary: every public Convex query, mutation and action is
// either an explicitly reviewed public endpoint below, or rejects anonymous,
// forged-key and asserted-identity callers before it reads private data or writes.
// New public registrations fail this test until they are classified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { getFunctionName } from 'convex/server';

process.env.JWT_SECRET = 'public-boundary-test-secret-not-a-deployed-credential';
const outdir = 'tmp/public-function-boundary-test';
const names = readdirSync('convex').filter(f => /^[A-Za-z]\w*\.ts$/.test(f)).map(f => f.slice(0, -3));
await build({
  entryPoints: names.map(n => `convex/${n}.ts`), outdir, bundle: true, platform: 'node', format: 'esm',
  outExtension: { '.js': '.mjs' }, packages: 'external', logLevel: 'error',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const modules = Object.fromEntries(await Promise.all(names.map(async n => [n, await import(pathToFileURL(`${process.cwd()}/${outdir}/${n}.mjs`))])));
await build({ entryPoints: ['convex/lib/clientAuth.ts'], outfile: `${outdir}/lib/clientAuth.mjs`, format: 'esm', logLevel: 'error' });
const { identityAssertionFields } = await import(pathToFileURL(`${process.cwd()}/${outdir}/lib/clientAuth.mjs`));

/** Reviewed endpoints that intentionally run without a caller identity. None accept
 * an acting identity. DID/Sites resolution lookups are internal behind HTTP projections. */
const PUBLIC = {
  'publication:getPublicList': 'active publications only; masked attribution (#251)',
  'templates:getPublicTemplates': 'templates explicitly marked public',
  'users:getUsersByDids': 'public attribution display names only, emails masked (#251)',
  'waitlist:joinWaitlist': 'anonymous landing-page signup; records only the submitted email',
};
/** Custom (non-wrapper) public functions that authenticate themselves. They must still
 * reject anonymous callers; their identity checks have dedicated tests in auth-boundary. */
const SELF_AUTHENTICATED = new Set([
  'actorSession:establish', 'actorSession:revoke',
  'auth:getUserByTurnkeyId', 'auth:getUserByEmail', 'auth:upsertUser',
]);
/** Compatibility names that reject every caller (#241/#251). */
const REJECTING = new Set([
  'authSessions:createSession', 'authSessions:getSession', 'authSessions:markSessionVerified', 'authSessions:deleteSession',
  'rateLimits:checkAndIncrement', 'rateLimits:checkStatus', 'rateLimits:cleanupExpired',
]);

/** Plausible business arguments from a function's validator, naming existing fixture
 * rows, so a rejection is caused by missing identity rather than by missing input. */
const FIXTURE_IDS = { lists: 'L1', items: 'I1', users: 'U1' };
function sample(t) {
  switch (t?.type) {
    case 'id': return FIXTURE_IDS[t.tableName] ?? `${t.tableName}-1`;
    case 'string': return 'x';
    case 'number': case 'float64': return 1;
    case 'boolean': return false;
    case 'array': return [sample(t.value)];
    case 'literal': return t.value;
    case 'union': return sample(t.value[0]);
    case 'object': return Object.fromEntries(Object.entries(t.value).map(([k, f]) => [k, sample(f.fieldType)]));
    case 'record': return {};
    case 'null': return null;
    default: return {};
  }
}
const nonBusiness = new Set(['authToken', 'apiKey', ...identityAssertionFields]);
function businessArgs(args) {
  return Object.fromEntries(Object.entries(args.value ?? {}).filter(([k]) => !nonBusiness.has(k)).map(([k, f]) => [k, sample(f.fieldType)]));
}

const registrations = [];
for (const [module, exports] of Object.entries(modules)) {
  for (const [name, fn] of Object.entries(exports)) {
    if (!fn?.isPublic || fn.isHttp || !(fn.isQuery || fn.isMutation || fn.isAction)) continue;
    const args = JSON.parse(fn.exportArgs());
    registrations.push({ id: `${module}:${name}`, fn, kind: fn.isQuery ? 'query' : fn.isMutation ? 'mutation' : 'action', fields: Object.keys(args.value ?? {}), business: businessArgs(args) });
  }
}

async function token(subject) {
  return new SignJWT({ email: `${subject}@example.test` }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject).setIssuer('originals-auth').setAudience('originals-api')
    .setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
}
const strangerToken = await token('stranger');
const hash = value => createHash('sha256').update(value).digest('hex');

/** In-memory database that records every write and side effect. */
function fixture() {
  const rows = {
    users: [
      { _id: 'U1', turnkeySubOrgId: 'owner', did: 'did:owner', legacyDid: 'did:legacy', email: 'owner@example.test' },
      { _id: 'U2', turnkeySubOrgId: 'stranger', did: 'did:stranger', email: 'stranger@example.test' },
    ],
    lists: [{ _id: 'L1', ownerDid: 'did:owner', name: 'Private', createdAt: 1 }],
    items: [{ _id: 'I1', listId: 'L1', name: 'Secret', checked: false, createdAt: 1 }],
    accessSessions: [{ _id: 'S1', tokenHash: hash(strangerToken), subject: 'stranger', expiresAt: Date.now() + 3600000 }],
    agentApiKeys: [{ _id: 'K1', ownerDid: 'did:owner', keyHash: hash('valid-owner-key'), scopes: ['*'] }],
  };
  const effects = [], reads = new Set();
  const find = id => {
    const [table, row] = Object.entries(rows).flatMap(([t, rs]) => rs.map(r => [t, r])).find(([, r]) => r._id === id) ?? [];
    reads.add(table ?? 'unknown-id');
    return row ?? null;
  };
  const record = kind => async (...args) => { effects.push([kind, ...args.map(a => typeof a === 'object' && a !== null && !Array.isArray(a) ? Object.keys(a).join(',') : String(a))]); };
  const query = table => {
    reads.add(table);
    const predicates = [];
    const q = {
      withIndex: (_index, fn) => { const b = { eq: (k, v) => { predicates.push(r => r[k] === v); return b; }, gte: () => b, lte: () => b, gt: () => b, lt: () => b }; fn?.(b); return q; },
      order: () => q, filter: () => q,
      collect: async () => (rows[table] ?? []).filter(r => predicates.every(p => p(r))),
      take: async n => (await q.collect()).slice(0, n),
      first: async () => (await q.collect())[0] ?? null,
      unique: async () => (await q.collect())[0] ?? null,
      paginate: async () => ({ page: await q.collect(), isDone: true, continueCursor: '' }),
      [Symbol.asyncIterator]: async function* () { yield* await q.collect(); },
    };
    return q;
  };
  const ctx = {
    rows, effects, reads,
    db: { get: async id => find(id), query, insert: record('insert'), patch: record('patch'), replace: record('replace'), delete: record('delete'), system: { get: async () => null, query } },
    storage: { getUrl: async () => null, generateUploadUrl: record('storage'), delete: record('storage') },
    scheduler: { runAfter: record('schedule'), runAt: record('schedule'), cancel: record('schedule') },
    auth: { getUserIdentity: async () => null },
  };
  // Actions may only consult the internal authentication checkpoint before rejecting.
  ctx.runQuery = async (ref, args) => {
    const [module, name] = getFunctionName(ref).split(':');
    if (module !== 'actorSession') effects.push(['runQuery', `${module}:${name}`]);
    return modules[module][name]._handler(ctx, args);
  };
  ctx.runMutation = async ref => { effects.push(['runMutation', getFunctionName(ref)]); };
  ctx.runAction = async ref => { effects.push(['runAction', getFunctionName(ref)]); };
  return ctx;
}

// Resolving a credential reads only these; anything else before rejection is a leak.
const AUTH_TABLES = new Set(['accessSessions', 'agentApiKeys', 'users']);
async function expectRejected(registration, extra, pattern) {
  const ctx = fixture();
  const args = { ...registration.business, ...extra };
  let result, error;
  try { result = await registration.fn._handler(ctx, args); } catch (e) { error = e; }
  assert.ok(error, `${registration.id} accepted ${JSON.stringify(Object.keys(args))} and returned ${JSON.stringify(result)?.slice(0, 120)}`);
  if (pattern) assert.match(String(error?.data?.message ?? error?.message), pattern, `${registration.id}: ${error?.message}`);
  assert.deepEqual(ctx.effects, [], `${registration.id} had side effects before rejecting`);
  const leaked = [...ctx.reads].filter(t => !AUTH_TABLES.has(t));
  assert.deepEqual(leaked, [], `${registration.id} read ${leaked} before rejecting`);
  return error;
}

test('every public registration is classified', () => {
  assert.ok(registrations.length > 150, `discovered only ${registrations.length} public functions`);
  const ids = new Set(registrations.map(r => r.id));
  for (const id of [...Object.keys(PUBLIC), ...SELF_AUTHENTICATED, ...REJECTING]) assert.ok(ids.has(id), `stale classification: ${id}`);
  for (const r of registrations) {
    if (PUBLIC[r.id] || SELF_AUTHENTICATED.has(r.id) || REJECTING.has(r.id)) continue;
    // Everything else must come from the actor wrappers: they take credentials and
    // only the legacy, non-authoritative identity assertion fields.
    assert.ok(r.fields.includes('authToken') && r.fields.includes('apiKey'), `${r.id} is public but not authenticated`);
    for (const field of identityAssertionFields) assert.ok(r.fields.includes(field), `${r.id} is missing assertion validator ${field}`);
  }
});

test('intentionally public endpoints accept no acting identity', () => {
  for (const r of registrations.filter(r => PUBLIC[r.id])) {
    for (const field of [...identityAssertionFields, 'authToken', 'apiKey', 'userId']) {
      assert.ok(!r.fields.includes(field), `${r.id} accepts ${field}`);
    }
  }
});

test('anonymous callers are rejected by every non-public registration before private reads or writes', async () => {
  const protectedRegistrations = registrations.filter(r => !PUBLIC[r.id]);
  for (const r of protectedRegistrations) {
    const error = await expectRejected(r, {});
    if (!REJECTING.has(r.id)) assert.match(String(error?.data?.message ?? error.message), /auth|token|sign in|session/i, `${r.id}: ${error.message}`);
  }
});

test('unknown API keys and asserted owner identities never authenticate', async () => {
  for (const r of registrations.filter(r => r.fields.includes('apiKey') && !SELF_AUTHENTICATED.has(r.id))) {
    await expectRejected(r, { apiKey: 'forged-key' }, /invalid api key/i);
    // A stranger asserting the owner's current or legacy DID in every legacy field.
    for (const did of ['did:owner', 'did:legacy']) {
      const assertions = Object.fromEntries(identityAssertionFields.map(f => [f, did]));
      await expectRejected(r, { authToken: strangerToken, ...assertions }, /identity assertion/i);
    }
  }
});

test('asserted identities alone, with no credentials, are rejected for reads and writes', async () => {
  const assertions = Object.fromEntries(identityAssertionFields.map(f => [f, 'did:owner']));
  const wrapped = registrations.filter(r => r.fields.includes('apiKey') && !SELF_AUTHENTICATED.has(r.id));
  assert.ok(wrapped.some(r => r.kind === 'query') && wrapped.some(r => r.kind === 'mutation') && wrapped.some(r => r.kind === 'action'));
  for (const r of wrapped) await expectRejected(r, assertions, /authentication required/i);
});

/** HTTP routes that run without a caller identity: login, signed webhooks, public
 * resolution, public-list attachment reads and CORS preflight. */
const PUBLIC_ROUTES = new Set([
  'POST /auth/initiate', 'POST /auth/verify', 'POST /auth/logout', 'POST /api/stripe/webhook',
  'GET /api/did/log', 'GET /api/sites/resolve-host', 'GET /api/sites/resolve-asset', 'GET /health',
  'GET /d/*', 'GET /api/attachments/download',
]);
test('every non-public HTTP route rejects anonymous, forged-key and asserted-identity requests without writing', async () => {
  const routes = modules.http.default.getRoutes().filter(([, method]) => method !== 'OPTIONS');
  assert.ok(routes.length > 30, `discovered only ${routes.length} routes`);
  const assertions = Object.fromEntries(identityAssertionFields.map(f => [f, 'did:owner']));
  const failures = [];
  const body = { listId: 'L1', itemId: 'I1', assetDid: 'did:cel:x', itemIds: ['I1'], categoryId: 'C1', name: 'x', assigneeDid: 'did:owner', did: 'did:webvh:X:boop.ad:user-owner', keyId: 'K1', ...assertions };
  for (const [path, method, handler] of routes) {
    if (PUBLIC_ROUTES.has(`${method} ${path}`)) continue;
    const url = new URL(`https://test${path === '/d/*' ? '/d/owner/resources/list-L1/items/I1/check' : path}`);
    // GET routes take one target; body routes get every field a handler might read.
    if (method === 'GET') for (const [k, v] of Object.entries({ listId: 'L1', ...assertions })) url.searchParams.set(k, String(v));
    for (const headers of [{}, { 'X-API-Key': 'forged-key' }, { Authorization: 'Bearer forged.jwt.token' }]) {
      const ctx = fixture();
      // A published list, so public-link writes reach the authenticated operation.
      ctx.rows.publications = [{ _id: 'P1', listId: 'L1', webvhDid: 'did:owner/resources/list-L1', status: 'active' }];
      ctx.rows.didLogs = [{ _id: 'D1', path: 'owner', userDid: 'did:owner', log: '{}' }];
      // HTTP adapters dispatch to the real internal registrations of the same operation.
      ctx.runQuery = ctx.runMutation = ctx.runAction = async (ref, args) => { const [m, f] = getFunctionName(ref).split(':'); return modules[m][f]._handler(ctx, args); };
      const response = await handler._handler(ctx, new Request(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }));
      if (![401, 403].includes(response.status)) failures.push(`${method} ${path} ${JSON.stringify(headers)} → ${response.status} ${await response.text()}`);
      if (ctx.effects.length) failures.push(`${method} ${path} ${JSON.stringify(headers)} wrote ${JSON.stringify(ctx.effects)}`);
      // Only credential tables, plus the published-resource lookups /d/* resolves first.
      const allowed = path === '/d/*' ? new Set([...AUTH_TABLES, 'didLogs', 'lists', 'publications']) : AUTH_TABLES;
      const leaked = [...ctx.reads].filter(t => !allowed.has(t));
      if (leaked.length) failures.push(`${method} ${path} ${JSON.stringify(headers)} read ${leaked} before rejecting`);
    }
  }
  assert.deepEqual(failures, []);
});
