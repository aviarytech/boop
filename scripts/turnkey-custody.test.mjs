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
  // Only the client's session signs with the author or assertion key. The one
  // signing path Convex has (#286 P3) is the receipt signer, which signs as the
  // parent org with the Boop service DID's receipt key, under its own API user.
  const RECEIPT_SIGNER = 'lib/serviceReceipts.ts';
  for (const file of readdirSync('convex', { recursive: true }).filter(f => /\.ts$/.test(f) && !f.startsWith('_generated'))) {
    const source = readFileSync(`convex/${file}`, 'utf8');
    assert.doesNotMatch(source, /createWalletAccounts|create_wallet|CREATE_WALLET|CREATE_PRIVATE_KEYS/, file);
    if (file.replaceAll('\\', '/') !== RECEIPT_SIGNER) assert.doesNotMatch(source, /signRawPayload|sign_raw_payload|SIGN_RAW_PAYLOAD/, file);
  }
  const signer = readFileSync(`convex/${RECEIPT_SIGNER}`, 'utf8');
  assert.equal([...signer.matchAll(/sign_raw_payload/g)].length, 1);
  assert.match(signer, /organizationId: credentials\.organizationId/);
  assert.match(signer, /TURNKEY_RECEIPT_API_PUBLIC_KEY/);
  assert.doesNotMatch(signer, /TURNKEY_API_PUBLIC_KEY|TURNKEY_API_PRIVATE_KEY|getTurnkeyCredentials|subOrg/);
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

// #286 P3: the receipt signer is a second parent-org API user that can do one
// thing. The auth relay's user above stays unable to sign at all.
test('the receipt signer policy allows only signing with the receipt key', () => {
  const file = JSON.parse(readFileSync('docs/turnkey/boop-receipt-signer-policies.json', 'utf8'));
  const allow = file.policies.filter(p => p.effect === 'EFFECT_ALLOW');
  assert.equal(allow.length, 1);
  assert.deepEqual(listed(allow[0]), ['ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2']);
  assert.match(allow[0].condition, /'<RECEIPT_KEY_ADDRESS>'/);
  for (const policy of file.policies) assert.equal(policy.consensus, "approvers.any(user, user.id == '<BOOP_RECEIPT_SIGNER_USER_ID>')");
  const denied = file.policies.filter(p => p.effect === 'EFFECT_DENY').map(p => p.condition).join(' ');
  for (const term of ['ACTIVITY_TYPE_CREATE_WALLET_ACCOUNTS', 'ACTIVITY_TYPE_EXPORT_WALLET_ACCOUNT', 'ACTIVITY_TYPE_CREATE_SUB_ORGANIZATION_V8', 'ACTIVITY_TYPE_INIT_OTP_V3', "'<UPDATE_KEY_ADDRESS>'"]) {
    assert.ok(denied.includes(term), `${term} is denied`);
  }
  // SIGN_RAW_PAYLOAD_V2 is resource PRIVATE_KEY in Turnkey: denying that resource would deny the allowed signature.
  assert.doesNotMatch(denied, /'PRIVATE_KEY'/);
  assert.ok(denied.includes('ACTIVITY_TYPE_CREATE_PRIVATE_KEYS_V2'), 'private-key creation is denied by type');
  // The relay user's policy file is unchanged by receipts: it still denies signing outright.
  assert.ok(policies.filter(p => p.effect === 'EFFECT_DENY').flatMap(listed).includes('ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2'));
  assert.doesNotMatch(server, /TURNKEY_RECEIPT/);
});
