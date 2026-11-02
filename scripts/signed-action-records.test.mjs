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
import { createAuthFixture } from './helpers/auth-fixture.mjs';
import { legacyActionEvidence } from '../shared/legacyActionEvidence.ts';
import {
  actionRecordDigest, actionRecordSigningInput, actionSubjectKey, assertionKeyAt, base58Decode, base58Encode, buildActionRecord,
  canonicalize, clientActionChanges, describeActionRecord, ed25519Multikey, encodeSignature, parseEd25519PublicKey, verifyActionRecord,
} from '../shared/actionRecord.ts';

const modules = await loadReplayModules('signed-action-records');
const extra = ['templates', 'actionRecords', 'agentReadHttp', 'users', 'didResources', 'migrations/remintUserDidDb'];
await build({
  entryPoints: extra.map(n => `convex/${n}.ts`), outdir: 'tmp/signed-action-records-extra', bundle: true,
  platform: 'node', format: 'esm', external: ['convex/*', '@turnkey/*'], outExtension: { '.js': '.mjs' },
});
for (const name of extra) modules[name] = await import(pathToFileURL(`${process.cwd()}/tmp/signed-action-records-extra/${name}.mjs`));
// The device-side signer, with the Turnkey session modules stubbed out: tests
// inject the author and a mock Turnkey (local keys) through its deps instead.
await build({
  entryPoints: ['src/lib/actionSigning.ts'], outfile: 'tmp/signed-action-records-extra/actionSigning.mjs', bundle: true,
  platform: 'node', format: 'esm',
  plugins: [{ name: 'stub-session', setup(b) {
    b.onResolve({ filter: /\.\/(turnkeySession|authorIdentity)$/ }, ({ path }) => ({ path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const authorSigningReady=async()=>false;export const turnkeyAuthorBackend=()=>({});export const currentAuthor=()=>null;' }));
  } }],
});
const { signActions } = await import(pathToFileURL(`${process.cwd()}/tmp/signed-action-records-extra/actionSigning.mjs`));
// TURNKEY IS MOCKED (scripts/helpers/author-did-fixture.ts): local Ed25519 keys sign exactly the bytes given.
await build({ entryPoints: ['scripts/helpers/author-did-fixture.ts'], outfile: 'tmp/signed-action-records-extra/author-did-fixture.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent' });
const { mockTurnkey, mintAuthor, updateAuthor } = await import(pathToFileURL(`${process.cwd()}/tmp/signed-action-records-extra/author-did-fixture.mjs`));
const digest = value => createHash('sha256').update(value).digest('hex');
const VM = did => `${did}#orig-1`;

async function fixture() {
  const f = await replayFixture(modules);
  const query = f.ctx.db.query;
  f.ctx.db.query = table => { const q = query(table); q.order = () => q; return q; };
  f.ctx.runQuery = f.ctx.runMutation = (ref, args) => { const [ns, name] = getFunctionName(ref).split(':'); return modules[ns][name]._handler(f.ctx, args); };
  return Object.assign(f, {
    records: () => f.rows.actionRecords ?? [],
    payloads: (action) => (f.rows.actionRecords ?? []).map(r => JSON.parse(r.payload)).filter(p => !action || p.action === action),
    attested: () => (f.rows.actionRecords ?? []).map(r => JSON.parse(r.attested)),
    described: () => (f.rows.actionRecords ?? []).map(describeActionRecord),
    /**
     * Give `who` a real author did:webvh (shared/authorDid.ts) served by this
     * backend, as #286 re-genesis does: the account and its rows move onto it.
     * Turnkey is mocked with local keys; nothing here talks to Turnkey.
     */
    async author(who = f.owner) {
      const turnkey = await mockTurnkey();
      const path = `user-${who.user.turnkeySubOrgId.slice(0, 16)}`;
      const minted = await mintAuthor(turnkey, { path });
      const oldDid = who.user.did;
      for (const row of Object.values(f.rows).flat()) {
        for (const key of ['did', 'ownerDid', 'createdByDid', 'checkedByDid']) if (row[key] === oldDid) row[key] = minted.did;
      }
      await f.ctx.db.insert('didLogs', { userDid: minted.did, path, log: minted.jsonl, scid: minted.did.split(':')[2], versionId: minted.versionId, author: true, updatedAt: 1 });
      const author = { subOrgId: who.user.turnkeySubOrgId, did: minted.did, log: minted.jsonl, versionId: minted.versionId, keys: minted.keys };
      const deps = { author: () => author, ready: async () => true, backend: turnkey, now: () => Date.now() };
      const minting = turnkey.calls.length; // the genesis itself was signed by the author key
      return {
        ...author, turnkey, deps, who,
        /** Addresses of the keys that signed anything after the DID was minted. */
        signedWith: () => turnkey.calls.slice(minting).filter(c => c.op === 'sign').map(c => c.address),
        sign: (mutation, args, overrides = {}) => signActions(mutation, args, { ...deps, ...overrides }),
        /** Call a mutation as the device does: sign the actions it will record, then send. */
        async call(ns, name, args, overrides = {}) {
          const signed = await signActions(name, args, { ...deps, ...overrides });
          return f.call(ns, name, { ...args, ...(signed ? { signed } : {}) }, who);
        },
        /** Resolver for verifyActionRecord: the log this backend serves for the DID. */
        resolveDidLog: did => f.rows.didLogs?.find(l => l.userDid === did)?.log ?? null,
      };
    },
    async addApiKey(raw, owner = f.owner.user) {
      return f.ctx.db.insert('agentApiKeys', { ownerDid: owner.did, keyHash: digest(raw), scopes: ['items:write', 'items:read', 'lists:read'], agentDid: 'did:agent:caller-claimed' });
    },
    viaKey: (ns, name, args, apiKey) => modules[ns][name]._handler(f.ctx, { ...args, apiKey }),
  });
}

/** A record's signed statement with per-call identifiers and clocks removed. */
const shape = payload => ({ ...payload, signedAt: 0, subject: Object.fromEntries(Object.keys(payload.subject).map(k => [k, 'SUBJECT'])) });
const signedRows = f => f.records().map(r => [r.status, r.error]);

test('canonical payload bytes are deterministic, the client mapping names what the server records, and keys parse in every form', () => {
  const author = { did: 'did:webvh:s:boop.ad:u', verificationMethod: 'did:webvh:s:boop.ad:u#orig-1', versionId: '1-abc' };
  const change = { action: 'item.completed', subject: { itemId: 'I' }, after: { checked: true } };
  const reordered = { after: { checked: true }, subject: { itemId: 'I' }, action: 'item.completed' };
  const a = buildActionRecord(change, author, 1700000000000), b = buildActionRecord(reordered, { versionId: '1-abc', verificationMethod: author.verificationMethod, did: author.did }, 1700000000000);
  assert.deepEqual(a, b);
  assert.equal(a.payload, '{"action":"item.completed","after":{"checked":true},"author":{"did":"did:webvh:s:boop.ad:u","verificationMethod":"did:webvh:s:boop.ad:u#orig-1","versionId":"1-abc"},"schema":"boop.action-record","signedAt":1700000000000,"subject":{"itemId":"I"},"version":2}');
  assert.equal(a.digest, digest(a.payload));
  // Unsigned records state only the author DID: no key, version or signing time is claimed.
  assert.equal(buildActionRecord(change, { did: author.did }).payload, '{"action":"item.completed","after":{"checked":true},"author":{"did":"did:webvh:s:boop.ad:u"},"schema":"boop.action-record","subject":{"itemId":"I"},"version":2}');
  assert.equal(canonicalize({ b: [1, 'é"\n', null, true], a: {} }), '{"a":{},"b":[1,"é\\"\\n",null,true]}');
  assert.equal(canonicalize({ n: [1.5, -0, 1e21, 2 ** 60] }), '{"n":[1.5,0,1e+21,1152921504606847000]}');
  for (const bad of [{ a: undefined }, { a: NaN }, { a: Infinity }, { a: new Date(0) }, { a: () => 1 }]) assert.throws(() => canonicalize(bad));
  assert.equal(actionRecordSigningInput(a.payload).length, 64);
  assert.notDeepEqual(actionRecordSigningInput(a.payload).slice(32), actionRecordSigningInput(a.payload).slice(0, 32));
  assert.notDeepEqual(actionRecordSigningInput(a.payload, 1).slice(0, 32), actionRecordSigningInput(a.payload, 2).slice(0, 32), 'each version is its own signing domain');

  // What the device signs for each mutation is keyed by the subject the server will file it under.
  assert.deepEqual(clientActionChanges('checkItem', { itemId: 'I', checkedAt: 5 }), [change]);
  assert.deepEqual(clientActionChanges('uncheckItem', { itemId: 'I' }), [{ action: 'item.reopened', subject: { itemId: 'I' }, after: { checked: false } }]);
  assert.deepEqual(clientActionChanges('batchCheckItems', { itemIds: ['I', 'J', 'I'] }).map(c => c.subject.itemId), ['I', 'J']);
  assert.deepEqual(clientActionChanges('addItem', { listId: 'L', name: 'Milk', createdAt: 1 }), [{ action: 'item.created', subject: { listId: 'L' }, after: { name: 'Milk' } }]);
  assert.deepEqual(clientActionChanges('createList', { name: 'Notes', kind: 'note', createdAt: 1 }), [{ action: 'list.created', subject: { createdAt: 1 }, after: { name: 'Notes', kind: 'note' } }]);
  assert.deepEqual(clientActionChanges('createList', { name: 'Notes', createdAt: NaN }), []);
  assert.deepEqual(clientActionChanges('renameList', { listId: 'L', name: 'Food' }), [{ action: 'list.renamed', subject: { listId: 'L' }, after: { name: 'Food' } }]);
  assert.deepEqual(clientActionChanges('removeItem', { itemId: 'I' }), []);
  assert.deepEqual(clientActionChanges('checkItem', { itemId: 7 }), []);
  assert.equal(actionSubjectKey(change), '{"itemId":"I"}');

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

test('create, complete, reopen, list create and rename each write one record: the author statement, and boop\'s attested context beside it', async () => {
  const f = await fixture();
  // A pre-Originals-5 client's queued create still sends an asset DID; it is ignored, so
  // records name no asset until the owner's device mints the list's Original.
  // A pre-Originals-5 client's queued create still sends an asset DID; it is ignored, so
  // records name no asset until the owner's device mints the list's Original.
  const listId = await f.call('lists', 'createList', { assetDid: 'did:cel:new', name: 'Errands', createdAt: 1 });
  await f.call('lists', 'renameList', { listId, name: 'Chores' });
  const itemId = await f.call('items', 'addItem', { listId, name: 'Sweep', createdAt: 2 });
  await f.call('items', 'checkItem', { itemId, checkedAt: 3 });
  await f.call('items', 'uncheckItem', { itemId });
  assert.deepEqual(f.payloads().map(p => [p.action, p.subject, p.after]), [
    ['list.created', { createdAt: 1 }, { name: 'Errands', kind: 'list' }],
    ['list.renamed', { listId }, { name: 'Chores' }],
    ['item.created', { listId }, { name: 'Sweep' }],
    ['item.completed', { itemId }, { checked: true }],
    ['item.reopened', { itemId }, { checked: false }],
  ]);
  const context = { listId, userId: f.owner.user._id, credential: { kind: 'session', id: f.owner.accessSession._id } };
  assert.deepEqual(f.attested().map(({ occurredAt, ...rest }) => (assert.ok(Math.abs(occurredAt - Date.now()) < 5000), rest)), [
    { ...context, before: null },
    { ...context, before: { name: 'Errands' } },
    { ...context, itemId, before: null },
    { ...context, itemId, before: { checked: false }, checkedAt: 3 },
    { ...context, itemId, before: { checked: true } },
  ]);
  for (const record of f.records()) {
    const payload = JSON.parse(record.payload);
    assert.deepEqual(payload.author, { did: f.owner.user.did }, 'nothing offered a signature, so no key or time is claimed');
    assert.equal(payload.signedAt, undefined);
    assert.deepEqual([payload.schema, payload.version], ['boop.action-record', 2]);
    assert.equal(record.payload, canonicalize(payload));
    assert.equal(record.digest, actionRecordDigest(record.payload));
    assert.equal(record.attested, canonicalize(JSON.parse(record.attested)));
    assert.deepEqual([record.status, record.signature, record.error, record.ownerUserId, record.listId], ['unsigned', undefined, undefined, f.owner.user._id, listId]);
    assert.equal(record.itemId, payload.action.startsWith('item.') ? itemId : undefined);
  }
  // No new unsigned placeholder JSON is written anywhere.
  assert.equal(f.rows.lists.find(l => l._id === listId).vcProof, undefined);
  assert.equal(f.rows.items.find(i => i._id === itemId).vcProofs, undefined);
  // Recording happens entirely inside the mutation; nothing is scheduled for it.
  assert.deepEqual(f.effects.filter(([, ref]) => getFunctionName(ref).startsWith('actionRecord')), []);
});

test('the author\'s device signs each action with its did:webvh assertion key and the server verifies the rebuilt bytes at receipt', async () => {
  const f = await fixture();
  const a = await f.author();
  const listId = await a.call('lists', 'createList', { name: 'Errands', createdAt: 1 });
  await a.call('lists', 'renameList', { listId, name: 'Chores' });
  const itemId = await a.call('items', 'addItem', { listId, name: 'Sweep', createdAt: 2 });
  await a.call('items', 'checkItem', { itemId, checkedAt: 3 });
  await a.call('items', 'uncheckItem', { itemId });
  await a.call('items', 'batchCheckItems', { itemIds: ['I1', itemId] });
  await a.call('items', 'batchUncheckItems', { itemIds: [itemId, 'I1'] });
  assert.deepEqual(f.records().map(r => r.status), new Array(9).fill('signed'));
  assert.deepEqual(a.signedWith(), new Array(9).fill(a.keys.assertion.address), 'every signature came from the assertion key, none from the author (update) key');

  for (const record of f.records()) {
    const payload = JSON.parse(record.payload);
    assert.deepEqual(payload.author, { did: a.did, verificationMethod: VM(a.did), versionId: a.versionId });
    assert.equal(typeof payload.signedAt, 'number');
    assert.deepEqual([record.verificationMethod, record.publicKeyMultibase, record.signedAt], [VM(a.did), a.keys.assertion.multikey, payload.signedAt]);
    // The stored bytes are exactly what the device built and signed.
    const [change] = clientActionChanges(payload.action === 'item.created' ? 'addItem' : payload.action === 'item.completed' ? 'checkItem' : payload.action === 'item.reopened' ? 'uncheckItem' : payload.action === 'list.created' ? 'createList' : 'renameList',
      { itemId: payload.subject.itemId, listId: payload.subject.listId, createdAt: payload.subject.createdAt, name: payload.after.name, kind: payload.after.kind === 'note' ? 'note' : undefined });
    assert.equal(record.payload, buildActionRecord(change, payload.author, payload.signedAt).payload);
    const message = actionRecordSigningInput(record.payload);
    assert.ok(await ed25519.verifyAsync(base58Decode(record.signature.slice(1)), message, a.keys.assertion.publicKey));
    // Independent verification, from the author's DID log or from a pinned key.
    const viaLog = await verifyActionRecord(record, { resolveDidLog: a.resolveDidLog });
    assert.deepEqual([viaLog.verified, viaLog.author, viaLog.publicKeyMultibase], [true, payload.author, a.keys.assertion.multikey]);
    assert.equal((await verifyActionRecord(record, { trustedKeys: { [a.did]: [a.keys.assertion.multikey] } })).verified, true);
    assert.equal((await verifyActionRecord(record, { trustedKeys: { [a.did]: [a.keys.author.multikey] } })).verified, false, 'the update key never signs records');
    // The attested context is boop's, unsigned, and names the credential separately from the author.
    const described = describeActionRecord(record);
    assert.deepEqual([described.ownerDid, described.credential, described.author], [a.did, { kind: 'session', id: f.owner.accessSession._id }, payload.author]);
  }
  const subjects = f.records().map(r => JSON.parse(r.payload).subject);
  assert.deepEqual(subjects, [{ createdAt: 1 }, { listId }, { listId }, { itemId }, { itemId }, { itemId: 'I1' }, { itemId }, { itemId }, { itemId: 'I1' }]);
  assert.deepEqual(f.attested().map(c => c.itemId), [undefined, undefined, itemId, itemId, itemId, 'I1', itemId, itemId, 'I1']);

  // Completing a recurring item: the completion is the author's, the next occurrence is boop's.
  f.rows.items.find(i => i._id === 'I1').recurrence = { frequency: 'daily' };
  await a.call('items', 'checkItem', { itemId: 'I1', checkedAt: 9 });
  const [completed, generated] = f.records().slice(-2);
  assert.deepEqual([JSON.parse(completed.payload).action, completed.status], ['item.completed', 'signed']);
  assert.deepEqual([JSON.parse(generated.payload).action, generated.status, JSON.parse(generated.payload).author, JSON.parse(generated.attested).origin],
    ['item.created', 'unsigned', { did: a.did }, { kind: 'recurrence', sourceItemId: 'I1' }]);

  // The envelope on the wire carries one signature per subject and nothing secret.
  const envelope = await a.sign('batchCheckItems', { itemIds: ['I1', itemId] });
  assert.deepEqual(Object.keys(envelope).sort(), ['signatures', 'signedAt', 'verificationMethod', 'versionId']);
  assert.deepEqual(envelope.signatures.map(s => s.subject), ['{"itemId":"I1"}', `{"itemId":"${itemId}"}`]);
  assert.equal(await a.sign('removeItem', { itemId }), undefined, 'mutations that record nothing are not signed');
});

test('batch and individual actions produce the same signed statements, and a DID update keeps older records verifiable', async () => {
  const single = await fixture(), batch = await fixture();
  const authors = [await single.author(), await batch.author()];
  for (const f of [single, batch]) {
    f.rows.items[0].recurrence = { frequency: 'daily' };
    f.rows.items.push({ ...structuredClone(f.rows.items[0]), _id: 'I2', name: 'Eggs', recurrence: undefined });
  }
  for (const itemId of ['I1', 'I2']) await authors[0].call('items', 'checkItem', { itemId, checkedAt: 50 });
  for (const itemId of ['I1', 'I2']) await authors[0].call('items', 'uncheckItem', { itemId });
  await authors[1].call('items', 'batchCheckItems', { itemIds: ['I1', 'I2'] });
  await authors[1].call('items', 'batchUncheckItems', { itemIds: ['I1', 'I2'] });

  const normalize = f => f.payloads().map(p => ({ ...shape(p), author: 'AUTHOR', item: p.action === 'item.created' ? 'NEXT' : p.subject.itemId }))
    .sort((a, b) => `${a.action}${a.item}`.localeCompare(`${b.action}${b.item}`));
  assert.deepEqual(normalize(batch), normalize(single));
  assert.deepEqual(batch.payloads().map(p => p.action).sort(), ['item.completed', 'item.completed', 'item.created', 'item.reopened', 'item.reopened']);
  for (const f of [single, batch]) {
    assert.deepEqual(f.records().map(r => r.status), ['signed', 'unsigned', 'signed', 'signed', 'signed']);
    const next = f.rows.items.find(i => !['I1', 'I2'].includes(i._id));
    const [generated] = f.records().filter(r => JSON.parse(r.payload).action === 'item.created');
    assert.deepEqual(JSON.parse(generated.payload).subject, { listId: 'L1' });
    assert.deepEqual(JSON.parse(generated.attested), { ...JSON.parse(generated.attested), itemId: next._id, listAssetDid: 'did:list', origin: { kind: 'recurrence', sourceItemId: 'I1' } });
    assert.deepEqual(f.attested().filter(c => c.before && 'checked' in c.before).map(c => c.before), [{ checked: false }, { checked: false }, { checked: true }, { checked: true }]);
    // Historical evidence on the source item is neither replaced nor extended (its issuer still names the pre-#286 DID).
    assert.deepEqual(f.rows.items[0].vcProofs.map(p => [p.type, p.proof, p.issuer.startsWith('did:owner-')]), [['ExistingSignedProof', 'do-not-replace', true]]);
  }
  // The single path's checkedAt is the client's; the batch stamps server time. Neither is signed.
  assert.deepEqual(single.attested().filter(c => c.checkedAt !== undefined).map(c => c.checkedAt), [50, 50]);
  assert.ok(batch.attested().filter(c => c.checkedAt !== undefined).every(c => Math.abs(c.checkedAt - Date.now()) < 5000));

  // The author updates their DID (same keys, a new version): records signed under the old version still name it and verify,
  // and new records name the new version.
  const a = authors[0];
  const updated = await updateAuthor(a.turnkey, { jsonl: a.log, keys: a.keys });
  const log = single.rows.didLogs.find(l => l.userDid === a.did);
  log.log = updated;
  const newVersionId = JSON.parse(updated.split('\n').at(-1)).versionId;
  assert.notEqual(newVersionId, a.versionId);
  const earlier = single.records()[0];
  assert.equal((await verifyActionRecord(earlier, { resolveDidLog: () => updated })).verified, true);
  await a.call('items', 'checkItem', { itemId: 'I2', checkedAt: 60 }, { author: () => ({ ...a, versionId: newVersionId, log: updated }) });
  const latest = single.records().at(-1);
  assert.deepEqual([latest.status, JSON.parse(latest.payload).author.versionId], ['signed', newVersionId]);
  assert.equal((await verifyActionRecord(latest, { resolveDidLog: () => a.log })).verified, false, 'the old log does not have the new version');
  assert.equal((await verifyActionRecord(latest, { resolveDidLog: () => updated })).verified, true);
});

test('a signature that is not the author\'s own over exactly these bytes is recorded as failed and never stored', async () => {
  const f = await fixture();
  const a = await f.author();
  const b = await f.author(f.collaborator);
  const envelope = await a.sign('checkItem', { itemId: 'I1' });
  const sent = async (signed, args = { itemId: 'I1', checkedAt: 1 }, who = f.owner) => {
    const before = f.records().length;
    await f.call('items', 'checkItem', { ...args, signed }, who);
    const [record] = f.records().slice(before);
    return record;
  };
  const expectFailed = async (record, error) => {
    assert.deepEqual([record.status, record.error, record.signature, record.publicKeyMultibase, record.verificationMethod, record.signedAt], ['failed', error, undefined, undefined, undefined, undefined]);
    assert.deepEqual(JSON.parse(record.payload).author, { did: f.rows.users.find(u => u._id === record.ownerUserId).did }, 'a failed record claims no key or signing time');
    assert.equal(JSON.parse(record.payload).signedAt, undefined);
    assert.deepEqual(await verifyActionRecord(record, { resolveDidLog: a.resolveDidLog }), { verified: false, reason: 'not_signed' });
  };
  assert.equal((await sent(envelope)).status, 'signed', 'sanity: the genuine envelope verifies');
  assert.equal(f.rows.items[0].checked, true, 'the write itself always lands');

  // The same signature over different bytes: another signing time, another DID version, another subject.
  await expectFailed(await sent({ ...envelope, signedAt: envelope.signedAt + 1 }), 'bad_signature');
  await expectFailed(await sent({ ...envelope, versionId: '2-other' }), 'unknown_did_version');
  const [sig] = envelope.signatures;
  const other = await sent({ ...envelope, signatures: [{ subject: '{"itemId":"I1"}', signature: sig.signature }] }, { itemId: 'I1', checkedAt: 2 });
  assert.equal(other.status, 'signed', 'checkedAt is attested, not signed, so it may differ');
  assert.equal((await sent({ ...envelope, signatures: [{ subject: '{"itemId":"I2"}', signature: sig.signature }] })).status, 'unsigned', 'no signature was offered for this subject');
  // Someone else's envelope, or a key that is not this account's assertion key.
  await expectFailed(await sent(envelope, undefined, f.collaborator), 'author_mismatch');
  await expectFailed(await sent({ ...envelope, verificationMethod: `${a.did}#key-0` }), 'author_mismatch');
  const bEnvelope = await b.sign('checkItem', { itemId: 'I1' });
  await expectFailed(await sent({ ...bEnvelope, verificationMethod: VM(a.did) }), 'unknown_did_version', 'another author\'s DID version');
  await expectFailed(await sent({ ...bEnvelope, verificationMethod: VM(a.did), versionId: a.versionId }), 'bad_signature');
  // A signature by the author (update) key is refused even though it is the author's.
  const payload = buildActionRecord({ action: 'item.completed', subject: { itemId: 'I1' }, after: { checked: true } }, { did: a.did, verificationMethod: VM(a.did), versionId: a.versionId }, envelope.signedAt).payload;
  const byUpdateKey = encodeSignature(await a.turnkey.sign('sub-org', a.keys.author.address, actionRecordSigningInput(payload)));
  await expectFailed(await sent({ ...envelope, signatures: [{ subject: sig.subject, signature: byUpdateKey }] }), 'bad_signature');
  // Malformed material.
  await expectFailed(await sent({ ...envelope, signatures: [{ subject: sig.subject, signature: 'zshort' }] }), 'malformed_signature');
  await expectFailed(await sent({ ...envelope, signedAt: NaN }), 'malformed_envelope');
  // An account whose served DID is not an author DID has no key to check against.
  f.rows.didLogs.find(l => l.userDid === a.did).author = false;
  await expectFailed(await sent(envelope), 'no_author_did');
  f.rows.didLogs = f.rows.didLogs.filter(l => l.userDid !== a.did);
  await expectFailed(await sent(envelope), 'no_author_did');

  // The device never signs when it cannot act as the author now, and the record is simply unsigned.
  assert.equal(await a.sign('checkItem', { itemId: 'I1' }, { ready: async () => false }), undefined);
  assert.equal(await a.sign('checkItem', { itemId: 'I1' }, { author: () => null }), undefined);
  assert.equal(await a.sign('checkItem', { itemId: 'I1' }, { backend: { sign: async () => { throw new Error('Turnkey down'); } } }), undefined);
  // A Turnkey answer that is not this key's signature is refused on the device.
  assert.equal(await a.sign('checkItem', { itemId: 'I1' }, { backend: { sign: () => b.turnkey.sign('sub-org', b.keys.assertion.address, new Uint8Array(64)) } }), undefined);
  assert.equal((await sent(undefined)).status, 'unsigned');
});

test('a session and two API keys of one account are distinguishable in the attested context, and never from caller input', async () => {
  const f = await fixture();
  const first = await f.addApiKey('key-one'), second = await f.addApiKey('key-two');
  await f.call('items', 'checkItem', { itemId: 'I1', checkedAt: 1 });
  await f.viaKey('items', 'uncheckItem', { itemId: 'I1' }, 'key-one');
  await f.viaKey('items', 'checkItem', { itemId: 'I1', checkedAt: 2 }, 'key-two');
  await f.call('items', 'uncheckItem', { itemId: 'I1' }, f.collaborator);
  const [session, keyOne, keyTwo, editor] = f.described();
  assert.deepEqual([session, keyOne, keyTwo].map(d => d.credential), [
    { kind: 'session', id: f.owner.accessSession._id }, { kind: 'apiKey', id: first }, { kind: 'apiKey', id: second },
  ]);
  for (const d of [session, keyOne, keyTwo]) assert.equal(d.ownerDid, f.owner.user.did);
  assert.deepEqual(f.attested().slice(0, 3).map(c => c.userId), new Array(3).fill(f.owner.user._id));
  // An editor's action is authorized by the editor's account, not the list owner's.
  assert.deepEqual([editor.ownerDid, editor.credential], [f.collaborator.user.did, { kind: 'session', id: f.collaborator.accessSession._id }]);
  // API-key writes carry no author signature (no device, no session): recorded unsigned, with the key row attested.
  assert.deepEqual(f.records().map(r => r.status), ['unsigned', 'unsigned', 'unsigned', 'unsigned']);
  // Identity is never taken from caller input or key metadata, and no secret material is recorded.
  await assert.rejects(f.call('items', 'checkItem', { itemId: 'I1', checkedAt: 3, userDid: 'did:somebody-else' }), /Identity assertion/);
  const stored = JSON.stringify(f.records());
  for (const secret of ['did:agent:caller-claimed', 'key-one', 'key-two', digest('key-one'), f.owner.authToken, f.owner.accessSession.tokenHash, f.owner.user.turnkeySubOrgId]) {
    assert.ok(!stored.includes(secret), `records must not contain ${secret.slice(0, 12)}…`);
  }
  assert.equal(f.payloads().length, 4);
});

test('the verifier rejects altered payloads, signatures, keys, bindings, DID versions and every non-signed status', async () => {
  const f = await fixture();
  const a = await f.author();
  await a.call('items', 'checkItem', { itemId: 'I1', checkedAt: 7 });
  const [record] = structuredClone(f.records());
  const options = { resolveDidLog: a.resolveDidLog };
  const verify = (changes, opts = options) => verifyActionRecord({ ...record, ...changes }, opts).then(r => r.verified ? 'verified' : r.reason);
  const rewrite = edit => { const payload = JSON.parse(record.payload); edit(payload); const text = canonicalize(payload); return { payload: text, digest: actionRecordDigest(text) }; };
  assert.equal(await verify({}), 'verified');

  // Payload: changed in place, changed with a matching digest, or re-serialized.
  assert.equal(await verify({ payload: record.payload.replace('"checked":true', '"checked":false') }), 'digest_mismatch');
  assert.equal(await verify(rewrite(p => { p.after.checked = false; })), 'bad_signature');
  assert.equal(await verify(rewrite(p => { p.signedAt += 1; })), 'bad_signature');
  assert.equal(await verify(rewrite(p => { p.subject.itemId = 'another-item'; })), 'binding_mismatch');
  assert.equal(await verify({ ...rewrite(p => { p.subject.itemId = 'another-item'; }), itemId: 'another-item' }), 'bad_signature');
  assert.equal(await verify({ payload: JSON.stringify(JSON.parse(record.payload), null, 1), digest: digest(JSON.stringify(JSON.parse(record.payload), null, 1)) }), 'non_canonical_payload');
  assert.equal(await verify({ payload: '{"schema":"boop.action-record"', digest: digest('{"schema":"boop.action-record"') }), 'malformed_payload');
  assert.equal(await verify(rewrite(p => { p.version = 1; })), 'unsupported_version', 'version-1 records were never signed');
  assert.equal(await verify(rewrite(p => { delete p.author.versionId; })), 'malformed_payload');
  assert.equal(await verify(rewrite(p => { delete p.signedAt; })), 'malformed_payload');
  assert.equal(await verify(rewrite(p => { p.author.verificationMethod = 'did:webvh:other:boop.ad:x#orig-1'; })), 'malformed_payload', 'the key must belong to the author DID');
  assert.equal(await verify({ digest: digest('something else') }), 'digest_mismatch');

  // Signature: flipped, truncated, or valid but for another payload.
  const signature = base58Decode(record.signature.slice(1));
  signature[5] ^= 1;
  assert.equal(await verify({ signature: encodeSignature(signature) }), 'bad_signature');
  assert.equal(await verify({ signature: encodeSignature(signature.slice(1)) }), 'not_signed');
  await a.call('items', 'uncheckItem', { itemId: 'I1' });
  assert.equal(await verify({ signature: f.records()[1].signature }), 'bad_signature');

  // Key: an attacker re-signs with their own key and supplies it in the record.
  const secret = ed25519.utils.randomSecretKey();
  const attackerKey = ed25519Multikey(await ed25519.getPublicKeyAsync(secret));
  const forged = rewrite(p => { p.after.checked = false; });
  const attack = { ...forged, signature: encodeSignature(await ed25519.signAsync(actionRecordSigningInput(forged.payload), secret)), publicKeyMultibase: attackerKey };
  assert.equal(await verify(attack), 'untrusted_key');
  assert.equal(await verify({ ...attack, publicKeyMultibase: undefined }), 'bad_signature');
  assert.equal(await verify(attack, { trustedKeys: { [a.did]: [attackerKey] } }), 'verified', 'sanity: the forgery is otherwise well-formed, so pinning is only as good as the pin');
  assert.equal(await verify({}, { trustedKeys: { [a.did]: [attackerKey] } }), 'untrusted_key');
  assert.equal(await verify({}, { trustedKeys: { 'did:someone-else': [a.keys.assertion.multikey] } }), 'no_trusted_key');
  assert.equal(await verify({}, {}), 'no_trusted_key');
  assert.equal(await verify({}, { resolveDidLog: () => null }), 'no_trusted_key');
  assert.equal(await verify({}, { resolvePublicKey: () => null }), 'no_trusted_key');
  assert.equal(await verify({ publicKeyMultibase: attackerKey }), 'untrusted_key', 'the record\'s key must be the DID\'s');
  assert.equal(await verify({ publicKeyMultibase: 'not-a-key' }), 'binding_mismatch');

  // DID log: the version must exist, name this DID, and list the key as an assertion method.
  const entries = () => a.log.split('\n').map(line => JSON.parse(line));
  assert.equal(await verify({}, { resolveDidLog: () => entries() }), 'verified', 'parsed entries are accepted too');
  assert.equal(await verify({}, { resolveDidLog: () => entries().map(e => ({ ...e, versionId: `x-${e.versionId}` })) }), 'unknown_did_version');
  assert.equal(await verify({}, { resolveDidLog: () => entries().map(e => ({ ...e, state: { ...e.state, id: 'did:webvh:other:boop.ad:x' } })) }), 'unknown_did_version');
  assert.equal(await verify({}, { resolveDidLog: () => entries().map(e => ({ ...e, state: { ...e.state, assertionMethod: ['#key-0'] } })) }), 'not_assertion_key');
  const swapped = entries().map(e => ({ ...e, state: { ...e.state, verificationMethod: e.state.verificationMethod.map(vm => vm.id.endsWith('#orig-1') ? { ...vm, publicKeyMultibase: attackerKey } : vm) } }));
  assert.equal(await verify({}, { resolveDidLog: () => swapped }), 'untrusted_key', 'a log naming another key does not match the record\'s key');
  assert.equal(await verify({ publicKeyMultibase: undefined }, { resolveDidLog: () => swapped }), 'bad_signature');
  assert.deepEqual(assertionKeyAt(a.log, { did: a.did, verificationMethod: VM(a.did), versionId: a.versionId }), { publicKeyMultibase: a.keys.assertion.multikey });
  assert.deepEqual(assertionKeyAt(a.log, { did: a.did, verificationMethod: `${a.did}#key-0`, versionId: a.versionId }), { failure: 'not_assertion_key' });
  assert.deepEqual(assertionKeyAt('not jsonl', { did: a.did, verificationMethod: VM(a.did), versionId: a.versionId }), { failure: 'unknown_did_version' });

  // Binding: the attribution a record is filed or shown under must match what was signed.
  assert.equal(await verify({ itemId: 'another-item' }), 'binding_mismatch');
  assert.equal(await verify({ listId: 'another-list' }), 'verified', 'the item record does not sign its list; that column is attested');
  assert.equal(await verify({ verificationMethod: `${a.did}#key-0` }), 'binding_mismatch');
  assert.equal(await verify({}, { ...options, expected: { ownerDid: f.collaborator.user.did } }), 'binding_mismatch');
  assert.equal(await verify({}, { ...options, expected: { ownerDid: a.did } }), 'verified');
  // Naming another account as author needs that account's key, even with the original key attached.
  const reattributed = { ...rewrite(p => { p.author.did = f.collaborator.user.did; p.author.verificationMethod = VM(f.collaborator.user.did); }), ownerUserId: f.collaborator.user._id };
  assert.equal(await verify(reattributed), 'binding_mismatch', 'the stored verification method still names the real author');
  reattributed.verificationMethod = VM(f.collaborator.user.did);
  assert.equal(await verify(reattributed), 'no_trusted_key');
  assert.equal(await verify(reattributed, { trustedKeys: { [f.collaborator.user.did]: [a.keys.assertion.multikey] } }), 'bad_signature');
  // The attested context is not covered by the signature at all: changing it changes nothing the verifier checks.
  assert.equal(await verify({ attested: canonicalize({ ...JSON.parse(record.attested), credential: { kind: 'apiKey', id: 'forged' } }) }), 'verified');

  for (const status of ['pending', 'failed', 'unsigned']) assert.equal(await verify({ status }), 'not_signed');
  assert.equal(await verify({ signature: undefined }), 'not_signed');
});

test('no caller-supplied value can make recording fail the write', async () => {
  const f = await fixture();
  const a = await f.author();
  for (const checkedAt of [1700000000000.5, -100000, NaN, Infinity]) {
    await a.call('items', 'checkItem', { itemId: 'I1', checkedAt });
  }
  await a.call('items', 'addItem', { listId: 'L1', name: 'lone surrogate \ud800 "quoted" \n  ünïcode', createdAt: 1 });
  assert.deepEqual(f.attested().filter(c => 'checked' in (c.before ?? {})).map(c => c.checkedAt), [1700000000000.5, -100000, undefined, undefined]);
  assert.deepEqual(f.records().map(r => r.status), new Array(5).fill('signed'));
  for (const record of f.records()) {
    assert.equal((await verifyActionRecord(JSON.parse(JSON.stringify(record)), { resolveDidLog: a.resolveDidLog })).verified, true);
  }
});

test('an account without an author DID records the same way, unsigned', async () => {
  const f = await fixture();
  // API-key authentication does not depend on a sub-org; the account simply has none.
  await f.addApiKey('key-one');
  delete f.rows.users[0].turnkeySubOrgId;
  await f.viaKey('items', 'checkItem', { itemId: 'I1', checkedAt: 7 }, 'key-one');
  const [record] = f.records();
  assert.deepEqual([record.status, record.signature], ['unsigned', undefined]);
  assert.equal(f.rows.items[0].checked, true);
  assert.deepEqual(await verifyActionRecord(record, { trustedKeys: { [f.owner.user.did]: ['z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'] } }), { verified: false, reason: 'not_signed' });
});

test('template creation records the list and every item through the same path, attributed to boop', async () => {
  const f = await fixture();
  const a = await f.author();
  f.rows.listTemplates = [{ _id: 'T1', name: 'Saved', ownerDid: a.did, isPublic: false, items: [{ name: 'Step one', order: 0 }, { name: 'Step two', order: 1 }] }];
  const listId = await f.call('templates', 'createListFromTemplate', { templateId: 'T1', listName: 'From template', creationKey: 'template-attempt-1' });
  const origin = { kind: 'template', source: 'saved:T1' };
  assert.deepEqual(f.described().map(d => [d.action, d.after, d.origin]), [
    ['list.created', { name: 'From template', kind: 'list' }, origin],
    ['item.created', { name: 'Step one' }, origin],
    ['item.created', { name: 'Step two' }, origin],
  ]);
  assert.deepEqual(f.records().map(r => r.status), ['unsigned', 'unsigned', 'unsigned'], 'the device does not sign what the server generates');
  // Apart from its origin, a template item's record is the record ordinary creation writes.
  const direct = await a.call('items', 'addItem', { listId, name: 'Step one', createdAt: 1 });
  const [fromTemplate, , added] = f.records().filter(r => JSON.parse(r.payload).action === 'item.created');
  assert.equal(JSON.parse(added.attested).itemId, direct);
  assert.deepEqual(shape({ ...JSON.parse(fromTemplate.payload), author: 'AUTHOR' }), shape({ ...JSON.parse(added.payload), author: 'AUTHOR' }));
  assert.equal(added.status, 'signed');
});

test('notes are recorded as notes', async () => {
  const f = await fixture();
  const a = await f.author();
  const noteId = await a.call('lists', 'createList', { name: 'Thoughts', createdAt: 6, kind: 'note' });
  assert.deepEqual(f.described().map(d => [d.action, d.subject, d.after, d.origin]), [
    ['list.created', { createdAt: 6 }, { name: 'Thoughts', kind: 'note' }, undefined],
  ]);
  assert.deepEqual(f.records().map(r => [r.listId, r.status]), [[noteId, 'signed']]);
});

test('records are readable with the access of their subject, exportable with their evidence, and removed with their subject', async () => {
  const f = await fixture();
  const a = await f.author();
  const stranger = await createAuthFixture('did:stranger-records');
  f.rows.users.push(stranger.user); f.rows.accessSessions.push(stranger.accessSession);
  f.rows.publications.length = 0; // private list
  await a.call('lists', 'renameList', { listId: 'L1', name: 'Food' });
  await a.call('items', 'checkItem', { itemId: 'I1', checkedAt: 7 });
  await a.call('items', 'addItem', { listId: 'L1', name: 'Bread', createdAt: 8 });
  const itemRecords = await f.call('actionRecords', 'getItemActionRecords', { itemId: 'I1' }, f.collaborator);
  assert.deepEqual(itemRecords.map(r => JSON.parse(r.payload).action), ['item.completed']);
  const listRecords = await f.call('actionRecords', 'getListActionRecords', { listId: 'L1' }, f.collaborator);
  assert.deepEqual(listRecords.map(r => JSON.parse(r.payload).action), ['list.renamed']);
  // What a reader receives is sufficient for independent verification, and nothing internal.
  assert.equal((await verifyActionRecord(itemRecords[0], { resolveDidLog: a.resolveDidLog })).verified, true);
  assert.deepEqual(Object.keys(itemRecords[0]).sort(), ['_id', 'attested', 'digest', 'error', 'itemId', 'listId', 'ownerUserId', 'payload', 'publicKeyMultibase', 'signature', 'signedAt', 'status', 'verificationMethod']);
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
  assert.equal((await verifyActionRecord(records[0], { resolveDidLog: a.resolveDidLog })).verified, true);
  assert.deepEqual((await (await http('listId=L1', 'reader-key')).json()).records.map(r => JSON.parse(r.payload).action), ['list.renamed']);
  assert.equal((await http('itemId=I1&listId=L1', 'reader-key')).status, 400);

  // The standalone verifier accepts that export against the author's DID log or a pinned key, and nothing else.
  const dir = 'tmp/signed-action-records-extra';
  writeFileSync(`${dir}/export.json`, JSON.stringify({ records }));
  writeFileSync(`${dir}/author.jsonl`, a.log);
  // As a user would run it: outside the test runner's NODE_ENV, under which didwebvh-ts writes resolved logs to ./test/logs.
  const { NODE_ENV: _testEnv, ...env } = process.env;
  const cli = (...args) => spawnSync(process.execPath, ['scripts/verify-action-records.mjs', ...args], { encoding: 'utf8', env });
  const byLog = cli(`${dir}/export.json`, `${a.did}=${dir}/author.jsonl`);
  assert.deepEqual([byLog.status, byLog.stdout.trim().split('\t').slice(1, 5)], [0, ['verified', 'item.completed', a.did, `orig-1@${a.versionId}`]], byLog.stderr);
  assert.equal(cli(`${dir}/export.json`, `${a.did}=${a.keys.assertion.multikey}`).status, 0);
  assert.equal(cli(`${dir}/export.json`, `${a.did}=z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK`).status, 1);
  const noSource = cli(`${dir}/export.json`);
  assert.deepEqual([noSource.status, noSource.stdout.trim().split('\t')[2]], [1, 'no_trusted_key']);
  // A log that does not validate is reported and not used, even if it names the right key.
  writeFileSync(`${dir}/forged.jsonl`, a.log.replace(/"proofValue":"z[^"]+"/, '"proofValue":"z3"'));
  const forged = cli(`${dir}/export.json`, `${a.did}=${dir}/forged.jsonl`);
  assert.deepEqual([forged.status, forged.stdout.trim().split('\t')[2]], [1, 'no_trusted_key']);
  assert.match(forged.stderr, /DID log rejected/);
  writeFileSync(`${dir}/export.json`, JSON.stringify({ records: [{ ...records[0], payload: records[0].payload.replace('"checked":true', '"checked":false') }] }));
  const refused = cli(`${dir}/export.json`, `${a.did}=${dir}/author.jsonl`);
  assert.deepEqual([refused.status, refused.stdout.trim().split('\t').slice(1, 3)], [1, ['REJECTED', 'digest_mismatch']]);
  assert.equal(cli().status, 2);
  assert.equal((await http('', 'reader-key')).status, 400);
  for (const query of ['itemId=I1', 'listId=L1']) {
    const denied = await http(query, 'stranger-key');
    assert.notEqual(denied.status, 200);
    assert.equal((await denied.json()).records, undefined);
  }

  await f.call('items', 'removeItem', { itemId: 'I1' });
  assert.deepEqual(f.payloads().map(p => p.action), ['list.renamed', 'item.created']);
  await f.call('items', 'batchDeleteItems', { itemIds: [f.attested().find(c => c.before === null && c.itemId).itemId] });
  assert.deepEqual(f.payloads().map(p => p.action), ['list.renamed']);
  await f.call('lists', 'deleteList', { listId: 'L1' });
  assert.deepEqual(f.records(), []);

  // Subjects with more records than one mutation should touch are drained in batches.
  const DELETE_RECORDS_BATCH = 500; // convex/lib/actionRecords.ts
  const h = await fixture();
  for (let i = 0; i <= DELETE_RECORDS_BATCH; i++) await h.ctx.db.insert('actionRecords', { listId: 'L1', itemId: 'I1', status: 'unsigned' });
  await h.call('items', 'removeItem', { itemId: 'I1' });
  assert.equal(h.records().length, 1);
  const continuations = h.effects.filter(([, ref]) => getFunctionName(ref) === 'actionRecords:deleteRemaining');
  assert.deepEqual(continuations.map(([delay, , args]) => [delay, args]), [[0, { target: { itemId: 'I1' } }]]);
  await modules.actionRecords.deleteRemaining._handler(h.ctx, continuations[0][2]);
  assert.deepEqual(h.records(), []);
  for (let i = 0; i <= DELETE_RECORDS_BATCH; i++) await h.ctx.db.insert('actionRecords', { listId: 'L1', status: 'unsigned' });
  await h.call('lists', 'deleteList', { listId: 'L1' });
  assert.equal(h.records().length, 1);
  await modules.actionRecords.deleteRemaining._handler(h.ctx, { target: { listId: 'L1' } });
  assert.deepEqual(h.records(), []);

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

test('historical placeholders and version-1 records stay untouched and unsigned; a DID re-mint never rewrites signed payloads', async () => {
  const f = await fixture();
  const a = await f.author();
  const placeholder = { type: 'ItemAuthorshipCredential', issuer: a.did, issuanceDate: 1, action: 'created', actorDid: a.did,
    proof: JSON.stringify({ '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential', 'ItemAuthorshipCredential'], issuer: a.did, credentialSubject: { id: a.did } }) };
  f.rows.items[0].vcProofs = [placeholder];
  // A record written before version 2, as deployed code wrote it: never signed, still readable.
  const legacy = '{"action":"item.completed","after":{"checked":true,"checkedAt":5},"before":{"checked":false},"credential":{"id":"S","kind":"session"},"occurredAt":1700000000000,"owner":{"did":"did:webvh:old:boop.ad:u","userId":"U"},"schema":"boop.action-record","subject":{"itemId":"I1","listAssetDid":"did:list","listId":"L1"},"version":1}';
  await f.ctx.db.insert('actionRecords', { payload: legacy, digest: actionRecordDigest(legacy), listId: 'L1', itemId: 'I1', ownerUserId: 'U', status: 'unsigned' });
  assert.deepEqual(describeActionRecord({ payload: legacy }), {
    version: 1, action: 'item.completed', ownerDid: 'did:webvh:old:boop.ad:u', after: { checked: true, checkedAt: 5 }, subject: { itemId: 'I1', listId: 'L1' },
    credential: { kind: 'session', id: 'S' }, occurredAt: 1700000000000, before: { checked: false }, listAssetDid: 'did:list',
  });
  assert.deepEqual(await verifyActionRecord({ payload: legacy, digest: actionRecordDigest(legacy), status: 'signed', signature: encodeSignature(new Uint8Array(64)) }, {}), { verified: false, reason: 'unsupported_version' });
  assert.equal(describeActionRecord({ payload: '{"schema":"boop.action-record","version":3}' }), null);

  await a.call('items', 'checkItem', { itemId: 'I1', checkedAt: 7 });
  assert.deepEqual(f.rows.items[0].vcProofs, [placeholder]);
  assert.equal(legacyActionEvidence(f.rows.items[0].vcProofs[0].proof), 'unsigned');
  assert.equal(legacyActionEvidence(f.records()[1].payload), 'unverified', 'a new record is never mistaken for a legacy placeholder');

  const before = structuredClone(f.records());
  const oldDid = a.did;
  const result = await modules['migrations/remintUserDidDb'].applyRemint._handler(f.ctx, { userId: f.owner.user._id, oldDid, newDid: 'did:webvh:reminted' });
  assert.ok(result.rewritten > 0);
  assert.equal(f.rows.items[0].createdByDid, 'did:webvh:reminted', 'sanity: the re-mint did rewrite mutable attribution');
  assert.deepEqual(f.records(), before);
  // The record keeps naming the DID that authorized it. boop no longer serves that DID's log
  // (the re-mint moved the account), so a verifier needs the old log, or a pin, from elsewhere.
  assert.deepEqual(await verifyActionRecord(f.records()[1], { resolveDidLog: a.resolveDidLog }), { verified: false, reason: 'no_trusted_key' });
  assert.equal((await verifyActionRecord(f.records()[1], { resolveDidLog: did => did === oldDid ? a.log : null })).verified, true);
  assert.equal((await verifyActionRecord(f.records()[1], { trustedKeys: { [oldDid]: [a.keys.assertion.multikey] } })).verified, true);
  assert.deepEqual(await verifyActionRecord(f.records()[1], { trustedKeys: { 'did:webvh:reminted': [a.keys.assertion.multikey] } }), { verified: false, reason: 'no_trusted_key' });
});
