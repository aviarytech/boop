// #286 (a): the client's Turnkey session. @turnkey/core is replaced by a stub
// that records calls, so these test boop's own checks, not Turnkey.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const outdir = 'tmp/turnkey-session-test';
await mkdir(outdir, { recursive: true });
const t = globalThis.__turnkeyTest = {};
await build({
  entryPoints: ['src/lib/turnkeySession.ts'], outfile: `${outdir}/session.mjs`, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  define: { 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_TURNKEY_ORGANIZATION_ID': '"parent"' },
  plugins: [{ name: 'stub-turnkey', setup(b) {
    b.onResolve({ filter: /^@turnkey\/(core|crypto)$/ }, args => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ loader: 'js', contents: path === '@turnkey/core'
      ? `export class TurnkeyClient { async init() {} get httpClient() { return globalThis.__turnkeyTest.http; }
          getSession() { return globalThis.__turnkeyTest.session(); }
          loginWithOtp(p) { globalThis.__turnkeyTest.calls.push(['login', p]); }
          refreshSession(p) { return globalThis.__turnkeyTest.refresh(p); }
          async clearUnusedKeyPairs() {} async deleteApiKeyPair(p) { globalThis.__turnkeyTest.calls.push(['delete', p.publicKey]); }
          async clearSession() { globalThis.__turnkeyTest.calls.push(['wipe']); } }
        export const decodeVerificationToken = token => JSON.parse(token);`
      : 'export const encryptOtpCodeToBundle = async () => "sealed";' }));
  } }],
});
// defineProperty, not assignment: bun's happy-dom preload makes localStorage
// readonly. bun runs every test file in one process, so restore it after.
const store = new Map();
const savedLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
after(() => {
  if (savedLocalStorage) Object.defineProperty(globalThis, 'localStorage', savedLocalStorage);
  else delete globalThis.localStorage;
  delete globalThis.__turnkeyTest;
});
Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: {
  getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear(),
} });
const session = await import(pathToFileURL(`${process.cwd()}/${outdir}/session.mjs`).href);

const ME = 'user-me';
const at = s => ({ seconds: String(s), nanos: '0' });
const ownKey = { apiKeyId: 'k1', expirationSeconds: String(session.TURNKEY_SESSION_SECONDS), credential: { publicKey: 'pub' }, createdAt: at(5000) };
function subOrg(user = {}) {
  store.clear();
  t.calls = [];
  t.session = () => ({ userId: ME, organizationId: 'sub', expiry: Date.now() / 1000 + 86400, publicKey: 'pub' });
  t.http = {
    getOrganizationConfigs: async () => ({ configs: { features: [], quorum: { threshold: 1, userIds: [ME] } } }),
    removeOrganizationFeature: async () => {},
    getUsers: async () => ({ users: [{ userId: ME, createdAt: at(1000), apiKeys: [ownKey], authenticators: [], oauthProviders: [], ...user }] }),
    deleteApiKeys: async () => { t.calls.push(['revoke']); },
  };
}
beforeEach(() => subOrg());

test('only this user, alone in the quorum, with session-length login keys and no other credentials is clean', async () => {
  assert.deepEqual(await session.hardenAndAuditSubOrg('sub').then(a => [a.clean, a.findings]), [true, []]);
});

// #299 review: the parent picks the root user's credentials at sub-org creation.
test('a passkey, OAuth provider or longer-lived API key planted at creation is a finding', async () => {
  for (const [user, finding] of [
    [{ authenticators: [{ authenticatorId: 'a' }] }, /passkeys/],
    [{ oauthProviders: [{ providerId: 'o' }] }, /OAuth/],
    [{ apiKeys: [ownKey, { ...ownKey, apiKeyId: 'k2', expirationSeconds: String(10 * 365 * 86400) }] }, /outlive a session/],
    [{ apiKeys: [{ ...ownKey, expirationSeconds: undefined }] }, /outlive a session/],
    [{ userPhoneNumber: '+15555550100' }, /phone number/],
  ]) {
    subOrg(user);
    const audit = await session.hardenAndAuditSubOrg('sub');
    assert.equal(audit.clean, false, JSON.stringify(user));
    assert.match(audit.findings.join('; '), finding);
    assert.equal(session.lastSubOrgAudit('sub').clean, false, 'the finding is stored for DID updates to refuse');
  }
});

// #299 review round 2: a session-length key planted at creation can renew
// itself forever. Only the sign-up device's first login can tell it apart.
test('at the sign-up device\'s first login, any key older than its own is a sticky finding', async () => {
  const planted = { ...ownKey, apiKeyId: 'planted', credential: { publicKey: 'backend' }, createdAt: at(1000) };
  subOrg({ createdAt: at(1000), apiKeys: [planted, { ...ownKey, createdAt: at(1003) }] });
  const first = await session.hardenAndAuditSubOrg('sub');
  assert.equal(first.clean, false);
  assert.match(first.findings.join(), /before its first login/);
  // Days later the planted key has renewed into a fresh one; the finding stays on this device.
  t.http.getUsers = async () => ({ users: [{ userId: ME, createdAt: at(1000), apiKeys: [{ ...ownKey, createdAt: at(900000) }, { ...planted, createdAt: at(800000) }], authenticators: [], oauthProviders: [] }] });
  t.session = () => ({ userId: ME, organizationId: 'sub', expiry: Date.now() / 1000 + 86400, publicKey: 'pub' });
  assert.equal((await session.hardenAndAuditSubOrg('sub')).clean, false, 'sticky');
});

test('a later login on another device with older keys around is not a finding', async () => {
  subOrg({ createdAt: at(1000), apiKeys: [{ ...ownKey, apiKeyId: 'phone', credential: { publicKey: 'phone' }, createdAt: at(1002) }, { ...ownKey, createdAt: at(1000 + 3600) }] });
  assert.equal((await session.hardenAndAuditSubOrg('sub')).clean, true);
});

test('logout wipes the local session even when revoking at Turnkey fails or hangs', { timeout: 20_000 }, async () => {
  t.http.getUsers = async () => { throw new Error('offline'); };
  await session.clearTurnkeySession();
  assert.deepEqual(t.calls, [['wipe']]);
  subOrg();
  await session.clearTurnkeySession();
  assert.deepEqual(t.calls, [['revoke'], ['wipe']]);
  // A revoke that never answers is abandoned after its bound; the wipe still runs.
  subOrg();
  t.http.getUsers = () => new Promise(() => {});
  const started = Date.now();
  await session.clearTurnkeySession();
  assert.deepEqual(t.calls, [['wipe']]);
  assert.ok(Date.now() - started < 9_500);
});

// #299 review round 6: a removal that failed once must be retried, or a legacy
// sub-org keeps EMAIL_AUTH (and the device an unclean audit) indefinitely.
test('a feature removal that failed is retried at the next refresh check, before refreshing', async () => {
  let fail = true;
  const removed = [];
  t.http.getOrganizationConfigs = async () => ({ configs: { features: removed.length ? [] : [{ name: 'FEATURE_NAME_EMAIL_AUTH' }], quorum: { threshold: 1, userIds: [ME] } } });
  t.http.removeOrganizationFeature = async ({ name }) => { if (fail) throw new Error('blip'); removed.push(name); };
  const first = await session.hardenAndAuditSubOrg('sub');
  assert.deepEqual(first.findings, ['could not disable FEATURE_NAME_EMAIL_AUTH']);
  fail = false;
  const order = [];
  t.refresh = async () => { order.push('refresh'); };
  const origRemove = t.http.removeOrganizationFeature;
  t.http.removeOrganizationFeature = async args => { order.push('remove'); return origRemove(args); };
  const listeners = [];
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: { addEventListener: (_, f) => listeners.push(f), removeEventListener() {}, visibilityState: 'visible' } });
  try {
    const stop = session.startTurnkeySessionRefresh('sub');
    for (let i = 0; i < 20 && !session.lastSubOrgAudit('sub')?.clean; i += 1) await new Promise(r => setTimeout(r, 5));
    stop();
  } finally {
    if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument); else delete globalThis.document;
  }
  assert.deepEqual(removed, ['FEATURE_NAME_EMAIL_AUTH']);
  assert.equal(session.lastSubOrgAudit('sub').clean, true);
  assert.equal(order[0], 'remove', 'the retry runs before any refresh');
});

test('a hung audit stops holding up refresh once its time is up', { timeout: 45_000 }, async () => {
  t.http.getOrganizationConfigs = () => new Promise(() => {});
  const listeners = [];
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: { addEventListener: (_, f) => listeners.push(f), removeEventListener() {}, visibilityState: 'visible' } });
  let refreshed = false;
  t.session = () => ({ userId: ME, organizationId: 'sub', expiry: Date.now() / 1000 + 3600, publicKey: 'pub' });
  t.refresh = async () => { refreshed = true; };
  try {
    const stop = session.startTurnkeySessionRefresh('sub');
    for (let i = 0; i < 80 && !refreshed; i += 1) await new Promise(r => setTimeout(r, 500));
    stop();
  } finally {
    if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument); else delete globalThis.document;
  }
  assert.equal(refreshed, true);
});

test('discarding never deletes the key a stored session uses', async () => {
  await session.discardSessionKey('pub');
  assert.deepEqual(t.calls, []);
  await session.discardSessionKey('stray');
  assert.deepEqual(t.calls, [['delete', 'stray']]);
});

test('a verification token bound to another key is refused before any login', async () => {
  await assert.rejects(() => session.completeTurnkeyLogin({ verificationToken: JSON.stringify({ public_key: 'server-key' }), subOrgId: 'sub', publicKey: 'mine' }), /not bound/);
  assert.deepEqual(t.calls, [['delete', 'mine']]);
});

test('concurrent refreshes are serialised, so a second one sees the first one\'s session', async () => {
  let expiry = Date.now() / 1000 + 3600; // inside the refresh window
  t.session = () => ({ userId: ME, organizationId: 'sub', expiry });
  let running = 0, overlapped = false, refreshes = 0;
  t.refresh = async () => {
    running += 1; overlapped ||= running > 1; refreshes += 1;
    await new Promise(r => setTimeout(r, 20));
    expiry = Date.now() / 1000 + session.TURNKEY_SESSION_SECONDS;
    running -= 1;
  };
  assert.deepEqual(await Promise.all([session.refreshTurnkeySessionIfDue('sub'), session.refreshTurnkeySessionIfDue('sub')]), ['active', 'active']);
  assert.equal(overlapped, false);
  assert.equal(refreshes, 1, 'the second caller found the session already refreshed');
});
