import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { getFunctionName } from 'convex/server';
import * as ed25519 from '@noble/ed25519';
import { MultibaseEncoding, multibaseEncode } from 'didwebvh-ts';
import { loadReplayModules, replayFixture } from './helpers/replay-fixture.mjs';
import { legacyActionEvidence } from '../shared/legacyActionEvidence.ts';
import {
  actionRecordDigest, actionRecordSigningInput, base58Decode, base58Encode, buildActionRecord,
  canonicalize, ed25519Multikey, encodeSignature, parseEd25519PublicKey, verifyActionRecord,
} from '../shared/actionRecord.ts';

const modules = await loadReplayModules('signed-action-records');
const extra = ['templates', 'actionRecords', 'agentReadHttp', 'users', 'lib/actionRecordSigner', 'turnkeyHelpers', 'migrations/remintUserDidDb'];
await build({
  entryPoints: extra.map(n => `convex/${n}.ts`), outdir: 'tmp/signed-action-records-extra', bundle: true,
  platform: 'node', format: 'esm', external: ['convex/*', '@turnkey/*'], outExtension: { '.js': '.mjs' },
});
for (const name of extra) modules[name] = await import(pathToFileURL(`${process.cwd()}/tmp/signed-action-records-extra/${name}.mjs`));
const { signActionRecords } = modules['lib/actionRecordSigner'];
const { turnkeySigningKey } = modules.turnkeyHelpers;
const digest = value => createHash('sha256').update(value).digest('hex');
const hex = bytes => Buffer.from(bytes).toString('hex');

/** A stand-in for the Turnkey API holding real Ed25519 keys, one per sub-org. */
async function fakeTurnkey() {
  const keys = new Map();
  const calls = [];
  let failing = false;
  const keyFor = async subOrgId => {
    if (!keys.has(subOrgId)) {
      const secret = ed25519.utils.randomSecretKey();
      keys.set(subOrgId, { secret, publicKey: await ed25519.getPublicKeyAsync(secret) });
    }
    return keys.get(subOrgId);
  };
  const client = { apiClient: () => ({
    getWallets: async ({ organizationId }) => ({ wallets: [{ walletId: `wallet-${organizationId}` }] }),
    getWalletAccounts: async ({ organizationId }) => ({ accounts: [
      { curve: 'CURVE_SECP256K1', address: '0xnot-this-one', organizationId },
      { curve: 'CURVE_ED25519', address: base58Encode((await keyFor(organizationId)).publicKey), organizationId },
    ] }),
    signRawPayload: async request => {
      calls.push(request);
      if (failing) throw new Error('turnkey unavailable: api-secret-must-not-be-stored');
      const signature = hex(await ed25519.signAsync(Buffer.from(request.payload.slice(2), 'hex'), (await keyFor(request.organizationId)).secret));
      return { activity: { result: { signRawPayloadResult: { r: signature.slice(0, 64), s: signature.slice(64) } } } };
    },
  }) };
  return {
    calls, keyFor, client,
    fail(value) { failing = value; },
    trusted: async user => ({ [user.did]: [ed25519Multikey((await keyFor(user.turnkeySubOrgId)).publicKey)] }),
  };
}

async function fixture() {
  const f = await replayFixture(modules);
  const query = f.ctx.db.query;
  f.ctx.db.query = table => { const q = query(table); q.order = () => q; return q; };
  f.ctx.runQuery = f.ctx.runMutation = (ref, args) => { const [ns, name] = getFunctionName(ref).split(':'); return modules[ns][name]._handler(f.ctx, args); };
  const turnkey = await fakeTurnkey();
  const signerJobs = () => f.effects.filter(([, ref]) => getFunctionName(ref) === 'actionRecordSigning:sign');
  return Object.assign(f, {
    turnkey, signerJobs,
    records: () => f.rows.actionRecords ?? [],
    payloads: (action) => (f.rows.actionRecords ?? []).map(r => JSON.parse(r.payload)).filter(p => !action || p.action === action),
    /** Runs queued signer jobs the way the scheduled action would; returns how many ran. */
    async runSigner() {
      const jobs = signerJobs().splice(0);
      for (const job of jobs) f.effects.splice(f.effects.indexOf(job), 1);
      for (const [, , args] of jobs) await signActionRecords(f.ctx, args.recordIds, subOrg => turnkeySigningKey(subOrg, turnkey.client));
      return jobs.length;
    },
    async addApiKey(raw, owner = f.owner.user) {
      return f.ctx.db.insert('agentApiKeys', { ownerDid: owner.did, keyHash: digest(raw), scopes: ['items:write', 'items:read', 'lists:read'], agentDid: 'did:agent:caller-claimed' });
    },
    viaKey: (ns, name, args, apiKey) => modules[ns][name]._handler(f.ctx, { ...args, apiKey }),
  });
}
/** Shape of a payload with per-call identifiers and clocks removed. */
const shape = payload => ({ ...payload, occurredAt: 0, subject: { ...payload.subject, itemId: 'ITEM' }, after: { ...payload.after, ...('checkedAt' in payload.after ? { checkedAt: 0 } : {}) }, ...(payload.origin ? { origin: { ...payload.origin, sourceItemId: 'SOURCE' } } : {}) });

test('canonical payload bytes are deterministic and reject values that have no single encoding', () => {
  const context = { occurredAt: 1700000000000, owner: { did: 'did:owner', userId: 'U' }, credential: { kind: 'session', id: 'S' } };
  const change = { action: 'item.completed', subject: { listId: 'L', itemId: 'I' }, before: { checked: false }, after: { checked: true, checkedAt: 5 } };
  const reordered = { after: { checkedAt: 5, checked: true }, before: { checked: false }, subject: { itemId: 'I', listId: 'L' }, action: 'item.completed' };
  const a = buildActionRecord(change, context), b = buildActionRecord(reordered, { credential: { id: 'S', kind: 'session' }, owner: { userId: 'U', did: 'did:owner' }, occurredAt: 1700000000000 });
  assert.deepEqual(a, b);
  assert.equal(a.payload, '{"action":"item.completed","after":{"checked":true,"checkedAt":5},"before":{"checked":false},"credential":{"id":"S","kind":"session"},"occurredAt":1700000000000,"owner":{"did":"did:owner","userId":"U"},"schema":"boop.action-record","signer":{"custody":"turnkey","did":"did:owner","keyType":"Ed25519"},"subject":{"itemId":"I","listId":"L"},"version":1}');
  assert.equal(a.digest, digest(a.payload));
  assert.equal(canonicalize({ b: [1, 'é"\n', null, true], a: {} }), '{"a":{},"b":[1,"é\\"\\n",null,true]}');
  assert.equal(canonicalize({ n: [1.5, -0, 1e21, 2 ** 60] }), '{"n":[1.5,0,1e+21,1152921504606847000]}');
  for (const bad of [{ a: undefined }, { a: NaN }, { a: Infinity }, { a: new Date(0) }, { a: () => 1 }]) assert.throws(() => canonicalize(bad));
  assert.equal(actionRecordSigningInput(a.payload).length, 64);
  assert.notDeepEqual(actionRecordSigningInput(a.payload).slice(32), actionRecordSigningInput(a.payload).slice(0, 32));
  // The local base58 codec agrees with the multibase implementation the DID code uses.
  const bytes = Uint8Array.from([0, 0, 237, 1, ...Array.from({ length: 32 }, (_, i) => (i * 37) % 256)]);
  assert.equal(`z${base58Encode(bytes)}`, multibaseEncode(bytes, MultibaseEncoding.BASE58_BTC));
  assert.deepEqual(base58Decode(base58Encode(bytes)), bytes);
  const key = bytes.slice(4);
  for (const form of [key, ed25519Multikey(key), `did:key:${ed25519Multikey(key)}#${ed25519Multikey(key)}`, base58Encode(key), `did:key:${base58Encode(key)}`]) {
    assert.deepEqual(parseEd25519PublicKey(form), key);
  }
  assert.equal(parseEd25519PublicKey('not base58 0OIl'), null);
});

test('create, complete, reopen, list create and rename each write one pending record bound to the authenticated session', async () => {
  const f = await fixture();
  const listId = await f.call('lists', 'createList', { assetDid: 'did:cel:new', name: 'Errands', createdAt: 1 });
  await f.call('lists', 'renameList', { listId, name: 'Chores' });
  const itemId = await f.call('items', 'addItem', { listId, name: 'Sweep', createdAt: 2 });
  await f.call('items', 'checkItem', { itemId, checkedAt: 3 });
  await f.call('items', 'uncheckItem', { itemId });
  const subject = { listId, listAssetDid: 'did:cel:new' };
  assert.deepEqual(f.payloads().map(p => [p.action, p.subject, p.before, p.after]), [
    ['list.created', subject, null, { name: 'Errands', kind: 'list' }],
    ['list.renamed', subject, { name: 'Errands' }, { name: 'Chores' }],
    ['item.created', { ...subject, itemId }, null, { name: 'Sweep', checked: false }],
    ['item.completed', { ...subject, itemId }, { checked: false }, { checked: true, checkedAt: 3 }],
    ['item.reopened', { ...subject, itemId }, { checked: true }, { checked: false }],
  ]);
  for (const [record, payload] of f.records().map((r, i) => [r, f.payloads()[i]])) {
    assert.deepEqual(payload.owner, { did: f.owner.user.did, userId: f.owner.user._id });
    assert.deepEqual(payload.credential, { kind: 'session', id: f.owner.accessSession._id });
    assert.deepEqual(payload.signer, { did: f.owner.user.did, custody: 'turnkey', keyType: 'Ed25519' });
    assert.deepEqual([payload.schema, payload.version], ['boop.action-record', 1]);
    assert.ok(Math.abs(payload.occurredAt - Date.now()) < 5000);
    assert.equal(record.payload, canonicalize(payload));
    assert.equal(record.digest, actionRecordDigest(record.payload));
    assert.deepEqual([record.status, record.attempts, record.signature, record.ownerUserId, record.listId, record.itemId],
      ['pending', 0, undefined, f.owner.user._id, listId, payload.subject.itemId]);
  }
  // No new unsigned placeholder JSON is written anywhere.
  assert.equal(f.rows.lists.find(l => l._id === listId).vcProof, undefined);
  assert.equal(f.rows.items.find(i => i._id === itemId).vcProofs, undefined);
  assert.equal(f.signerJobs().length, 5);
  assert.deepEqual(f.signerJobs().flatMap(([delay, , args]) => [delay, args.recordIds.length]), [0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
});

test('batch and individual actions produce equivalent records, including recurring generation', async () => {
  const single = await fixture(), batch = await fixture();
  for (const f of [single, batch]) {
    f.rows.items[0].recurrence = { frequency: 'daily' };
    f.rows.items.push({ ...structuredClone(f.rows.items[0]), _id: 'I2', name: 'Eggs', recurrence: undefined });
  }
  for (const itemId of ['I1', 'I2']) await single.call('items', 'checkItem', { itemId, checkedAt: 50 });
  for (const itemId of ['I1', 'I2']) await single.call('items', 'uncheckItem', { itemId });
  await batch.call('items', 'batchCheckItems', { itemIds: ['I1', 'I2'] });
  await batch.call('items', 'batchUncheckItems', { itemIds: ['I1', 'I2'] });

  const normalize = f => f.payloads().map(p => ({ ...shape(p), owner: 'OWNER', credential: 'CREDENTIAL', signer: 'SIGNER', item: p.action === 'item.created' ? 'NEXT' : p.subject.itemId }))
    .sort((a, b) => `${a.action}${a.item}`.localeCompare(`${b.action}${b.item}`));
  assert.deepEqual(normalize(batch), normalize(single));
  assert.deepEqual(batch.payloads().map(p => p.action).sort(), ['item.completed', 'item.completed', 'item.created', 'item.reopened', 'item.reopened']);
  for (const f of [single, batch]) {
    const [generated] = f.payloads('item.created');
    const next = f.rows.items.find(i => !['I1', 'I2'].includes(i._id));
    assert.deepEqual(generated.subject, { listId: 'L1', listAssetDid: 'did:list', itemId: next._id });
    assert.deepEqual(generated.origin, { kind: 'recurrence', sourceItemId: 'I1' });
    assert.deepEqual(generated.after, { name: 'Milk', checked: false });
    assert.deepEqual(f.payloads('item.completed').map(p => p.before), [{ checked: false }, { checked: false }]);
    assert.deepEqual(f.payloads('item.reopened').map(p => p.before), [{ checked: true }, { checked: true }]);
    // Historical evidence on the source item is neither replaced nor extended.
    assert.deepEqual(f.rows.items[0].vcProofs, [{ type: 'ExistingSignedProof', proof: 'do-not-replace', issuer: f.owner.user.did }]);
  }
  // One mutation queues one signer run for all of its records.
  assert.deepEqual(batch.signerJobs().map(([, , args]) => args.recordIds.length), [3, 2]);
  assert.deepEqual(single.signerJobs().map(([, , args]) => args.recordIds.length), [2, 1, 1, 1]);
});

test('a session and two API keys of one account are distinguishable from each other and from the owner', async () => {
  const f = await fixture();
  const first = await f.addApiKey('key-one'), second = await f.addApiKey('key-two');
  await f.call('items', 'checkItem', { itemId: 'I1', checkedAt: 1 });
  await f.viaKey('items', 'uncheckItem', { itemId: 'I1' }, 'key-one');
  await f.viaKey('items', 'checkItem', { itemId: 'I1', checkedAt: 2 }, 'key-two');
  await f.call('items', 'uncheckItem', { itemId: 'I1' }, f.collaborator);
  const [session, keyOne, keyTwo, editor] = f.payloads();
  assert.deepEqual([session, keyOne, keyTwo].map(p => p.credential), [
    { kind: 'session', id: f.owner.accessSession._id }, { kind: 'apiKey', id: first }, { kind: 'apiKey', id: second },
  ]);
  for (const payload of [session, keyOne, keyTwo]) assert.deepEqual(payload.owner, { did: f.owner.user.did, userId: f.owner.user._id });
  // An editor's action is authorized and signed by the editor's account, not the list owner's.
  assert.deepEqual(editor.owner, { did: f.collaborator.user.did, userId: f.collaborator.user._id });
  assert.equal(editor.signer.did, f.collaborator.user.did);
  assert.deepEqual(editor.credential, { kind: 'session', id: f.collaborator.accessSession._id });
  // Identity is never taken from caller input or key metadata, and no secret material is recorded.
  await assert.rejects(f.call('items', 'checkItem', { itemId: 'I1', checkedAt: 3, userDid: 'did:somebody-else' }), /Identity assertion/);
  const stored = JSON.stringify(f.records());
  for (const secret of ['did:agent:caller-claimed', 'key-one', 'key-two', digest('key-one'), f.owner.authToken, f.owner.accessSession.tokenHash, f.owner.user.turnkeySubOrgId]) {
    assert.ok(!stored.includes(secret), `records must not contain ${secret.slice(0, 12)}…`);
  }
  assert.equal(f.payloads().length, 4);
});

test('the signer signs the exact persisted bytes with the owner sub-org key and the result verifies independently', async () => {
  const f = await fixture();
  await f.call('items', 'checkItem', { itemId: 'I1', checkedAt: 7 });
  await f.call('items', 'uncheckItem', { itemId: 'I1' }, f.collaborator);
  assert.equal(await f.runSigner(), 2);
  const [byOwner, byEditor] = f.records();
  for (const [record, user] of [[byOwner, f.owner.user], [byEditor, f.collaborator.user]]) {
    const publicKey = (await f.turnkey.keyFor(user.turnkeySubOrgId)).publicKey;
    assert.deepEqual([record.status, record.attempts, record.error], ['signed', 1, undefined]);
    assert.equal(record.publicKeyMultibase, ed25519Multikey(publicKey));
    assert.equal(record.verificationMethod, `did:key:${record.publicKeyMultibase}#${record.publicKeyMultibase}`);
    assert.ok(Math.abs(record.signedAt - Date.now()) < 5000);
    const result = await verifyActionRecord(record, { trustedKeys: await f.turnkey.trusted(user) });
    assert.equal(result.verified, true);
    assert.equal(result.publicKeyMultibase, record.publicKeyMultibase);
    assert.deepEqual(result.payload, JSON.parse(record.payload));
    // Equivalent trust sources: a resolver, raw bytes, and the Turnkey address form.
    assert.equal((await verifyActionRecord(record, { resolvePublicKey: (did, method) => did === user.did && method === record.verificationMethod ? publicKey : null })).verified, true);
    assert.equal((await verifyActionRecord(record, { trustedKeys: { [user.did]: [base58Encode(publicKey)] } })).verified, true);
  }
  assert.deepEqual(f.turnkey.calls.map(c => [c.organizationId, c.encoding, c.hashFunction, c.payload.length]), [
    [f.owner.user.turnkeySubOrgId, 'PAYLOAD_ENCODING_HEXADECIMAL', 'HASH_FUNCTION_NO_OP', 130],
    [f.collaborator.user.turnkeySubOrgId, 'PAYLOAD_ENCODING_HEXADECIMAL', 'HASH_FUNCTION_NO_OP', 130],
  ]);
  assert.equal(f.turnkey.calls[0].payload, `0x${hex(actionRecordSigningInput(byOwner.payload))}`);
  assert.equal(f.turnkey.calls[0].signWith, base58Encode((await f.turnkey.keyFor(f.owner.user.turnkeySubOrgId)).publicKey));
  // The owner's key does not vouch for the editor's record, and vice versa.
  assert.deepEqual(await verifyActionRecord(byEditor, { trustedKeys: await f.turnkey.trusted(f.owner.user) }), { verified: false, reason: 'no_trusted_key' });
});

test('the verifier rejects altered payloads, signatures, keys, bindings and every non-signed status', async () => {
  const f = await fixture();
  await f.call('items', 'checkItem', { itemId: 'I1', checkedAt: 7 });
  await f.runSigner();
  const [record] = structuredClone(f.records());
  const trustedKeys = await f.turnkey.trusted(f.owner.user);
  const verify = (changes, options = { trustedKeys }) => verifyActionRecord({ ...record, ...changes }, options).then(r => r.verified ? 'verified' : r.reason);
  const rewrite = edit => { const payload = JSON.parse(record.payload); edit(payload); const text = canonicalize(payload); return { payload: text, digest: actionRecordDigest(text) }; };
  assert.equal(await verify({}), 'verified');

  // Payload: changed in place, changed with a matching digest, or re-serialized.
  assert.equal(await verify({ payload: record.payload.replace('"checkedAt":7', '"checkedAt":8') }), 'digest_mismatch');
  assert.equal(await verify(rewrite(p => { p.after.checkedAt = 8; })), 'bad_signature');
  assert.equal(await verify(rewrite(p => { p.credential = { kind: 'apiKey', id: 'forged-key' }; })), 'bad_signature');
  assert.equal(await verify(rewrite(p => { p.subject.itemId = 'another-item'; })), 'binding_mismatch');
  assert.equal(await verify({ payload: JSON.stringify(JSON.parse(record.payload), null, 1), digest: digest(JSON.stringify(JSON.parse(record.payload), null, 1)) }), 'non_canonical_payload');
  assert.equal(await verify({ payload: '{"schema":"boop.action-record"', digest: digest('{"schema":"boop.action-record"') }), 'malformed_payload');
  assert.equal(await verify(rewrite(p => { p.version = 2; })), 'malformed_payload');
  assert.equal(await verify({ digest: digest('something else') }), 'digest_mismatch');

  // Signature: flipped, truncated, or valid but for another payload.
  const signature = base58Decode(record.signature.slice(1));
  signature[5] ^= 1;
  assert.equal(await verify({ signature: encodeSignature(signature) }), 'bad_signature');
  assert.equal(await verify({ signature: encodeSignature(signature.slice(1)) }), 'not_signed');
  await f.call('items', 'uncheckItem', { itemId: 'I1' });
  await f.runSigner();
  assert.equal(await verify({ signature: f.records()[1].signature }), 'bad_signature');

  // Key: an attacker re-signs with their own key and supplies it in the record.
  const secret = ed25519.utils.randomSecretKey();
  const attackerKey = ed25519Multikey(await ed25519.getPublicKeyAsync(secret));
  const forged = rewrite(p => { p.after.checkedAt = 999; });
  const attack = { ...forged, signature: encodeSignature(await ed25519.signAsync(actionRecordSigningInput(forged.payload), secret)), publicKeyMultibase: attackerKey, verificationMethod: `did:key:${attackerKey}#${attackerKey}` };
  assert.equal(await verify(attack), 'untrusted_key');
  assert.equal(await verify({ ...attack, publicKeyMultibase: undefined, verificationMethod: undefined }), 'bad_signature');
  assert.equal(await verify(attack, { trustedKeys: { [f.owner.user.did]: [attackerKey] } }), 'verified', 'sanity: the forgery is otherwise well-formed');
  assert.equal(await verify({}, { trustedKeys: { [f.owner.user.did]: [attackerKey] } }), 'untrusted_key');
  assert.equal(await verify({}, { trustedKeys: { 'did:someone-else': trustedKeys[f.owner.user.did] } }), 'no_trusted_key');
  assert.equal(await verify({}, {}), 'no_trusted_key');
  assert.equal(await verify({}, { resolvePublicKey: () => null }), 'no_trusted_key');
  assert.equal(await verify({ publicKeyMultibase: attackerKey }), 'binding_mismatch', 'record key and verification method must agree');

  // Binding: the attribution a record is filed or shown under must match what was signed.
  assert.equal(await verify({ ownerUserId: f.collaborator.user._id }), 'binding_mismatch');
  assert.equal(await verify({ listId: 'another-list' }), 'binding_mismatch');
  assert.equal(await verify({ itemId: 'another-item' }), 'binding_mismatch');
  assert.equal(await verify({}, { trustedKeys, expected: { ownerDid: f.collaborator.user.did } }), 'binding_mismatch');
  assert.equal(await verify({}, { trustedKeys, expected: { credential: { kind: 'apiKey', id: f.owner.accessSession._id } } }), 'binding_mismatch');
  assert.equal(await verify({}, { trustedKeys, expected: { ownerDid: f.owner.user.did, credential: { kind: 'session', id: f.owner.accessSession._id } } }), 'verified');
  // Naming another account as owner needs that account's key, even with the signer's key attached.
  const reattributed = rewrite(p => { p.owner = { did: f.collaborator.user.did, userId: f.collaborator.user._id }; });
  assert.equal(await verify({ ...reattributed, ownerUserId: f.collaborator.user._id }), 'binding_mismatch');
  const fully = rewrite(p => { p.owner = { did: f.collaborator.user.did, userId: f.collaborator.user._id }; p.signer.did = f.collaborator.user.did; });
  assert.equal(await verify({ ...fully, ownerUserId: f.collaborator.user._id }, { trustedKeys: { ...trustedKeys, ...await f.turnkey.trusted(f.collaborator.user) } }), 'untrusted_key');

  for (const status of ['pending', 'failed', 'unsigned']) assert.equal(await verify({ status }), 'not_signed');
  assert.equal(await verify({ signature: undefined }), 'not_signed');
});

test('signing failures never touch the write, retry with backoff, then settle as failed with a non-secret reason', async () => {
  const f = await fixture();
  f.turnkey.fail(true);
  await f.call('items', 'checkItem', { itemId: 'I1', checkedAt: 7 });
  assert.equal(f.rows.items[0].checked, true, 'the mutation committed without any signing');
  const delays = [];
  for (let attempt = 1; attempt <= 4; attempt++) {
    const [[delay]] = f.signerJobs();
    delays.push(delay);
    assert.equal(await f.runSigner(), 1);
    assert.deepEqual([f.records()[0].status, f.records()[0].attempts], [attempt < 4 ? 'pending' : 'failed', attempt]);
  }
  assert.deepEqual(delays, [0, 60_000, 300_000, 1_500_000]);
  assert.equal(f.signerJobs().length, 0, 'retries are bounded');
  const [failed] = f.records();
  assert.equal(failed.error, 'signing_request_failed');
  assert.deepEqual([failed.signature, failed.signedAt, failed.publicKeyMultibase], [undefined, undefined, undefined]);
  assert.ok(!JSON.stringify(f.records()).includes('api-secret'), 'provider error text is never persisted');
  assert.equal(f.rows.items[0].checked, true);
  assert.deepEqual(await verifyActionRecord(failed, { trustedKeys: await f.turnkey.trusted(f.owner.user) }), { verified: false, reason: 'not_signed' });

  // A failed lookup of the key itself is retried the same way.
  const lookup = await fixture();
  await lookup.call('items', 'checkItem', { itemId: 'I1', checkedAt: 7 });
  const [[, , job]] = lookup.signerJobs().splice(0);
  await signActionRecords(lookup.ctx, job.recordIds, async () => { throw new Error('No wallets found for sub-org'); });
  assert.deepEqual([lookup.records()[0].status, lookup.records()[0].attempts], ['pending', 1]);

  // Operator recovery once the outage is over.
  f.turnkey.fail(false);
  assert.equal(await modules.actionRecords.requeueFailed._handler(f.ctx, { recordIds: [failed._id] }), 1);
  await f.runSigner();
  assert.deepEqual([f.records()[0].status, f.records()[0].error], ['signed', undefined]);
  assert.equal((await verifyActionRecord(f.records()[0], { trustedKeys: await f.turnkey.trusted(f.owner.user) })).verified, true);
});

test('no caller-supplied value can make recording fail the write', async () => {
  const f = await fixture();
  for (const checkedAt of [1700000000000.5, -100000, NaN, Infinity]) {
    await f.call('items', 'checkItem', { itemId: 'I1', checkedAt });
  }
  await f.call('items', 'addItem', { listId: 'L1', name: 'lone surrogate \ud800 "quoted" \n\u2028 ünïcode', createdAt: 1 });
  assert.deepEqual(f.payloads('item.completed').map(p => p.after.checkedAt), [1700000000000.5, -100000, null, null]);
  await f.runSigner();
  const trustedKeys = await f.turnkey.trusted(f.owner.user);
  for (const record of f.records()) {
    assert.equal(record.status, 'signed');
    assert.equal((await verifyActionRecord(JSON.parse(JSON.stringify(record)), { trustedKeys })).verified, true);
  }
});

test('an account without a Turnkey sub-org gets an explicit unsigned record and no signer run', async () => {
  const f = await fixture();
  // API-key authentication does not depend on a sub-org; the account simply has none.
  await f.addApiKey('key-one');
  delete f.rows.users[0].turnkeySubOrgId;
  await f.viaKey('items', 'checkItem', { itemId: 'I1', checkedAt: 7 }, 'key-one');
  const [record] = f.records();
  assert.deepEqual([record.status, record.signature, record.attempts], ['unsigned', undefined, 0]);
  assert.equal(f.signerJobs().length, 0);
  assert.equal(f.rows.items[0].checked, true);
  assert.deepEqual(await verifyActionRecord(record, { trustedKeys: { [f.owner.user.did]: ['z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'] } }), { verified: false, reason: 'not_signed' });

  // A sub-org removed between the write and the signer run is also recorded as unsigned.
  const g = await fixture();
  await g.call('items', 'checkItem', { itemId: 'I1', checkedAt: 7 });
  delete g.rows.users[0].turnkeySubOrgId;
  await g.runSigner();
  assert.deepEqual([g.records()[0].status, g.turnkey.calls.length], ['unsigned', 0]);
});

test('signing is idempotent: repeated and late runs never re-sign or replace a stored signature', async () => {
  const f = await fixture();
  await f.call('items', 'checkItem', { itemId: 'I1', checkedAt: 7 });
  const [[, , job]] = f.signerJobs();
  await f.runSigner();
  const signed = structuredClone(f.records()[0]);
  const resolve = subOrg => turnkeySigningKey(subOrg, f.turnkey.client);
  await signActionRecords(f.ctx, job.recordIds, resolve);
  await signActionRecords(f.ctx, [...job.recordIds, ...job.recordIds], resolve);
  assert.equal(f.turnkey.calls.length, 1);
  assert.deepEqual(f.records()[0], signed);
  // A duplicate delivery of a different result cannot overwrite the first.
  await modules.actionRecords.settle._handler(f.ctx, { outcomes: [
    { kind: 'signed', recordId: signed._id, digest: signed.digest, signature: 'zOther', publicKeyMultibase: 'zOther', verificationMethod: 'did:key:zOther' },
    { kind: 'failed', recordId: signed._id, reason: 'late', retry: true },
    { kind: 'unsigned', recordId: signed._id },
  ] });
  assert.deepEqual(f.records()[0], signed);
  assert.equal(f.signerJobs().length, 0);
  // A record deleted before its signer runs is skipped.
  await f.call('items', 'uncheckItem', { itemId: 'I1' });
  await f.call('items', 'removeItem', { itemId: 'I1' });
  assert.equal(await f.runSigner(), 1);
  assert.equal(f.turnkey.calls.length, 1);
});

test('the signer refuses bytes or bindings that changed after the write, without calling Turnkey', async () => {
  const f = await fixture();
  await f.call('items', 'checkItem', { itemId: 'I1', checkedAt: 7 });
  await f.call('items', 'uncheckItem', { itemId: 'I1' });
  await f.call('items', 'checkItem', { itemId: 'I1', checkedAt: 9 });
  await f.call('items', 'uncheckItem', { itemId: 'I1' }, f.collaborator);
  const [edited, reserialized, misfiled, renamed] = f.rows.actionRecords;
  edited.payload = edited.payload.replace('"checkedAt":7', '"checkedAt":8');
  reserialized.payload = JSON.stringify(JSON.parse(reserialized.payload), null, 2);
  reserialized.digest = digest(reserialized.payload);
  misfiled.ownerUserId = f.collaborator.user._id;
  f.rows.users[1].did = 'did:collaborator-reminted';
  await f.runSigner();
  assert.deepEqual(f.records().map(r => [r.status, r.error, r.attempts]), [
    ['failed', 'payload_integrity', 1], ['failed', 'payload_integrity', 1],
    ['failed', 'owner_binding_changed', 1], ['failed', 'owner_binding_changed', 1],
  ]);
  assert.equal(f.turnkey.calls.length, 0);
  assert.equal(f.signerJobs().length, 0, 'integrity failures are not retried');
  // A signature that does not verify under the looked-up key is never stored.
  const g = await fixture();
  await g.call('items', 'checkItem', { itemId: 'I1', checkedAt: 7 });
  const [[, , job]] = g.signerJobs().splice(0);
  await signActionRecords(g.ctx, job.recordIds, async () => ({ publicKey: (await g.turnkey.keyFor('org')).publicKey, sign: async () => new Uint8Array(64) }));
  assert.deepEqual([g.records()[0].status, g.records()[0].signature, g.records()[0].attempts], ['pending', undefined, 1]);
});

test('the sweep re-queues signer runs that never reported back, within the same attempt bound', async () => {
  const f = await fixture();
  await f.call('items', 'checkItem', { itemId: 'I1', checkedAt: 7 });
  await f.call('items', 'uncheckItem', { itemId: 'I1' });
  f.signerJobs().splice(0).forEach(job => f.effects.splice(f.effects.indexOf(job), 1)); // both signer runs are lost
  const sweep = () => modules.actionRecords.sweepStalePending._handler(f.ctx, {});
  for (const row of f.rows.actionRecords) row._creationTime = Date.now(); // the fixture numbers rows instead of timing them
  await sweep();
  assert.equal(f.signerJobs().length, 0, 'fresh pending records are left to their scheduled run');
  const hourAgo = Date.now() - 61 * 60_000;
  f.rows.actionRecords[0]._creationTime = hourAgo;
  f.rows.actionRecords[1]._creationTime = hourAgo;
  f.rows.actionRecords[1].lastAttemptAt = Date.now(); // waiting on a backoff retry
  await sweep();
  assert.deepEqual(f.signerJobs().map(([delay, , args]) => [delay, args.recordIds]), [[0, [f.rows.actionRecords[0]._id]]]);
  assert.deepEqual(f.records().map(r => r.attempts), [1, 0]);
  for (let i = 0; i < 3; i++) { f.rows.actionRecords[0].lastAttemptAt = hourAgo; await sweep(); }
  assert.deepEqual([f.records()[0].status, f.records()[0].error, f.records()[0].attempts], ['failed', 'signer_unresponsive', 4]);
  assert.equal(f.records()[1].status, 'pending');
});

test('template creation records the list and every item through the same path and signs them in one run', async () => {
  const f = await fixture();
  f.rows.listTemplates = [{ _id: 'T1', name: 'Saved', ownerDid: f.owner.user.did, isPublic: false, items: [{ name: 'Step one', order: 0 }, { name: 'Step two', order: 1 }] }];
  const listId = await f.call('templates', 'createListFromTemplate', { templateId: 'T1', listName: 'From template', assetDid: 'did:cel:template' });
  const origin = { kind: 'template', source: 'saved:T1' };
  assert.deepEqual(f.payloads().map(p => [p.action, p.after, p.origin]), [
    ['list.created', { name: 'From template', kind: 'list' }, origin],
    ['item.created', { name: 'Step one', checked: false }, origin],
    ['item.created', { name: 'Step two', checked: false }, origin],
  ]);
  // Apart from its origin, a template item's record is the record ordinary creation writes.
  const direct = await f.call('items', 'addItem', { listId, name: 'Step one', createdAt: 1 });
  const [fromTemplate, , added] = f.payloads('item.created');
  assert.equal(added.subject.itemId, direct);
  assert.deepEqual(shape({ ...fromTemplate, origin: undefined }), shape({ ...added, origin: undefined }));
  assert.deepEqual(f.signerJobs().map(([, , args]) => args.recordIds.length), [3, 1]);
  await f.runSigner();
  const trustedKeys = await f.turnkey.trusted(f.owner.user);
  for (const record of f.records()) assert.equal((await verifyActionRecord(record, { trustedKeys })).verified, true);
  assert.equal(f.turnkey.calls.length, 4);
});

test('copying a list records the new list only, and notes are recorded as notes', async () => {
  const f = await fixture();
  const { listId } = await f.call('lists', 'copyList', { sourceListId: 'L1', assetDid: 'did:cel:copy', celEnvelope: '{}', name: 'Copy', createdAt: 5 });
  const noteId = await f.call('lists', 'createList', { assetDid: 'did:cel:note', name: 'Thoughts', createdAt: 6, kind: 'note' });
  assert.deepEqual(f.payloads().map(p => [p.action, p.subject, p.after, p.origin]), [
    ['list.created', { listId, listAssetDid: 'did:cel:copy' }, { name: 'Copy', kind: 'list' }, { kind: 'copy', sourceListId: 'L1' }],
    ['list.created', { listId: noteId, listAssetDid: 'did:cel:note' }, { name: 'Thoughts', kind: 'note' }, undefined],
  ]);
  assert.equal(f.rows.items.find(i => i.listId === listId).vcProofs, undefined);
});

test('records are readable with the access of their subject and are removed with it', async () => {
  const f = await fixture();
  const stranger = await (await import('./helpers/auth-fixture.mjs')).createAuthFixture('did:stranger-records');
  f.rows.users.push(stranger.user); f.rows.accessSessions.push(stranger.accessSession);
  f.rows.publications.length = 0; // private list
  await f.call('lists', 'renameList', { listId: 'L1', name: 'Food' });
  await f.call('items', 'checkItem', { itemId: 'I1', checkedAt: 7 });
  await f.call('items', 'addItem', { listId: 'L1', name: 'Bread', createdAt: 8 });
  await f.runSigner();
  const itemRecords = await f.call('actionRecords', 'getItemActionRecords', { itemId: 'I1' }, f.collaborator);
  assert.deepEqual(itemRecords.map(r => JSON.parse(r.payload).action), ['item.completed']);
  const listRecords = await f.call('actionRecords', 'getListActionRecords', { listId: 'L1' }, f.collaborator);
  assert.deepEqual(listRecords.map(r => JSON.parse(r.payload).action), ['list.renamed']);
  // What a reader receives is sufficient for independent verification, and nothing internal.
  assert.equal((await verifyActionRecord(itemRecords[0], { trustedKeys: await f.turnkey.trusted(f.owner.user) })).verified, true);
  assert.deepEqual(Object.keys(itemRecords[0]).sort(), ['_id', 'digest', 'error', 'itemId', 'listId', 'ownerUserId', 'payload', 'publicKeyMultibase', 'signature', 'signedAt', 'status', 'verificationMethod']);
  await assert.rejects(f.call('actionRecords', 'getItemActionRecords', { itemId: 'I1' }, stranger));
  await assert.rejects(f.call('actionRecords', 'getListActionRecords', { listId: 'L1' }, stranger));

  // The HTTP read hands an outside verifier the same evidence, JSON round trip included.
  await f.addApiKey('reader-key');
  await f.addApiKey('stranger-key', stranger.user);
  const http = (query, apiKey) => modules.agentReadHttp.getActionRecords._handler(f.ctx, new Request(`https://example.test/api/v1/action-records?${query}`, { headers: { 'X-API-Key': apiKey } }));
  const fetched = await http('itemId=I1', 'reader-key');
  assert.equal(fetched.status, 200);
  const { records } = await fetched.json();
  assert.deepEqual(records.map(r => r._id), itemRecords.map(r => r._id));
  assert.equal((await verifyActionRecord(records[0], { trustedKeys: await f.turnkey.trusted(f.owner.user) })).verified, true);
  assert.deepEqual((await (await http('listId=L1', 'reader-key')).json()).records.map(r => JSON.parse(r.payload).action), ['list.renamed']);
  assert.equal((await http('itemId=I1&listId=L1', 'reader-key')).status, 400);

  // The standalone verifier accepts that export against a pinned key, and nothing else.
  const exported = 'tmp/signed-action-records-extra/export.json';
  const pin = Object.entries(await f.turnkey.trusted(f.owner.user)).map(([did, [key]]) => `${did}=${key}`);
  const cli = (...args) => spawnSync(process.execPath, ['scripts/verify-action-records.mjs', ...args], { encoding: 'utf8' });
  writeFileSync(exported, JSON.stringify({ records }));
  const accepted = cli(exported, ...pin);
  assert.deepEqual([accepted.status, accepted.stdout.trim().split('\t').slice(1, 3)], [0, ['verified', 'item.completed']]);
  assert.equal(cli(exported, `${f.owner.user.did}=z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK`).status, 1);
  writeFileSync(exported, JSON.stringify({ records: [{ ...records[0], payload: records[0].payload.replace('"checkedAt":7', '"checkedAt":8') }] }));
  const refused = cli(exported, ...pin);
  assert.deepEqual([refused.status, refused.stdout.trim().split('\t').slice(1)], [1, ['REJECTED', 'digest_mismatch']]);
  assert.equal(cli(exported).status, 2);
  assert.equal((await http('', 'reader-key')).status, 400);
  for (const query of ['itemId=I1', 'listId=L1']) {
    const denied = await http(query, 'stranger-key');
    assert.notEqual(denied.status, 200);
    assert.equal((await denied.json()).records, undefined);
  }

  await f.call('items', 'removeItem', { itemId: 'I1' });
  assert.deepEqual(f.payloads().map(p => p.action), ['list.renamed', 'item.created']);
  await f.call('items', 'batchDeleteItems', { itemIds: [f.payloads('item.created')[0].subject.itemId] });
  assert.deepEqual(f.payloads().map(p => p.action), ['list.renamed']);
  await f.call('lists', 'deleteList', { listId: 'L1' });
  assert.deepEqual(f.records(), []);

  // Account erasure removes the records of that account's lists and items as well.
  const g = await fixture();
  await g.call('lists', 'renameList', { listId: 'L1', name: 'Food' });
  await g.call('items', 'checkItem', { itemId: 'I1', checkedAt: 7 });
  await g.call('items', 'uncheckItem', { itemId: 'I1' }, g.collaborator);
  assert.equal(g.records().length, 3);
  await g.call('users', 'deleteUserData', { userId: g.owner.user._id });
  for (let step = 0; step < 40 && g.rows.lists.length; step++) await modules.users.continueUserDeletion._handler(g.ctx, { userId: g.owner.user._id });
  assert.equal(g.rows.lists.length, 0);
  assert.deepEqual(g.records(), []);
});

test('historical placeholders stay untouched and unsigned; a DID re-mint never rewrites signed payloads', async () => {
  const f = await fixture();
  const placeholder = { type: 'ItemAuthorshipCredential', issuer: f.owner.user.did, issuanceDate: 1, action: 'created', actorDid: f.owner.user.did,
    proof: JSON.stringify({ '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential', 'ItemAuthorshipCredential'], issuer: f.owner.user.did, credentialSubject: { id: f.owner.user.did } }) };
  f.rows.items[0].vcProofs = [placeholder];
  await f.call('items', 'checkItem', { itemId: 'I1', checkedAt: 7 });
  await f.runSigner();
  assert.deepEqual(f.rows.items[0].vcProofs, [placeholder]);
  assert.equal(legacyActionEvidence(f.rows.items[0].vcProofs[0].proof), 'unsigned');
  assert.equal(legacyActionEvidence(f.records()[0].payload), 'unverified', 'a new record is never mistaken for a legacy placeholder');

  const before = structuredClone(f.records());
  const oldDid = f.owner.user.did;
  const [signingKey] = Object.values(await f.turnkey.trusted(f.owner.user))[0];
  const result = await modules['migrations/remintUserDidDb'].applyRemint._handler(f.ctx, { userId: f.owner.user._id, oldDid, newDid: 'did:webvh:reminted' });
  assert.ok(result.rewritten > 0);
  assert.equal(f.rows.items[0].createdByDid, 'did:webvh:reminted', 'sanity: the re-mint did rewrite mutable attribution');
  assert.deepEqual(f.records(), before);
  // The record keeps naming the DID that authorized it; trust is pinned for that DID.
  assert.equal((await verifyActionRecord(f.records()[0], { trustedKeys: { [oldDid]: [signingKey] } })).verified, true);
  assert.deepEqual(await verifyActionRecord(f.records()[0], { trustedKeys: { 'did:webvh:reminted': [signingKey] } }), { verified: false, reason: 'no_trusted_key' });
});
