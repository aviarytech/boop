// #286 (a): the client's Turnkey session. @turnkey/core is replaced by a stub
// that records calls, so these test boop's own checks, not Turnkey.
import { test, beforeEach } from 'node:test';
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
          async clearUnusedKeyPairs() {} async deleteApiKeyPair(p) { globalThis.__turnkeyTest.calls.push(['delete', p.publicKey]); } }
        export const decodeVerificationToken = token => JSON.parse(token);`
      : 'export const encryptOtpCodeToBundle = async () => "sealed";' }));
  } }],
});
globalThis.localStorage = { store: new Map(), getItem(k) { return this.store.get(k) ?? null; }, setItem(k, v) { this.store.set(k, v); } };
const session = await import(pathToFileURL(`${process.cwd()}/${outdir}/session.mjs`).href);

const ME = 'user-me';
const ownKey = { apiKeyId: 'k1', expirationSeconds: String(session.TURNKEY_SESSION_SECONDS), credential: { publicKey: 'pub' } };
function subOrg(user = {}) {
  t.calls = [];
  t.session = () => ({ userId: ME, organizationId: 'sub', expiry: Date.now() / 1000 + 86400, publicKey: 'pub' });
  t.http = {
    getOrganizationConfigs: async () => ({ configs: { features: [], quorum: { threshold: 1, userIds: [ME] } } }),
    removeOrganizationFeature: async () => {},
    getUsers: async () => ({ users: [{ userId: ME, apiKeys: [ownKey], authenticators: [], oauthProviders: [], ...user }] }),
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
  ]) {
    subOrg(user);
    const audit = await session.hardenAndAuditSubOrg('sub');
    assert.equal(audit.clean, false, JSON.stringify(user));
    assert.match(audit.findings.join('; '), finding);
    assert.equal(session.lastSubOrgAudit('sub').clean, false, 'the finding is stored for DID updates to refuse');
  }
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
