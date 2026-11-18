// #286 P3: the Boop service DID countersigns receipts for accepted action
// records (shared/receipt.ts, shared/serviceDid.ts, convex/lib/serviceReceipts.ts).
//
// TURNKEY IS MOCKED: `localBackend` stands in for the parent org's service
// wallet with local Ed25519 keys, and `mockTurnkeyFetch` for the Turnkey API.
// Nothing here talks to Turnkey or publishes a DID.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as ed25519 from '@noble/ed25519';
import { prepareDataForSigning } from 'didwebvh-ts';
import { base58Decode, base58Encode, encodeSignature, parseEd25519PublicKey } from '../shared/actionRecord.ts';
import { parseReceipt, receiptProofConfig, receiptSigningInput, receiptStatement, verifyReceipt } from '../shared/receipt.ts';
import { SERVICE_UPDATE_KEY_PATH, currentReceiptKey, receiptKeyPath, serviceLogProblems } from '../shared/serviceDid.ts';
import { ReceiptError, issueReceipt, receiptsEnabled, turnkeyServiceSigner } from '../convex/lib/serviceReceipts.ts';
import { checkDidLog, checkDidLogWrite } from '../convex/lib/authorDidLog.ts';
import { mintServiceDid, rotateServiceDid, turnkeyServiceKeyBackend } from './lib/service-did.ts';
import { hex, localBackend, mockTurnkey } from './helpers/service-did-fixture.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const HASH = hash('a record payload');
const AT = 1_763_200_000_000;
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

async function service() {
  const backend = localBackend();
  const minted = await mintServiceDid(backend, { domain: 'boop.ad' });
  return { backend, minted };
}

test('the service DID is one receipt key under assertionMethod, updated only by a separate key', async () => {
  const { backend, minted } = await service();
  assert.match(minted.did, /^did:webvh:[^:]+:boop\.ad:boop-service$/);
  assert.equal(minted.verificationMethod, `${minted.did}#receipt-1`);
  const [genesis] = minted.jsonl.split('\n').map(line => JSON.parse(line));
  assert.deepEqual(genesis.state.assertionMethod.map(ref => ref.replace(minted.did, '')), ['#receipt-1']);
  assert.equal(genesis.state.verificationMethod.length, 1);
  assert.equal(genesis.state.verificationMethod[0].controller, minted.did);
  assert.deepEqual(genesis.state.authentication ?? [], []);
  const updateKey = await backend.keyAt(SERVICE_UPDATE_KEY_PATH);
  assert.deepEqual(genesis.parameters.updateKeys.map(key => [...parseEd25519PublicKey(key)]), [[...updateKey]]);
  assert.ok(same(parseEd25519PublicKey(minted.publicKeyMultibase), await backend.keyAt(receiptKeyPath(1))));
  assert.ok(!same(updateKey, parseEd25519PublicKey(minted.publicKeyMultibase)));
  // Only the update key signed the log.
  assert.deepEqual([...new Set(backend.signed)], [SERVICE_UPDATE_KEY_PATH]);
  // It is a valid did:webvh log on the domain, by the same check account logs get, and never an author DID.
  const checked = await checkDidLog(minted.jsonl, { domain: 'boop.ad' });
  assert.equal(checked.did, minted.did);
  assert.equal(checked.versionId, minted.versionId);
  assert.ok(checked.authorProblems.length > 0);
  await assert.rejects(checkDidLog(minted.jsonl, { domain: 'evil.example' }), /not evil\.example/);
});

test('a receipt round-trips: signed by the receipt key, verified offline from the log', async () => {
  const { backend, minted } = await service();
  const receipt = await issueReceipt(minted.jsonl, { recordHash: HASH, receivedAt: AT }, backend);
  assert.deepEqual(receipt, {
    type: 'BoopActionRecordReceipt', recordHash: HASH, receivedAt: AT, signer: `${minted.did}#receipt-1`, versionId: minted.versionId,
    proof: {
      type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', verificationMethod: `${minted.did}#receipt-1`,
      proofPurpose: 'assertionMethod', created: new Date(AT).toISOString(), proofValue: receipt.proof.proofValue,
    },
  });
  assert.equal(backend.signed.at(-1), receiptKeyPath(1));
  // As a JSON document handed to someone else, with the log as text or as parsed entries.
  const wire = JSON.parse(JSON.stringify(receipt));
  const result = verifyReceipt(wire, minted.jsonl, { expected: { recordHash: HASH, serviceDid: minted.did } });
  assert.deepEqual(result, { verified: true, receipt, serviceDid: minted.did, publicKeyMultibase: minted.publicKeyMultibase });
  assert.equal(verifyReceipt(wire, minted.jsonl.split('\n').map(line => JSON.parse(line))).verified, true);
  assert.deepEqual(parseReceipt(wire), receipt);
});

test('the signed bytes are the eddsa-jcs-2022 hash data a Data Integrity library computes', async () => {
  const { backend, minted } = await service();
  const receipt = await issueReceipt(minted.jsonl, { recordHash: HASH, receivedAt: AT }, backend);
  const { proof, ...statement } = receipt;
  const { proofValue, ...options } = proof;
  const standard = await prepareDataForSigning(statement, options);
  assert.ok(same(standard, receiptSigningInput(statement)));
  assert.equal(standard.length, 64);
  assert.ok(await ed25519.verifyAsync(base58Decode(proofValue.slice(1)), standard, parseEd25519PublicKey(minted.publicKeyMultibase)));
});

test('a tampered receipt is rejected', async () => {
  const { backend, minted } = await service();
  const receipt = await issueReceipt(minted.jsonl, { recordHash: HASH, receivedAt: AT }, backend);
  const verify = (changed, options) => verifyReceipt(changed, minted.jsonl, options);
  const reason = (changed, options) => { const r = verify(changed, options); assert.equal(r.verified, false); return r.reason; };
  const withProof = patch => ({ ...receipt, proof: { ...receipt.proof, ...patch } });
  // Consistent with itself, so only the signature can tell.
  const moved = (fields) => { const s = { ...receipt, ...fields }; return { ...s, proof: { ...receiptProofConfig(s), proofValue: receipt.proof.proofValue } }; };

  assert.equal(reason(moved({ recordHash: hash('another record') })), 'bad_signature');
  assert.equal(reason(moved({ receivedAt: AT - 86_400_000 })), 'bad_signature'); // backdated
  assert.equal(reason(moved({ receivedAt: AT + 1 })), 'bad_signature');
  const other = encodeSignature(await ed25519.signAsync(receiptSigningInput(receiptStatement(receipt)), ed25519.utils.randomSecretKey()));
  assert.equal(reason(withProof({ proofValue: other })), 'bad_signature');
  // Signed by the update key, which is not an assertion key: its signature is no receipt.
  const byUpdateKey = encodeSignature(await backend.sign(await backend.keyAt(SERVICE_UPDATE_KEY_PATH), receiptSigningInput(receiptStatement(receipt))));
  assert.equal(reason(withProof({ proofValue: byUpdateKey })), 'bad_signature');

  assert.equal(reason(moved({ versionId: '9-QmNope' })), 'unknown_did_version');
  assert.equal(reason(moved({ signer: `${minted.did}#receipt-2` })), 'not_assertion_key');
  assert.equal(reason(moved({ signer: `${minted.did.replace('boop.ad', 'evil.example')}#receipt-1` })), 'unknown_did_version');

  for (const malformed of [
    null, 'receipt', [], {}, { ...receipt, proof: undefined }, { ...receipt, extra: 1 }, { ...receipt, type: 'Other' },
    { ...receipt, recordHash: HASH.toUpperCase() }, { ...receipt, recordHash: HASH.slice(2) }, { ...receipt, receivedAt: String(AT) },
    { ...receipt, receivedAt: AT + 0.5 }, { ...receipt, receivedAt: -1 }, { ...receipt, signer: minted.did }, { ...receipt, signer: 'did:key:z6Mk#x' },
    { ...receipt, versionId: '' },
    withProof({ created: new Date(AT - 1).toISOString() }), withProof({ verificationMethod: `${minted.did}#receipt-9` }),
    withProof({ cryptosuite: 'eddsa-rdfc-2022' }), withProof({ proofPurpose: 'authentication' }), withProof({ proofValue: 'zabc' }),
    withProof({ proofValue: receipt.proof.proofValue.slice(1) }), withProof({ nonce: 'x' }),
  ]) assert.equal(reason(malformed), 'malformed_receipt', JSON.stringify(malformed));

  // The receipt is fine, but not for what the verifier was shown.
  assert.equal(reason(receipt, { expected: { recordHash: hash('another record') } }), 'binding_mismatch');
  assert.equal(reason(receipt, { expected: { serviceDid: 'did:webvh:QmOther:boop.ad:boop-service' } }), 'binding_mismatch');
  assert.equal(verify(receipt, { expected: { recordHash: HASH, serviceDid: minted.did } }).verified, true);

  // Another service's log, or one that is not JSON Lines, proves nothing about this receipt.
  const stranger = await service();
  assert.equal(verifyReceipt(receipt, stranger.minted.jsonl).verified, false);
  assert.deepEqual(verifyReceipt(receipt, 'not a log'), { verified: false, reason: 'unknown_did_version' });
});

test('key rotation: each receipt verifies against the key of the version it names', async () => {
  const { backend, minted } = await service();
  const before = await issueReceipt(minted.jsonl, { recordHash: HASH, receivedAt: AT }, backend);
  const rotated = await rotateServiceDid(backend, minted.jsonl);
  assert.equal(rotated.did, minted.did);
  assert.notEqual(rotated.versionId, minted.versionId);
  assert.equal(rotated.verificationMethod, `${minted.did}#receipt-2`);
  assert.notEqual(rotated.publicKeyMultibase, minted.publicKeyMultibase);
  assert.ok(rotated.jsonl.startsWith(`${minted.jsonl}\n`));
  assert.deepEqual(serviceLogProblems(rotated.jsonl), []);
  // The rotated log is a valid continuation of the served one, signed by the update key.
  assert.equal((await checkDidLogWrite(minted.jsonl, rotated.jsonl, { domain: 'boop.ad' })).versionId, rotated.versionId);

  const after = await issueReceipt(rotated.jsonl, { recordHash: hash('later record'), receivedAt: AT + 5000 }, backend);
  assert.equal(after.signer, `${minted.did}#receipt-2`);
  assert.equal(after.versionId, rotated.versionId);
  assert.equal(backend.signed.at(-1), receiptKeyPath(2));

  // Both verify from the rotated log, each with its own version's key.
  const old = verifyReceipt(before, rotated.jsonl, { expected: { serviceDid: minted.did } });
  assert.equal(old.verified && old.publicKeyMultibase, minted.publicKeyMultibase);
  const current = verifyReceipt(after, rotated.jsonl, { expected: { serviceDid: minted.did } });
  assert.equal(current.verified && current.publicKeyMultibase, rotated.publicKeyMultibase);
  // The log from before the rotation does not know the new version.
  assert.deepEqual(verifyReceipt(after, minted.jsonl), { verified: false, reason: 'unknown_did_version' });

  const resign = async (statement, path) => ({ ...statement, proof: {
    ...receiptProofConfig(statement), proofValue: encodeSignature(await ed25519.signAsync(receiptSigningInput(statement), backend.secretAt(path))),
  } });
  const fields = { recordHash: HASH, receivedAt: AT + 9000 };
  // The retired key, naming the version where it is gone: not that version's key.
  const retiredAtNew = await resign(receiptStatement({ ...fields, signer: `${minted.did}#receipt-1`, versionId: rotated.versionId }), receiptKeyPath(1));
  assert.deepEqual(verifyReceipt(retiredAtNew, rotated.jsonl), { verified: false, reason: 'not_assertion_key' });
  // The retired key under the new key's name, and the new key under the old version: wrong key for the version named.
  const retiredAsNew = await resign(receiptStatement({ ...fields, signer: `${minted.did}#receipt-2`, versionId: rotated.versionId }), receiptKeyPath(1));
  assert.deepEqual(verifyReceipt(retiredAsNew, rotated.jsonl), { verified: false, reason: 'bad_signature' });
  const newAtOld = await resign(receiptStatement({ ...fields, signer: `${minted.did}#receipt-1`, versionId: minted.versionId }), receiptKeyPath(2));
  assert.deepEqual(verifyReceipt(newAtOld, rotated.jsonl), { verified: false, reason: 'bad_signature' });
  const newNameAtOld = await resign(receiptStatement({ ...fields, signer: `${minted.did}#receipt-2`, versionId: minted.versionId }), receiptKeyPath(2));
  assert.deepEqual(verifyReceipt(newNameAtOld, rotated.jsonl), { verified: false, reason: 'not_assertion_key' });

  const twice = await rotateServiceDid(backend, rotated.jsonl);
  assert.equal(twice.verificationMethod, `${minted.did}#receipt-3`);
  for (const receipt of [before, after]) assert.equal(verifyReceipt(receipt, twice.jsonl).verified, true);
});

test('a log that is not a service DID is refused, at issue time too', async () => {
  const { backend, minted } = await service();
  const entries = minted.jsonl.split('\n').map(line => JSON.parse(line));
  const edit = fn => { const copy = structuredClone(entries); fn(copy[0]); return copy; };
  const problems = fn => serviceLogProblems(edit(fn)).join('; ');
  assert.deepEqual(serviceLogProblems(minted.jsonl), []);
  assert.match(problems(e => { e.parameters.updateKeys = [e.state.verificationMethod[0].publicKeyMultibase]; }), /also an update key/);
  assert.match(problems(e => { e.parameters.updateKeys.push('z6MkOther'); }), /exactly one update key/);
  assert.match(problems(e => { e.state.verificationMethod.push({ ...e.state.verificationMethod[0], id: `${e.state.id}#receipt-2` }); }), /exactly one #receipt-<n>/);
  assert.match(problems(e => { e.state.verificationMethod[0].id = `${e.state.id}#orig-1`; e.state.assertionMethod = [`${e.state.id}#orig-1`]; }), /exactly one #receipt-<n>/);
  assert.match(problems(e => { e.state.assertionMethod = []; }), /assertionMethod must be exactly/);
  assert.match(problems(e => { e.state.assertionMethod = [e.state.verificationMethod[0]]; }), /by reference/);
  assert.match(problems(e => { e.state.authentication = [e.state.assertionMethod[0]]; }), /authentication must be empty/);
  assert.match(problems(e => { e.state.capabilityDelegation = [e.state.assertionMethod[0]]; }), /capabilityDelegation must be empty/);
  assert.match(problems(e => { e.state.verificationMethod[0].controller = 'did:webvh:QmOther:boop.ad:boop-service'; }), /not controlled by the DID/);
  assert.match(problems(e => { e.state.verificationMethod[0].type = 'JsonWebKey'; }), /not an Ed25519 Multikey/);
  assert.match(problems(e => { e.state.id = e.state.id.replace(/boop-service$/, 'user-abc'); }), /not served at \/boop-service/);
  assert.match(serviceLogProblems('').join(), /empty/);
  // A receipt number never names two keys, and never goes back.
  const rotated = (await rotateServiceDid(backend, minted.jsonl)).jsonl.split('\n').map(line => JSON.parse(line));
  const reuse = structuredClone(rotated);
  reuse[1].state.verificationMethod[0].id = `${minted.did}#receipt-1`; reuse[1].state.assertionMethod = [`${minted.did}#receipt-1`];
  assert.match(serviceLogProblems(reuse).join(), /version 2: a new receipt key must take the next unused number/);

  assert.ok('problems' in currentReceiptKey(edit(e => { e.state.assertionMethod = []; })));
  const bad = edit(e => { e.state.authentication = [e.state.assertionMethod[0]]; }).map(e => JSON.stringify(e)).join('\n');
  await assert.rejects(issueReceipt(bad, { recordHash: HASH, receivedAt: AT }, backend), ReceiptError);
  const signedBefore = backend.signed.length;
  for (const fields of [{ recordHash: 'nope', receivedAt: AT }, { recordHash: HASH, receivedAt: 1.5 }, { recordHash: HASH, receivedAt: NaN }]) {
    await assert.rejects(issueReceipt(minted.jsonl, fields, backend), /recordHash must be/);
  }
  assert.equal(backend.signed.length, signedBefore);
});

test('a signer that answers with the wrong signature yields an error, never a receipt', async () => {
  const { backend, minted } = await service();
  const stranger = ed25519.utils.randomSecretKey();
  await assert.rejects(issueReceipt(minted.jsonl, { recordHash: HASH, receivedAt: AT }, { sign: (_key, message) => ed25519.signAsync(message, stranger) }), /does not verify \(bad_signature\)/);
  await assert.rejects(issueReceipt(minted.jsonl, { recordHash: HASH, receivedAt: AT }, { sign: async () => new Uint8Array(10) }), /did not return an Ed25519 signature/);
  // The update key is in the same wallet; its signature is refused as well.
  const updateKey = await backend.keyAt(SERVICE_UPDATE_KEY_PATH);
  await assert.rejects(issueReceipt(minted.jsonl, { recordHash: HASH, receivedAt: AT }, { sign: (_key, message) => backend.sign(updateKey, message) }), /bad_signature/);
});

// ---------------------------------------------------------------------------
// Turnkey (mocked HTTP)

test('the Turnkey signer signs as the parent org with the receipt key, and nothing else', async () => {
  const turnkey = await mockTurnkey();
  const owner = turnkeyServiceKeyBackend(turnkey.credentials, { fetchImpl: turnkey.fetchImpl });
  const minted = await mintServiceDid(owner, { domain: 'boop.ad' });
  assert.equal(owner.walletId(), 'wallet-service');
  assert.deepEqual(turnkey.accounts.map(a => a.path), [SERVICE_UPDATE_KEY_PATH, receiptKeyPath(1)]);
  assert.deepEqual(turnkey.requests.map(r => new URL(r.url).pathname), [
    '/public/v1/submit/create_wallet', '/public/v1/query/list_wallet_accounts', '/public/v1/submit/create_wallet_accounts', '/public/v1/submit/sign_raw_payload',
  ]);

  turnkey.requests.length = 0;
  const receipt = await issueReceipt(minted.jsonl, { recordHash: HASH, receivedAt: AT }, turnkeyServiceSigner(turnkey.credentials, turnkey.fetchImpl));
  assert.equal(verifyReceipt(receipt, minted.jsonl, { expected: { recordHash: HASH, serviceDid: minted.did } }).verified, true);
  assert.equal(turnkey.requests.length, 1);
  const [{ url, body, stamp }] = turnkey.requests;
  assert.equal(url, 'https://api.turnkey.com/public/v1/submit/sign_raw_payload');
  assert.equal(stamp.scheme, 'SIGNATURE_SCHEME_TK_API_P256');
  assert.equal(body.type, 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2');
  assert.equal(body.organizationId, 'parent-org');
  assert.deepEqual(body.parameters, {
    signWith: turnkey.accounts[1].address, // the receipt key, by its Solana-format address
    payload: hex(receiptSigningInput(receiptStatement(receipt))),
    encoding: 'PAYLOAD_ENCODING_HEXADECIMAL', hashFunction: 'HASH_FUNCTION_NOT_APPLICABLE',
  });
  assert.equal(turnkey.accounts[1].address, base58Encode(parseEd25519PublicKey(minted.publicKeyMultibase)));

  // Rotation through Turnkey: the next account is created, the update key signs, the new key countersigns.
  const rotated = await rotateServiceDid(turnkeyServiceKeyBackend(turnkey.credentials, { walletId: 'wallet-service', fetchImpl: turnkey.fetchImpl }), minted.jsonl);
  assert.deepEqual(turnkey.accounts.map(a => a.path), [SERVICE_UPDATE_KEY_PATH, receiptKeyPath(1), receiptKeyPath(2)]);
  const next = await issueReceipt(rotated.jsonl, { recordHash: HASH, receivedAt: AT + 1 }, turnkeyServiceSigner(turnkey.credentials, turnkey.fetchImpl));
  assert.equal(turnkey.requests.at(-1).body.parameters.signWith, turnkey.accounts[2].address);
  for (const each of [receipt, next]) assert.equal(verifyReceipt(each, rotated.jsonl).verified, true);
});

test('a Turnkey answer that is not a completed signature fails closed', async () => {
  const turnkey = await mockTurnkey();
  const minted = await mintServiceDid(turnkeyServiceKeyBackend(turnkey.credentials, { fetchImpl: turnkey.fetchImpl }), { domain: 'boop.ad' });
  const signer = turnkeyServiceSigner(turnkey.credentials, turnkey.fetchImpl);
  const issue = () => issueReceipt(minted.jsonl, { recordHash: HASH, receivedAt: AT }, signer);
  turnkey.respondWith(() => Response.json({ activity: { status: 'ACTIVITY_STATUS_CONSENSUS_NEEDED' } }));
  await assert.rejects(issue(), /did not complete the signature \(ACTIVITY_STATUS_CONSENSUS_NEEDED\)/);
  turnkey.respondWith(() => Response.json({ activity: { status: 'ACTIVITY_STATUS_COMPLETED', result: { signRawPayloadResult: { r: 'zz', s: '00' } } } }));
  await assert.rejects(issue(), /did not complete the signature/);
  turnkey.respondWith(() => new Response('policy denied', { status: 403 }));
  await assert.rejects(issue(), /Turnkey API error 403/);
  // A valid signature by another key (the update key): refused by the check after signing.
  turnkey.respondWith(async (_url, body) => {
    const signature = hex(await ed25519.signAsync(Buffer.from(body.parameters.payload, 'hex'), turnkey.accounts[0].secret));
    return Response.json({ activity: { status: 'ACTIVITY_STATUS_COMPLETED', result: { signRawPayloadResult: { r: signature.slice(0, 64), s: signature.slice(64) } } } });
  });
  await assert.rejects(issue(), /does not verify \(bad_signature\)/);
});

test('receipts are off unless ACTION_RECEIPTS_ENABLED is exactly "true"', () => {
  const before = process.env.ACTION_RECEIPTS_ENABLED;
  try {
    for (const value of [undefined, '', '1', 'TRUE', 'yes', 'false']) {
      if (value === undefined) delete process.env.ACTION_RECEIPTS_ENABLED; else process.env.ACTION_RECEIPTS_ENABLED = value;
      assert.equal(receiptsEnabled(), false, String(value));
    }
    process.env.ACTION_RECEIPTS_ENABLED = 'true';
    assert.equal(receiptsEnabled(), true);
  } finally {
    if (before === undefined) delete process.env.ACTION_RECEIPTS_ENABLED; else process.env.ACTION_RECEIPTS_ENABLED = before;
  }
});

test('Convex holds one Turnkey signing path, and no way to create keys or update the service DID', () => {
  const signer = readFileSync('convex/lib/serviceReceipts.ts', 'utf8');
  // Always the parent org from the credentials, always the key the service log names.
  assert.match(signer, /organizationId: credentials\.organizationId/);
  assert.match(signer, /signWith: base58Encode\(publicKey\)/);
  assert.doesNotMatch(signer, /subOrg|create_wallet|createWallet|updateDID|createDID/);
  assert.doesNotMatch(readFileSync('convex/receipts.ts', 'utf8') + readFileSync('convex/serviceDid.ts', 'utf8'), /scripts\/lib|create_wallet|updateDID|createDID/);
});
