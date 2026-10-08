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
const { identityAssertionFields } = await import(pathToFileURL(`${process.cwd()}/${outdir}/clientAuth.mjs`)).catch(async () => {
  await build({ entryPoints: ['convex/lib/clientAuth.ts'], outfile: `${outdir}/clientAuth.mjs`, format: 'esm', logLevel: 'error' });
  return import(pathToFileURL(`${process.cwd()}/${outdir}/clientAuth.mjs`));
});

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

const registrations = [];
for (const [module, exports] of Object.entries(modules)) {
  for (const [name, fn] of Object.entries(exports)) {
    if (!fn?.isPublic || fn.isHttp || !(fn.isQuery || fn.isMutation || fn.isAction)) continue;
    const args = JSON.parse(fn.exportArgs());
    registrations.push({ id: `${module}:${name}`, fn, kind: fn.isQuery ? 'query' : fn.isMutation ? 'mutation' : 'action', fields: Object.keys(args.value ?? {}) });
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
  const effects = [];
  const find = id => Object.values(rows).flat().find(row => row._id === id) ?? null;
  const record = kind => async (...args) => { effects.push([kind, ...args.map(a => typeof a === 'object' && a !== null && !Array.isArray(a) ? Object.keys(a).join(',') : String(a))]); };
  const query = table => {
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
    rows, effects,
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

async function expectRejected(registration, args, pattern) {
  const ctx = fixture();
  let result, error;
  try { result = await registration.fn._handler(ctx, args); } catch (e) { error = e; }
  assert.ok(error, `${registration.id} accepted ${JSON.stringify(Object.keys(args))} and returned ${JSON.stringify(result)?.slice(0, 120)}`);
  if (pattern) assert.match(String(error?.data?.message ?? error?.message), pattern, `${registration.id}: ${error?.message}`);
  assert.deepEqual(ctx.effects, [], `${registration.id} had side effects before rejecting`);
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

test('anonymous callers are rejected by every non-public registration before reads or writes', async () => {
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
