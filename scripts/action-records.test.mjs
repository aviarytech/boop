import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { legacyActionEvidence } from '../shared/legacyActionEvidence.ts';
import { fixture, credentials, digest, PRIVATE_SHARING_JWT_SECRET } from './helpers/private-sharing-fixture.mjs';

await build({ entryPoints: ['convex/lib/actor.ts'], outfile: 'tmp/action-records/actor.mjs',
  bundle: true, platform: 'node', format: 'esm', external: ['convex/*'],
  define: { 'process.env.JWT_SECRET': JSON.stringify(PRIVATE_SHARING_JWT_SECRET) },
});
const { authenticate } = await import(pathToFileURL(`${process.cwd()}/tmp/action-records/actor.mjs`));

test('authenticated session and distinct API credentials retain their identity separately from owner', async () => {
  const ctx = fixture({});
  await ctx.db.insert('agentApiKeys', { ownerDid: 'did:owner', keyHash: digest('second-key'), scopes: ['items:write'] });
  const human = await authenticate(ctx, credentials('owner'));
  const first = await authenticate(ctx, { apiKey: 'key-owner' });
  const second = await authenticate(ctx, { apiKey: 'second-key' });
  assert.equal(human.did, first.did);
  assert.equal(first.did, second.did);
  assert.equal(human.userId, first.userId);
  assert.equal(human.credential.kind, 'session');
  assert.equal(first.credential.kind, 'apiKey');
  assert.notEqual(first.credential.id, second.credential.id);
  assert.equal(first.credential.id, 'KEY-owner');
  assert.equal(human.credential.id, ctx.rows.accessSessions.find(s => s.subject === 'org-did:owner')._id);
  for (const actor of [human, first, second]) {
    assert.ok(!JSON.stringify(actor).includes('keyHash'));
    assert.ok(!JSON.stringify(actor).includes('tokenHash'));
    assert.ok(!JSON.stringify(actor).includes(credentials('owner').authToken));
  }
  await ctx.db.patch('KEY-owner', { revokedAt: Date.now() });
  await assert.rejects(() => authenticate(ctx, { apiKey: 'key-owner' }), /Invalid API key/);
});

test('legacy placeholder classification never presents JSON or absent proofs as verified', () => {
  assert.equal(legacyActionEvidence(), 'unsigned');
  assert.equal(legacyActionEvidence(JSON.stringify({ '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential'], issuer: 'did:old', credentialSubject: { id: 'did:old' } })), 'unsigned');
  assert.equal(legacyActionEvidence(JSON.stringify({ proof: { proofValue: 'genuine-history' } })), 'unverified');
  assert.equal(legacyActionEvidence('opaque historical signature'), 'unverified');
  assert.equal(legacyActionEvidence(JSON.stringify({ format: 'originals/asset', version: 4, eventLog: { log: [{ proof: { proofValue: 'signed' } }] } })), 'unverified');
});
