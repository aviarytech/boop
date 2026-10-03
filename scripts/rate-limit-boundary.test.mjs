import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { getFunctionName } from 'convex/server';

// Compile the actual router's production branch without changing process.env
// for other tests. No external OTP provider or deployed database is contacted.
await build({
  entryPoints: ['convex/rateLimits.ts', 'convex/http.ts'],
  outdir: 'tmp/rate-limit-boundary', bundle: true, platform: 'node', format: 'esm',
  outExtension: { '.js': '.mjs' }, packages: 'external',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const limits = await import(pathToFileURL(`${process.cwd()}/tmp/rate-limit-boundary/rateLimits.mjs`));
const { default: router } = await import(pathToFileURL(`${process.cwd()}/tmp/rate-limit-boundary/http.mjs`));

function fixture() {
  const rows = [];
  const ctx = { db: {
    query: table => {
      assert.equal(table, 'rateLimits');
      const predicates = [];
      const q = {
        withIndex: (_name, fn) => {
          const b = {
            eq: (key, value) => { predicates.push(row => row[key] === value); return b; },
            lt: (key, value) => { predicates.push(row => row[key] < value); return b; },
          };
          fn(b); return q;
        },
        first: async () => rows.find(row => predicates.every(p => p(row))) ?? null,
        take: async n => rows.filter(row => predicates.every(p => p(row))).slice(0, n),
      };
      return q;
    },
    insert: async (_table, values) => { rows.push({ _id: `R${rows.length}`, ...values }); },
    patch: async (id, values) => Object.assign(rows.find(row => row._id === id), values),
    delete: async id => rows.splice(rows.findIndex(row => row._id === id), 1),
  } };
  return { ctx, rows };
}

test('direct compatibility calls cannot read, poison, or clear auth budgets', async () => {
  const { ctx, rows } = fixture();
  for (const identity of [null, { subject: 'unrelated-user' }]) {
    ctx.auth = { getUserIdentity: async () => identity };
    for (const [endpoint, key] of [['initiate', '203.0.113.8'], ['verify', 'victim-session']]) {
      await limits.checkAndIncrementInternal._handler(ctx, { endpoint, key });
      const before = structuredClone(rows);
      for (const name of ['checkAndIncrement', 'checkStatus', 'cleanupExpired']) {
        assert.equal(limits[name].isPublic, true);
        await assert.rejects(() => limits[name]._handler(ctx, name === 'cleanupExpired' ? {} : { endpoint, key }), /HTTP login/);
        assert.deepEqual(rows, before);
      }
    }
  }
  for (const name of ['checkAndIncrementInternal', 'checkStatusInternal', 'cleanupExpiredInternal', 'clearAll']) {
    assert.equal(limits[name].isInternal, true);
    assert.notEqual(limits[name].isPublic, true);
  }
});

for (const [endpoint, key, maxAttempts] of [['initiate', '203.0.113.8', 10], ['verify', 'victim-session', 5]]) {
  test(`HTTP ${endpoint} uses internal budgets, allows ${maxAttempts}, blocks excess, resets at expiry`, async () => {
    const { ctx, rows } = fixture();
    let downstreamCalls = 0;
    ctx.runMutation = async (ref, args) => {
      const name = getFunctionName(ref);
      if (name === 'authSessions:createSessionInternal') return;
      assert.equal(name, 'rateLimits:checkAndIncrementInternal');
      assert.deepEqual(args, { endpoint, key });
      return limits.checkAndIncrementInternal._handler(ctx, args);
    };
    ctx.runQuery = async ref => {
      assert.equal(getFunctionName(ref), 'authSessions:getSessionInternal');
      downstreamCalls++;
      return null; // Invalid OTP session still consumes an attempt.
    };
    ctx.runAction = async ref => {
      assert.equal(getFunctionName(ref), 'authInternal:initiateAuth');
      downstreamCalls++;
      return { sessionId: 'new-session', session: { email: 'test@example.test' }, message: 'Sent' };
    };
    const [handler] = router.lookup(`/auth/${endpoint}`, 'POST');
    const request = () => new Request(`https://test/auth/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `${key}, proxy` },
      body: JSON.stringify(endpoint === 'initiate' ? { email: 'test@example.test' } : { sessionId: key, code: '123456' }),
    });
    const originalNow = Date.now;
    let now = 1000000;
    Date.now = () => now;
    try {
      for (let i = 1; i <= maxAttempts; i++) {
        const response = await handler._handler(ctx, request());
        assert.equal(response.status, endpoint === 'initiate' ? 200 : 400);
        assert.equal(rows[0].attempts, i);
        assert.equal(downstreamCalls, i);
      }
      for (const elapsed of [0, 59999]) {
        now = 1000000 + elapsed;
        const response = await handler._handler(ctx, request());
        assert.equal(response.status, 429);
        assert.equal(response.headers.get('Retry-After'), String(Math.ceil((60000 - elapsed) / 1000)));
        assert.equal(rows[0].attempts, maxAttempts);
        assert.equal(downstreamCalls, maxAttempts);
      }
      now = 1060000;
      const status = await limits.checkStatusInternal._handler(ctx, { endpoint, key });
      assert.deepEqual(status, { allowed: true, currentAttempts: 0, remainingAttempts: maxAttempts });
      assert.equal((await handler._handler(ctx, request())).status, endpoint === 'initiate' ? 200 : 400);
      assert.equal(rows[0].attempts, 1);
      assert.equal(rows[0].windowStart, now);
      assert.equal(rows[0].expiresAt, now + 120000);
      assert.equal(downstreamCalls, maxAttempts + 1);
    } finally { Date.now = originalNow; }
  });
}
