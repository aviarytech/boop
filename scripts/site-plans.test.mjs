import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { getFunctionName } from 'convex/server';
import { createHash } from 'node:crypto';

const names = ['sites', 'siteInternals', 'siteActions', 'billing', 'actorSession'];
await build({ entryPoints: names.map(n => `convex/${n}.ts`), outdir: 'tmp/site-plans-test', bundle: true,
  platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' },
  external: ['convex/*', '@originals/*', '@turnkey/*', 'didwebvh-ts', '@noble/*'] });
const modules = Object.fromEntries(await Promise.all(names.map(async n => [n, await import(pathToFileURL(`${process.cwd()}/tmp/site-plans-test/${n}.mjs`))])));
const call = (mod, name, ctx, args) => modules[mod][name]._handler(ctx, args);
function fixture({ plan = 'free', status = 'active', count = 0, referralProUntil } = {}) {
  const rows = {
    users: [{ _id: 'U1', did: 'did:owner', legacyDid: 'did:legacy', referralProUntil }],
    subscriptions: plan === 'free' ? [] : [{ _id: 'SUB', userId: 'U1', plan, status }],
    sites: Array.from({ length: count }, (_, i) => ({ _id: `S${i}`, ownerDid: i % 2 ? 'did:owner' : 'did:legacy', did: 'did:site', scid: 'scid', fileId: 'F0' })),
    siteFiles: [{ _id: 'F0', bucketKey: 'existing.html' }], siteHostnames: [], siteKeys: [], siteDidLogEntries: [],
    agentApiKeys: [{ _id: 'KEY', keyHash: createHash('sha256').update('key').digest('hex'), ownerDid: 'did:owner', scopes: ['*'] }],
  };
  let next = 0;
  const reads = new Set();
  const ctx = { rows, reads, db: {
    get: async id => Object.values(rows).flat().find(r => r._id === id) ?? null,
    insert: async (table, args) => { const id = `new-${next++}`; rows[table].push({ ...args, _id: id }); return id; },
    patch: async (id, patch) => Object.assign(await ctx.db.get(id), patch),
    query: table => {
      reads.add(table);
      const filters = [];
      const q = {
        withIndex: (_, fn) => { const b = { eq: (k, v) => { filters.push(r => r[k] === v); return b; } }; fn(b); return q; },
        order: () => q,
        collect: async () => (rows[table] ?? []).filter(r => filters.every(f => f(r))),
        take: async n => (await q.collect()).slice(0, n),
        first: async () => (await q.collect())[0] ?? null,
      };
      return q;
    },
  } };
  ctx.runQuery = ctx.runMutation = ctx.runAction = (ref, args) => {
    const [mod, name] = getFunctionName(ref).split(':');
    return call(mod, name, ctx, args);
  };
  return ctx;
}
const createArgs = suffix => ({ apiKey: 'key', ownerDid: 'did:owner', bucketKey: 'upload', contentType: 'text/html', sha256: 'hash', byteLength: 10,
  hostname: `${suffix}.boop.ad`, did: `did:${suffix}`, scid: suffix, publicKeyMultibase: 'key', encryptedPrivateKey: 'encrypted',
  didLogEntries: [{ versionId: '1', entryJsonl: '{}', signedAt: 1 }], createdAt: 1 });
const create = (ctx, suffix = 'new') => call('siteInternals', 'createSiteRecord', ctx, createArgs(suffix));

test('Free gets one site; Pro and Team get five, including legacy-owned sites', async () => {
  for (const [plan, limit] of [['free', 1], ['pro', 5], ['team', 5]]) {
    const ctx = fixture({ plan, count: limit - 1 });
    await create(ctx);
    const before = structuredClone(ctx.rows);
    await assert.rejects(create(ctx, 'overflow'), /PLAN_LIMIT/);
    assert.deepEqual(ctx.rows, before, 'denied creation must not leave files, keys or logs');
    assert.equal(ctx.rows.sites.length, limit);
    assert.equal((await call('sites', 'getSitePlan', ctx, { apiKey: 'key' })).canCreate, false);
  }
});

test('creation reads quota inside the write transaction and rejects a retried final-slot race', async () => {
  const committed = fixture({ plan: 'pro', count: 4 });
  // Model Convex optimistic transactions: both snapshots can attempt the final
  // slot, but a read of the changed sites range invalidates the losing commit.
  const first = fixture({ plan: 'pro', count: 4 });
  const second = fixture({ plan: 'pro', count: 4 });
  await Promise.all([create(first, 'first'), create(second, 'second')]);
  assert.ok(first.reads.has('sites') && second.reads.has('sites'));
  assert.ok(first.reads.has('subscriptions') && second.reads.has('subscriptions'));
  Object.assign(committed.rows, first.rows);
  await assert.rejects(create(committed, 'second'), /PLAN_LIMIT/);
  assert.equal(committed.rows.sites.length, 5);
});

test('authenticated create actions preflight before storage or key generation; identity assertions cannot bypass quota', async () => {
  const ctx = fixture({ count: 1 });
  for (const name of ['createSiteFromUpload', 'createSiteFromUploadInternal']) {
    await assert.rejects(call('siteActions', name, ctx, { apiKey: 'key', bucketKey: 'siteFiles/did%3Aowner/file.html' }), /PLAN_LIMIT/);
    await assert.rejects(call('siteActions', name, ctx, { apiKey: 'key', ownerDid: 'did:someone', bucketKey: 'siteFiles/did%3Aowner/file.html' }), /assertion/);
    await assert.rejects(call('siteActions', name, ctx, { bucketKey: 'siteFiles/did%3Aowner/file.html' }), /Authentication/);
  }
});

test('domain actions and internal writes reject Free before side effects', async () => {
  const ctx = fixture({ count: 1 });
  ctx.rows.siteKeys.push({ _id: 'K', siteId: 'S0' });
  const request = { apiKey: 'key', siteId: 'S0', hostname: 'example.test', cfHostnameId: 'cf', cfStatus: 'pending', cfSslStatus: 'initializing', now: 1 };
  const before = structuredClone(ctx.rows);
  await assert.rejects(call('siteActions', 'requestCustomHostname', ctx, { apiKey: 'key', siteId: 'S0', hostname: 'example.test' }), error => {
    assert.deepEqual(JSON.parse(JSON.stringify(error.data)), { code: 'PLAN_REQUIRED', message: 'This feature requires the Pro plan. Please upgrade at /pricing.' });
    return true;
  });
  for (const name of ['requestCustomHostname', 'requestCustomHostnameInternal']) {
    await assert.rejects(call('siteActions', name, ctx, { apiKey: 'key', siteId: 'S0', hostname: 'example.test' }), /Pro plan/);
  }
  await assert.rejects(call('siteInternals', 'recordCustomHostnameRequest', ctx, request), /Pro plan/);
  await assert.rejects(call('siteInternals', 'applyDomainMigration', ctx, { siteId: 'S0', hostname: 'example.test' }), /Pro plan/);
  await assert.rejects(call('siteActions', 'migrateCustomDomainInternal', ctx, { ownerDid: 'did:legacy', siteId: 'S0', hostname: 'example.test' }), /Pro plan/);
  assert.deepEqual(ctx.rows, before);
});

test('paid and referral entitlements agree between billing, quota and custom domains', async () => {
  for (const options of [
    { plan: 'pro' }, { plan: 'team' }, { plan: 'pro', status: 'trialing' },
    { referralProUntil: Date.now() + 60000 }, { plan: 'pro', status: 'past_due', referralProUntil: Date.now() + 60000 },
  ]) {
    const ctx = fixture({ ...options, count: 1 });
    assert.notEqual(await modules.billing.getEffectivePlan(ctx, 'U1'), 'free');
    await modules.billing.requirePlan(ctx, 'U1', 'pro');
    await create(ctx);
    await call('siteInternals', 'recordCustomHostnameRequest', ctx, { apiKey: 'key', siteId: 'S0', hostname: 'example.test', cfHostnameId: 'cf', cfStatus: 'pending', cfSslStatus: 'initializing', now: 1 });
    assert.equal(ctx.rows.siteHostnames.at(-1).kind, 'custom');
  }
  for (const options of [
    { plan: 'pro', status: 'incomplete' }, { plan: 'team', status: 'canceled' },
    { plan: 'pro', status: 'past_due' }, { referralProUntil: Date.now() - 1 },
  ]) {
    const ctx = fixture({ ...options, count: 1 });
    assert.equal(await modules.billing.getEffectivePlan(ctx, 'U1'), 'free');
    await assert.rejects(create(ctx), /PLAN_LIMIT/);
    await assert.rejects(modules.billing.requirePlan(ctx, 'U1', 'pro'), /Pro plan/);
  }
});

test('downgrades between action preflight and write are enforced without changing existing identity or replacement', async () => {
  const ctx = fixture({ plan: 'pro', count: 3 });
  await call('sites', 'checkSitePlan', ctx, { ownerDid: 'did:owner', operation: 'create' });
  await call('sites', 'checkSitePlan', ctx, { ownerDid: 'did:owner', operation: 'customDomain' });
  ctx.rows.subscriptions[0].status = 'canceled';
  await assert.rejects(create(ctx), /PLAN_LIMIT/);
  await assert.rejects(call('siteInternals', 'recordCustomHostnameRequest', ctx, { apiKey: 'key', siteId: 'S0', hostname: 'example.test' }), /Pro plan/);
  const original = { ...ctx.rows.sites[0] };
  await call('siteInternals', 'replaceSiteFileRecord', ctx, { apiKey: 'key', siteId: 'S0', bucketKey: 'replacement', contentType: 'text/html', sha256: 'new', byteLength: 20, now: 2 });
  const updated = ctx.rows.sites[0];
  assert.notEqual(updated.fileId, original.fileId);
  for (const key of ['_id', 'did', 'scid', 'ownerDid']) assert.equal(updated[key], original[key]);
  assert.equal((await call('sites', 'listSites', ctx, { apiKey: 'key' })).length, 3);
});

test('paid migration preserves SCID, appends identity history and redirects the old hostname', async () => {
  const ctx = fixture({ plan: 'pro', count: 1 });
  ctx.rows.siteHostnames.push({ _id: 'OLD', siteId: 'S0', hostname: 'old.boop.ad', kind: 'boop_sub', isPrimary: true, status: 'active' },
    { _id: 'CUSTOM', siteId: 'S0', hostname: 'example.test', kind: 'custom', cfStatus: 'active', cfSslStatus: 'active' });
  await call('siteInternals', 'applyDomainMigration', ctx, { siteId: 'S0', hostname: 'example.test', did: 'did:migrated', didLogEntry: { versionId: '2', entryJsonl: '{}', signedAt: 2 }, updatedAt: 2 });
  assert.equal(ctx.rows.sites[0].scid, 'scid');
  assert.equal(ctx.rows.sites[0].primaryHostnameId, 'CUSTOM');
  assert.equal(ctx.rows.siteHostnames[0].redirectTo, 'example.test');
  assert.equal(ctx.rows.siteDidLogEntries.length, 1);
});

test('final writes recheck credentials and owner after action preflight', async () => {
  for (const invalidation of ['revoke', 'scope', 'owner', 'delete']) {
    const ctx = fixture({ plan: 'pro', count: 1 });
    await call('sites', 'checkSitePlan', ctx, { ownerDid: 'did:owner', operation: 'create' });
    if (invalidation === 'revoke') ctx.rows.agentApiKeys[0].revokedAt = 1;
    if (invalidation === 'scope') ctx.rows.agentApiKeys[0].scopes = ['lists:read'];
    if (invalidation === 'owner') ctx.rows.sites[0].ownerDid = 'did:other';
    if (invalidation === 'delete') ctx.rows.users[0].deletionRequestedAt = 1;
    const before = structuredClone(ctx.rows);
    const rejected = /key|scope|authorized|unavailable/i;
    if (invalidation !== 'owner') await assert.rejects(create(ctx), rejected);
    await assert.rejects(call('siteInternals', 'replaceSiteFileRecord', ctx, { apiKey: 'key', siteId: 'S0' }), rejected);
    await assert.rejects(call('siteInternals', 'recordCustomHostnameRequest', ctx, { apiKey: 'key', siteId: 'S0' }), rejected);
    await assert.rejects(call('siteInternals', 'applyDomainMigration', ctx, { apiKey: 'key', siteId: 'S0' }), rejected);
    assert.deepEqual(ctx.rows, before);
  }
  const ctx = fixture({ plan: 'pro', count: 1 });
  for (const name of ['replaceSiteFileRecord', 'recordCustomHostnameRequest']) {
    await assert.rejects(call('siteInternals', name, ctx, { siteId: 'S0' }), /Authentication/);
  }
  await assert.rejects(call('siteInternals', 'createSiteRecord', ctx, { ...createArgs('new'), apiKey: undefined }), /Authentication/);
});
