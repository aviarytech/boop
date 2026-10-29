// #286: the shipped Turnkey policy must allow exactly what boop's backend
// submits, deny every parent-chosen-key path, and never let the backend sign.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const { policies } = JSON.parse(readFileSync('docs/turnkey/boop-api-user-policies.json', 'utf8'));
const listed = policy => [...policy.condition.matchAll(/'(ACTIVITY_TYPE_[A-Z0-9_]+)'/g)].map(m => m[1]);
const server = readFileSync('convex/authInternal.ts', 'utf8');
const submitted = [...new Set([...server.matchAll(/type: "(ACTIVITY_TYPE_[A-Z0-9_]+)"/g)].map(m => m[1]))].sort();

test('the allow policy lists exactly the activities convex/authInternal.ts submits', () => {
  const allow = policies.filter(p => p.effect === 'EFFECT_ALLOW');
  assert.equal(allow.length, 1);
  assert.deepEqual(listed(allow[0]).sort(), submitted);
  assert.deepEqual(submitted, ['ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V8', 'ACTIVITY_TYPE_INIT_OTP_V3', 'ACTIVITY_TYPE_VERIFY_OTP_V2']);
});

test('deny policies cover parent-chosen-key auth, plaintext OTP and signing, and never an allowed activity', () => {
  const denied = policies.filter(p => p.effect === 'EFFECT_DENY').flatMap(listed);
  for (const type of ['ACTIVITY_TYPE_EMAIL_AUTH_V3', 'ACTIVITY_TYPE_INIT_USER_EMAIL_RECOVERY_V2', 'ACTIVITY_TYPE_INIT_OTP',
    'ACTIVITY_TYPE_VERIFY_OTP', 'ACTIVITY_TYPE_OTP_AUTH', 'ACTIVITY_TYPE_OTP_LOGIN_V2', 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2',
    // #286 PR b: neither Turnkey key may be signed with, exported or added to by boop's API user.
    'ACTIVITY_TYPE_SIGN_RAW_PAYLOADS', 'ACTIVITY_TYPE_EXPORT_WALLET', 'ACTIVITY_TYPE_EXPORT_WALLET_ACCOUNT', 'ACTIVITY_TYPE_EXPORT_PRIVATE_KEY', 'ACTIVITY_TYPE_CREATE_WALLET_ACCOUNTS']) {
    assert.ok(denied.includes(type), `${type} is denied`);
  }
  for (const type of submitted) assert.ok(!denied.includes(type), `${type} is not denied`);
});

test('every policy is scoped to the boop API user placeholder', () => {
  for (const policy of policies) assert.equal(policy.consensus, "approvers.any(user, user.id == '<BOOP_API_USER_ID>')");
});

test('the backend holds no Turnkey signing path', () => {
  assert.doesNotMatch(server, /sign_raw_payload|SIGN_RAW_PAYLOAD|"code":|otpCode/);
  // Only the client's session signs with the author or assertion key.
  for (const file of readdirSync('convex', { recursive: true }).filter(f => /\.ts$/.test(f) && !f.startsWith('_generated'))) {
    assert.doesNotMatch(readFileSync(`convex/${file}`, 'utf8'), /signRawPayload|sign_raw_payload|createWalletAccounts/, file);
  }
  assert.match(server, /disableEmailAuth: true/);
  assert.match(server, /disableEmailRecovery: true/);
});

// Production runs `bun server.ts` (railway.json), which sets no CSP today;
// public/serve.json is the CSP for `npm start`. Whichever sets one must allow Turnkey.
test('production sets no CSP that would block the client reaching Turnkey', () => {
  const server = readFileSync('server.ts', 'utf8');
  if (/Content-Security-Policy/i.test(server)) assert.match(server, /api\.turnkey\.com/);
});

test('the static-server CSP (public/serve.json) lets the client reach Turnkey directly', () => {
  const csp = JSON.parse(readFileSync('public/serve.json', 'utf8')).headers
    .flatMap(h => h.headers).find(h => h.key === 'Content-Security-Policy').value;
  assert.match(csp, /connect-src [^;]*https:\/\/api\.turnkey\.com/);
});
