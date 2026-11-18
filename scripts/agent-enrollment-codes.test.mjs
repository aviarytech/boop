// One-time agent enrollment codes (docs/agent-enrollment-codes.md, plans/002 D14):
// the code format, and mint, list, revoke, redeem and cleanup against the real
// Convex handlers over an in-memory database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { getFunctionName } from 'convex/server';
import { createAuthFixture } from './helpers/auth-fixture.mjs';

const outdir = 'tmp/agent-enrollment-codes-test';
await build({
  entryPoints: ['convex/agentEnrollment.ts', 'convex/actorSession.ts', 'convex/rateLimits.ts', 'shared/enrollmentCode.ts'],
  outdir, bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, packages: 'external', logLevel: 'error',
});
const load = name => import(pathToFileURL(`${process.cwd()}/${outdir}/${name}.mjs`));
const modules = { agentEnrollment: await load('convex/agentEnrollment'), actorSession: await load('convex/actorSession'), rateLimits: await load('convex/rateLimits') };
const codes = await load('shared/enrollmentCode');
const enrollment = modules.agentEnrollment;

const owner = await createAuthFixture('did:webvh:owner');
const other = await createAuthFixture('did:webvh:other');
const API_KEY = 'pa_live_fixture';
const sha256 = async text => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('hex');

async function fixture() {
  const tables = {
    users: [owner.user, other.user].map(user => ({ ...user })),
    // No row expiry: tests move the clock past the fixture session's hour.
    accessSessions: [owner.accessSession, other.accessSession].map(session => ({ ...session, expiresAt: undefined })),
    agentApiKeys: [{ _id: 'key-1', ownerDid: owner.user.did, keyHash: await sha256(API_KEY), scopes: ['*'] }],
    agentEnrollmentCodes: [], rateLimits: [],
  };
  let next = 0;
  const scheduled = [];
  const locate = id => { for (const rows of Object.values(tables)) { const row = rows.find(r => r._id === id); if (row) return [rows, row]; } return []; };
  const query = table => {
    const tests = [];
    const q = {
      withIndex: (_name, fn) => {
        const b = {
          eq: (k, value) => { tests.push(r => r[k] === value); return b; },
          gt: (k, value) => { tests.push(r => r[k] > value); return b; },
          lt: (k, value) => { tests.push(r => r[k] < value); return b; },
        };
        fn?.(b); return q;
      },
      collect: async () => tables[table].filter(r => tests.every(t => t(r))),
      take: async n => (await q.collect()).slice(0, n),
      first: async () => (await q.collect())[0] ?? null,
    };
    return q;
  };
  const ctx = {
    db: {
      query,
      get: async id => locate(id)[1] ?? null,
      insert: async (table, value) => { const _id = `${table}:${++next}`; tables[table].push({ _id, ...value }); return _id; },
      patch: async (id, value) => { Object.assign(locate(id)[1], value); },
      delete: async id => { const [rows, row] = locate(id); rows.splice(rows.indexOf(row), 1); },
    },
    scheduler: { runAfter: async (_delay, ref) => { scheduled.push(getFunctionName(ref)); } },
  };
  ctx.runQuery = ctx.runMutation = async (ref, args) => {
    const [module, name] = getFunctionName(ref).split(':');
    return modules[module][name]._handler(ctx, args);
  };
  return { ctx, tables, scheduled };
}

const session = fixtureUser => ({ authToken: fixtureUser.authToken });
const mint = (ctx, who = owner, args = {}) => enrollment.mintEnrollmentCode._handler(ctx, { ...session(who), ...args });
const list = (ctx, who = owner) => enrollment.listEnrollmentCodes._handler(ctx, session(who));
const revoke = (ctx, codeId, who = owner) => enrollment.revokeEnrollmentCode._handler(ctx, { ...session(who), codeId });
const redeem = (ctx, code) => enrollment.redeemEnrollmentCode._handler(ctx, { code });

/** Runs with the server flag on and a clock the test can move. */
async function withClock(run, { enabled = true } = {}) {
  const realNow = Date.now, previous = process.env.AGENT_ENROLLMENT_CODES;
  const clock = { now: realNow() };
  Date.now = () => clock.now;
  if (enabled) process.env.AGENT_ENROLLMENT_CODES = 'true'; else delete process.env.AGENT_ENROLLMENT_CODES;
  try { await run(clock); } finally {
    Date.now = realNow;
    if (previous === undefined) delete process.env.AGENT_ENROLLMENT_CODES; else process.env.AGENT_ENROLLMENT_CODES = previous;
  }
}
const errorCode = error => error?.data?.code;

test('codes are high-entropy, human-copyable and read forgivingly', async () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const code = codes.generateEnrollmentCode();
    assert.match(code, /^BOOP(-[0-9A-HJKMNP-TV-Z]{5}){5}$/);
    assert.equal(codes.normalizeEnrollmentCode(code), code);
    seen.add(code);
  }
  assert.equal(seen.size, 200);
  // 25 symbols of a 32-symbol alphabet: 125 bits.
  assert.equal(codes.generateEnrollmentCode().replace(/^BOOP|-/g, '').length, 25);

  const code = 'BOOP-0123A-BCDEF-GHJKM-NPQRS-TVWXZ';
  for (const typed of [code.toLowerCase(), ` ${code} `, code.replaceAll('-', ''), code.replaceAll('-', ' '), 'boop-O123A-BCDEF-GHJKM-NPQRS-TVWXZ', 'BOOP-0I23A-BCDEF-GHJKM-NPQRS-TVWXZ', 'BOOP-0l23A-BCDEF-GHJKM-NPQRS-TVWXZ']) {
    assert.equal(codes.normalizeEnrollmentCode(typed), code, typed);
    assert.equal(await codes.hashEnrollmentCode(typed), await sha256(code));
  }
  for (const bad of ['', 'BOOP', code.slice(0, -1), `${code}0`, code.replace('BOOP', 'BEEP'), code.replace('A', 'U'), code.replace('A', '!'), 'x'.repeat(500)]) {
    assert.equal(codes.normalizeEnrollmentCode(bad), null, bad);
    assert.equal(await codes.hashEnrollmentCode(bad), null);
  }
});

test('constantTimeEqual, labels and the countdown', () => {
  assert.equal(codes.constantTimeEqual('abc', 'abc'), true);
  for (const [a, b] of [['abc', 'abd'], ['abc', 'ab'], ['', 'a'], ['abc', 'xbc']]) assert.equal(codes.constantTimeEqual(a, b), false);
  assert.equal(codes.cleanEnrollmentLabel('  Shopping bot  '), 'Shopping bot');
  assert.equal(codes.cleanEnrollmentLabel('   '), undefined);
  assert.equal(codes.cleanEnrollmentLabel(undefined), undefined);
  assert.equal(codes.cleanEnrollmentLabel('x'.repeat(200)).length, codes.ENROLLMENT_CODE_LABEL_MAX);
  assert.equal(codes.formatEnrollmentCountdown(900_000, 0), '15:00');
  assert.equal(codes.formatEnrollmentCountdown(61_000, 500), '1:01');
  assert.equal(codes.formatEnrollmentCountdown(1000, 5000), '0:00');
  assert.equal(codes.ENROLLMENT_CODE_TTL_MS, 15 * 60 * 1000);
});

test('minting returns the code once and stores only its hash', () => withClock(async clock => {
  const { ctx, tables } = await fixture();
  const minted = await mint(ctx, owner, { label: '  Shopping bot ' });
  assert.match(minted.code, /^BOOP(-[0-9A-Z]{5}){5}$/);
  assert.equal(minted.label, 'Shopping bot');
  assert.equal(minted.createdAt, clock.now);
  assert.equal(minted.expiresAt, clock.now + codes.ENROLLMENT_CODE_TTL_MS);

  assert.equal(tables.agentEnrollmentCodes.length, 1);
  const [row] = tables.agentEnrollmentCodes;
  assert.deepEqual(Object.keys(row).sort(), ['_id', 'codeHash', 'createdAt', 'expiresAt', 'label', 'ownerId']);
  assert.equal(row.codeHash, await sha256(minted.code));
  assert.equal(row.ownerId, owner.user._id);
  assert.ok(!JSON.stringify(tables).includes(minted.code), 'the plaintext code is never stored');

  // Listing shows the code's record to its owner only, without the code or its hash.
  assert.deepEqual(await list(ctx), [{ id: minted.id, label: 'Shopping bot', createdAt: minted.createdAt, expiresAt: minted.expiresAt }]);
  assert.deepEqual(await list(ctx, other), []);

  const unlabelled = await mint(ctx);
  assert.equal(unlabelled.label, null);
  assert.equal('label' in tables.agentEnrollmentCodes[1], false);
  assert.notEqual(unlabelled.code, minted.code);
}));

test('minting is off unless the deployment enables it', () => withClock(async () => {
  const { ctx, tables } = await fixture();
  await assert.rejects(() => mint(ctx), error => errorCode(error) === 'DISABLED');
  // The internal store refuses too, so no other caller can bypass the switch.
  await assert.rejects(() => enrollment.storeEnrollmentCodeInternal._handler(ctx, { ...session(owner), codeHash: 'a'.repeat(64) }), error => errorCode(error) === 'DISABLED');
  assert.equal(tables.agentEnrollmentCodes.length, 0);
  assert.equal(tables.rateLimits.length, 0);
}, { enabled: false }));

test('only a signed-in session mints, lists or revokes', () => withClock(async () => {
  const { ctx, tables } = await fixture();
  const minted = await mint(ctx);
  const before = structuredClone(tables.agentEnrollmentCodes);
  const forbidden = error => error?.data?.code === 'FORBIDDEN';
  await assert.rejects(() => enrollment.mintEnrollmentCode._handler(ctx, { apiKey: API_KEY }), forbidden);
  await assert.rejects(() => enrollment.storeEnrollmentCodeInternal._handler(ctx, { apiKey: API_KEY, codeHash: 'a'.repeat(64) }), forbidden);
  await assert.rejects(() => enrollment.listEnrollmentCodes._handler(ctx, { apiKey: API_KEY }), forbidden);
  await assert.rejects(() => enrollment.revokeEnrollmentCode._handler(ctx, { apiKey: API_KEY, codeId: minted.id }), forbidden);
  await assert.rejects(() => enrollment.mintEnrollmentCode._handler(ctx, {}), /authentication required/i);
  await assert.rejects(() => enrollment.listEnrollmentCodes._handler(ctx, {}), /authentication required/i);
  assert.deepEqual(tables.agentEnrollmentCodes, before);
  for (const name of ['redeemEnrollmentCode', 'cleanupEnrollmentCodes', 'storeEnrollmentCodeInternal']) {
    assert.equal(enrollment[name].isInternal, true, name);
    assert.notEqual(enrollment[name].isPublic, true, name);
  }
  assert.equal(enrollment.storeEnrollmentCode, undefined, 'the store has no public registration');
}));

test('redeeming returns the owner and works once', () => withClock(async clock => {
  const { ctx, tables } = await fixture();
  const minted = await mint(ctx, owner, { label: 'Bot' });
  clock.now += 60_000;
  // Typed the way a person might: lower case, no hyphens.
  const redeemed = await redeem(ctx, minted.code.toLowerCase().replaceAll('-', ''));
  assert.deepEqual(redeemed, { ownerId: owner.user._id, ownerDid: owner.user.did, codeId: minted.id, label: 'Bot' });
  assert.equal(tables.agentEnrollmentCodes[0].redeemedAt, clock.now);

  assert.equal(await redeem(ctx, minted.code), null, 'a second redemption fails');
  assert.equal(tables.agentEnrollmentCodes[0].redeemedAt, clock.now);
  assert.deepEqual(await list(ctx), [], 'a redeemed code is no longer listed');
  await assert.rejects(() => revoke(ctx, minted.id), error => error?.data?.code === 'FORBIDDEN');
}));

test('two redemptions of one code in the same instant: one wins', () => withClock(async () => {
  const { ctx } = await fixture();
  const minted = await mint(ctx);
  const results = await Promise.all([redeem(ctx, minted.code), redeem(ctx, minted.code)]);
  assert.equal(results.filter(Boolean).length, 1);
}));

test('unknown and malformed codes redeem to null and change nothing', () => withClock(async () => {
  const { ctx, tables } = await fixture();
  await mint(ctx);
  const before = structuredClone(tables.agentEnrollmentCodes);
  for (const code of [codes.generateEnrollmentCode(), '', 'BOOP-AAAAA', 'not a code', tables.agentEnrollmentCodes[0].codeHash]) {
    assert.equal(await redeem(ctx, code), null);
  }
  assert.deepEqual(tables.agentEnrollmentCodes, before);
}));

test('a code expires after the TTL', () => withClock(async clock => {
  const { ctx, tables } = await fixture();
  const minted = await mint(ctx);
  const late = await mint(ctx);
  clock.now = minted.expiresAt - 1;
  assert.equal((await list(ctx)).length, 2);
  assert.ok(await redeem(ctx, late.code), 'redeemable until the last millisecond');
  clock.now = minted.expiresAt;
  assert.equal(await redeem(ctx, minted.code), null);
  assert.equal(tables.agentEnrollmentCodes[0].redeemedAt, undefined);
  assert.deepEqual(await list(ctx), []);
}));

test('a revoked code cannot be redeemed, and only its owner can revoke it', () => withClock(async () => {
  const { ctx, tables } = await fixture();
  const minted = await mint(ctx);
  await assert.rejects(() => revoke(ctx, minted.id, other), error => error?.data?.code === 'FORBIDDEN');
  assert.equal(tables.agentEnrollmentCodes.length, 1);
  assert.equal(await revoke(ctx, minted.id), null);
  assert.equal(tables.agentEnrollmentCodes.length, 0);
  assert.equal(await redeem(ctx, minted.code), null);
  assert.deepEqual(await list(ctx), []);
  await assert.rejects(() => revoke(ctx, minted.id), error => error?.data?.code === 'FORBIDDEN');
}));

test('the cap counts only codes that can still be redeemed, per account', () => withClock(async clock => {
  const { ctx, tables } = await fixture();
  const minted = [];
  for (let i = 0; i < codes.MAX_ACTIVE_ENROLLMENT_CODES; i++) minted.push(await mint(ctx));
  await assert.rejects(() => mint(ctx), error => errorCode(error) === 'TOO_MANY_ACTIVE');
  assert.equal(tables.agentEnrollmentCodes.length, codes.MAX_ACTIVE_ENROLLMENT_CODES);
  assert.equal(tables.rateLimits[0].attempts, codes.MAX_ACTIVE_ENROLLMENT_CODES, 'a refused mint spends no budget');
  assert.ok(await mint(ctx, other), "another account's cap is its own");

  await revoke(ctx, minted[0].id);
  assert.ok(await mint(ctx), 'revoking frees a slot');
  await assert.rejects(() => mint(ctx), error => errorCode(error) === 'TOO_MANY_ACTIVE');
  await redeem(ctx, minted[1].code);
  assert.ok(await mint(ctx), 'redeeming frees a slot');
  await assert.rejects(() => mint(ctx), error => errorCode(error) === 'TOO_MANY_ACTIVE');
  clock.now += codes.ENROLLMENT_CODE_TTL_MS;
  assert.ok(await mint(ctx), 'expiry frees every slot');
}));

test('minting is rate-limited per account with the shared rateLimits budget', () => withClock(async clock => {
  const { ctx, tables } = await fixture();
  const { maxAttempts, windowMs } = modules.rateLimits.RATE_LIMITS.enrollmentCodeMint;
  const start = clock.now;
  for (let i = 0; i < maxAttempts; i++) await revoke(ctx, (await mint(ctx)).id);
  const key = `user:${owner.user._id}`;
  assert.deepEqual(tables.rateLimits.map(r => [r.key, r.endpoint, r.attempts]), [[key, 'enrollmentCodeMint', maxAttempts]]);
  clock.now = start + windowMs - 1;
  await assert.rejects(() => mint(ctx), error => errorCode(error) === 'RATE_LIMITED' && error.data.retryAfterMs === 1);
  assert.equal(tables.agentEnrollmentCodes.length, 0);
  assert.ok(await mint(ctx, other), "another account's budget is its own");
  clock.now = start + windowMs;
  assert.ok(await mint(ctx), 'the budget resets when the window ends');
  assert.equal(tables.rateLimits.find(r => r.key === key).attempts, 1);
  // The internal check accepts the new budget name.
  assert.equal((await modules.rateLimits.checkStatusInternal._handler(ctx, { key, endpoint: 'enrollmentCodeMint' })).remainingAttempts, maxAttempts - 1);
}));

test('a code names the owner by their current DID, and never a deleting account', () => withClock(async () => {
  const { ctx, tables } = await fixture();
  const first = await mint(ctx);
  const second = await mint(ctx);
  const user = tables.users.find(u => u._id === owner.user._id);
  user.legacyDid = user.did; user.did = 'did:webvh:reminted';
  assert.equal((await redeem(ctx, first.code)).ownerDid, 'did:webvh:reminted');
  user.deletionRequestedAt = Date.now();
  assert.equal(await redeem(ctx, second.code), null);
  assert.equal(tables.agentEnrollmentCodes[1].redeemedAt, undefined);
}));

test('cleanup deletes codes a day past expiry and keeps the rest', () => withClock(async clock => {
  const { ctx, tables, scheduled } = await fixture();
  const old = await mint(ctx);
  const used = await mint(ctx);
  await redeem(ctx, used.code);
  clock.now = old.expiresAt + enrollment.ENROLLMENT_CODE_RETENTION_MS;
  const fresh = await mint(ctx);
  assert.equal(await enrollment.cleanupEnrollmentCodes._handler(ctx, {}), 0, 'kept through the retention window');
  clock.now += 1;
  assert.equal(await enrollment.cleanupEnrollmentCodes._handler(ctx, {}), 2);
  assert.deepEqual(tables.agentEnrollmentCodes.map(r => r._id), [fresh.id]);
  assert.deepEqual(scheduled, []);
}));
