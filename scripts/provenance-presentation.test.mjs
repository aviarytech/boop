import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, cleanup, fireEvent, waitFor } = await import('@testing-library/react');
const { MemoryRouter } = await import('react-router-dom');
const { getFunctionName } = await import('convex/server');
const ed25519 = await import('@noble/ed25519');
const { actionRecordSigningInput, buildActionRecord, canonicalize, encodeSignature } = await import('../shared/actionRecord.ts');
// TURNKEY IS MOCKED (scripts/helpers/author-did-fixture.ts): local Ed25519 keys stand in for the author's sub-org keys.
await build({ entryPoints: ['scripts/helpers/author-did-fixture.ts'], outfile: 'tmp/provenance-presentation/author-did-fixture.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent' });
const { mockTurnkey, mintAuthor } = await import(pathToFileURL(`${process.cwd()}/tmp/provenance-presentation/author-did-fixture.mjs`));

await build({
  entryPoints: ['src/components/ProvenanceInfo.tsx'], outfile: 'tmp/provenance-presentation/component.mjs',
  bundle: true, jsx: 'automatic', platform: 'node', format: 'esm',
  external: ['react', 'react/jsx-runtime', 'react-router-dom', 'convex/server'],
  plugins: [{ name: 'provenance-fixture', setup(b) {
    b.onResolve({ filter: /(?:lib\/(authenticatedConvex|originals)|hooks\/(useCurrentUser|useSettings|useListOriginal)|^\.\/useListOriginal)$/ }, ({ path }) => ({ path: path.split('/').pop(), namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: {
      authenticatedConvex: 'export const useQuery=(ref,args)=>globalThis.__provenanceQuery?.(ref,args)??null; export const useMutation=()=>async()=>{};',
      useCurrentUser: 'export const useCurrentUser=()=>({did:"did:owner"});',
      useSettings: 'export const useSettings=()=>({haptic:()=>{}});',
      useListOriginal: 'export const useOriginalsClient=()=>globalThis.__originalsClient??(globalThis.__originalsClient={});',
      // verifyList is the real check's boundary: tests say what it found.
      originals: 'export const verifyList=async(client,listId)=>globalThis.__verifyList?.(listId)??null; export const isLegacyAssetDid=d=>!!d&&!d.startsWith("did:vh:");',
    }[path] }));
  } }],
});
const { ItemProvenanceInfo, ListProvenanceInfo } = await import(pathToFileURL(`${process.cwd()}/tmp/provenance-presentation/component.mjs`));

// The browser resolves an author's did.jsonl from the domain the DID names.
// Serve the fixture author's log at that URL; everything else is a 404.
const servedLogs = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const text = servedLogs.get(String(url));
  if (text !== undefined) return new Response(text, { status: 200 });
  if (String(url).endsWith('/did.jsonl')) return new Response('not found', { status: 404 });
  return realFetch(url, init);
};
afterEach(() => { cleanup(); delete globalThis.__provenanceQuery; delete globalThis.__verifyList; servedLogs.clear(); });

/** An author did:webvh on a mock Turnkey (local keys); `serveLog` publishes it where the browser looks. */
async function author(path = 'user-owner') {
  const turnkey = await mockTurnkey();
  const minted = await mintAuthor(turnkey, { path });
  return { ...minted, turnkey, vm: `${minted.did}#orig-1`, serveLog: () => servedLogs.set(`https://boop.ad/${path}/did.jsonl`, minted.jsonl) };
}

/** Serves stable query results by function name, as Convex subscriptions do. */
function serve(results) {
  globalThis.__provenanceQuery = ref => results[getFunctionName(ref)] ?? null;
}
/** A stored record in the shape convex/actionRecords.ts evidence() returns. */
async function actionRecord(_id, change, a, { status = 'signed', credential = { kind: 'session', id: 'session-row-abc123' }, attested = {}, signer } = {}) {
  const signedAt = 1700000005000;
  const payload = status === 'signed' ? { did: a.did, verificationMethod: a.vm, versionId: a.versionId } : { did: a.did };
  const built = buildActionRecord(change, payload, status === 'signed' ? signedAt : undefined);
  const listId = change.subject.listId ?? 'L', itemId = change.action.startsWith('item.') ? change.subject.itemId ?? 'I' : undefined;
  const record = { _id, ...built, status, listId, itemId, ownerUserId: 'U-owner',
    attested: canonicalize({ listId, ...(itemId ? { itemId } : {}), before: null, ...attested, occurredAt: 1700000000000, userId: 'U-owner', credential }) };
  if (status === 'failed') return { ...record, error: 'bad_signature' };
  if (status !== 'signed') return record;
  const sign = signer ?? (message => a.turnkey.sign('sub-org', a.keys.assertion.address, message));
  return { ...record, signature: encodeSignature(await sign(actionRecordSigningInput(built.payload))),
    publicKeyMultibase: a.keys.assertion.multikey, verificationMethod: a.vm, signedAt };
}
const completed = { action: 'item.completed', subject: { itemId: 'I' }, after: { checked: true } };
const created = { action: 'item.created', subject: { listId: 'L' }, after: { name: 'Item' } };
const reopened = { action: 'item.reopened', subject: { itemId: 'I' }, after: { checked: false } };
const bareItem = { _id: 'I', listId: 'L', name: 'Item', createdAt: 1, createdByDid: 'did:owner', checked: false };

test('historical item placeholders and opaque evidence receive explicit nonverified presentation', () => {
  const base = { type: 'ItemCreation', issuer: 'did:owner', actorDid: 'did:owner', issuanceDate: 1, action: 'created' };
  const item = { _id: 'I', listId: 'L', name: 'Item', createdAt: 1, createdByDid: 'did:owner', checked: false,
    vcProofs: [{ ...base, proof: JSON.stringify({ '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential'], credentialSubject: { id: 'did:owner' } }) }, { ...base, action: 'completed', proof: 'opaque-evidence' }] };
  const { container } = render(React.createElement(ItemProvenanceInfo, { item }));
  fireEvent.click(container.querySelector('button'));
  assert.match(container.textContent, /Creation record \(unsigned\)/);
  assert.match(container.textContent, /Completion record \(unverified\)/);
  assert.match(container.textContent, /does not prove personal authorship/);
  assert.doesNotMatch(container.textContent, /Verifiable Credential|cryptographic proof/);
});

test('historical list placeholder does not imply verified ownership', () => {
  const list = { _id: 'L', assetDid: 'did:cel:old', name: 'List', ownerDid: 'did:owner', createdAt: 1,
    vcProof: { type: 'ListOwnershipCredential', issuer: 'did:owner', issuanceDate: 1,
      credentialSubject: { id: 'did:cel:old', ownerDid: 'did:owner' }, proof: JSON.stringify({ '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential'], issuer: 'did:owner', credentialSubject: { id: 'did:owner' } }) } };
  const { container } = render(React.createElement(MemoryRouter, null, React.createElement(ListProvenanceInfo, { list })));
  fireEvent.click(container.querySelector('button'));
  assert.match(container.textContent, /Historical ownership record \(unsigned\)/);
  assert.doesNotMatch(container.textContent, /Ownership Verifiable Credential|cryptographic proof of ownership and authenticity/);
});

test('action records show their truthful signing status, the signed statement apart from what boop attests', async () => {
  const a = await author();
  a.serveLog();
  serve({ 'actionRecords:getItemActionRecords': [
    await actionRecord('R1', created, a),
    await actionRecord('R2', completed, a, { status: 'pending', credential: { kind: 'apiKey', id: 'key-row-111aaa' } }),
    await actionRecord('R3', reopened, a, { status: 'failed', credential: { kind: 'apiKey', id: 'key-row-222bbb' } }),
    await actionRecord('R4', completed, a, { status: 'unsigned' }),
  ] });
  const { container } = render(React.createElement(ItemProvenanceInfo, { item: bareItem }));
  fireEvent.click(container.querySelector('button'));
  const text = () => container.textContent;
  assert.match(text(), /Action records \(4\)/);
  assert.match(text(), /Creation recordSigned/);
  assert.match(text(), /Completion recordPending signature/);
  assert.match(text(), /Reopen recordSigning failedA signature was offered and did not verify \(bad_signature\), so this record carries no signature/);
  assert.match(text(), /Completion recordUnsignedNo signature exists for this record/);
  // Sessions and distinct API keys of one account read differently, and are marked as boop's unsigned record.
  assert.match(text(), /Via signed-in session …abc123 • Recorded .*\(boop's record, unsigned\)/);
  assert.match(text(), /Via API key …111aaa/);
  assert.match(text(), /Via API key …222bbb/);
  // The signed record names its key and DID version, and is verified here against the resolved DID log.
  await waitFor(() => assert.match(text(), /Signature verified in this browser against the author's DID key, resolved from the DID's own domain/));
  assert.match(text(), new RegExp(`Signed by key #orig-1 of this DID \\(version ${a.versionId}\\)`));
  assert.match(text(), /the author's own key signed exactly this record.*is boop's record and is not signed.*None of it shows personal intent or who was using that credential/);
  assert.doesNotMatch(text(), /Verifiable Credential|cryptographic proof|Historical action records/);
});

test('a signature is verified only against the resolved author DID; an unreachable DID, another key or tampering never reads as verified', async () => {
  const a = await author();
  const genuine = await actionRecord('R1', completed, a);

  // The DID's domain serves no log: boop's receipt check stands, but nothing is verified here.
  serve({ 'actionRecords:getItemActionRecords': [genuine] });
  const first = render(React.createElement(ItemProvenanceInfo, { item: bareItem }));
  fireEvent.click(first.container.querySelector('button'));
  await waitFor(() => assert.match(first.container.textContent, /Completion recordSignedboop verified this signature when it was recorded.*not independently verified here/));
  assert.doesNotMatch(first.container.textContent, /Signature verified/);
  cleanup();

  a.serveLog();
  const second = render(React.createElement(ItemProvenanceInfo, { item: bareItem }));
  fireEvent.click(second.container.querySelector('button'));
  await waitFor(() => assert.match(second.container.textContent, /Completion recordSignedSignature verified in this browser/));
  cleanup();

  // Signed by a key that is not the DID's assertion key (here: the author's own update key).
  const byUpdateKey = await actionRecord('R1', completed, a, { signer: message => a.turnkey.sign('sub-org', a.keys.author.address, message) });
  serve({ 'actionRecords:getItemActionRecords': [byUpdateKey] });
  const third = render(React.createElement(ItemProvenanceInfo, { item: bareItem }));
  fireEvent.click(third.container.querySelector('button'));
  await waitFor(() => assert.match(third.container.textContent, /Completion recordSignature check failed/));
  assert.doesNotMatch(third.container.textContent, /recordSigned|Signature verified/);
  cleanup();

  const tampered = { ...genuine, payload: genuine.payload.replace('"checked":true', '"checked":false') };
  serve({ 'actionRecords:getItemActionRecords': [tampered] });
  const fourth = render(React.createElement(ItemProvenanceInfo, { item: bareItem }));
  fireEvent.click(fourth.container.querySelector('button'));
  await waitFor(() => assert.match(fourth.container.textContent, /Completion recordSignature check failed/));
  assert.doesNotMatch(fourth.container.textContent, /recordSigned|Signature verified/);
  cleanup();

  // A log served for the DID that is not a valid author DID log is not used.
  const other = ed25519.utils.randomSecretKey();
  const forgedLog = a.jsonl.replace(/"proofValue":"z[^"]+"/, `"proofValue":"${encodeSignature(await ed25519.signAsync(new Uint8Array(3), other))}"`);
  servedLogs.set(`https://boop.ad/user-owner/did.jsonl`, forgedLog);
  serve({ 'actionRecords:getItemActionRecords': [genuine] });
  const fifth = render(React.createElement(ItemProvenanceInfo, { item: bareItem }));
  fireEvent.click(fifth.container.querySelector('button'));
  await waitFor(() => assert.match(fifth.container.textContent, /not independently verified here/));
  assert.doesNotMatch(fifth.container.textContent, /Signature verified/);
});

test('list-level records and historical placeholders are presented side by side with separate labels', async () => {
  const a = await author();
  serve({ 'actionRecords:getListActionRecords': [
    await actionRecord('R2', { action: 'list.renamed', subject: { listId: 'L' }, after: { name: 'List' } }, a, { status: 'pending', attested: { listAssetDid: 'did:cel:list', before: { name: 'Old' } } }),
    await actionRecord('R1', { action: 'list.created', subject: { createdAt: 1 }, after: { name: 'Old', kind: 'list' } }, a, { attested: { listAssetDid: 'did:cel:list' } }),
  ] });
  const list = { _id: 'L', assetDid: 'did:cel:list', name: 'List', ownerDid: a.did, createdAt: 1,
    vcProof: { type: 'ListOwnershipCredential', issuer: a.did, issuanceDate: 1, credentialSubject: { id: 'did:cel:list', ownerDid: a.did },
      proof: JSON.stringify({ '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential'], issuer: a.did, credentialSubject: { id: a.did } }) } };
  const { container } = render(React.createElement(MemoryRouter, null, React.createElement(ListProvenanceInfo, { list })));
  fireEvent.click(container.querySelector('button'));
  assert.match(container.textContent, /Rename recordPending signature/);
  assert.match(container.textContent, /List creation recordSigned/);
  assert.match(container.textContent, /Historical ownership record \(unsigned\)/);
  await waitFor(() => assert.match(container.textContent, /not independently verified here/));
});

/** The list provenance panel, opened. */
function openList(list) {
  const view = render(React.createElement(MemoryRouter, null, React.createElement(ListProvenanceInfo, { list })));
  fireEvent.click(view.container.querySelector('button'));
  return view;
}
const hosted = { did: 'did:vh:zList', log: '', head: '2-zHead', author: null, resources: [] };

test('a legacy did:cel list says it is re-minted on open, never that its history verified', () => {
  serve({ 'originalsHost:getAccepted': null });
  globalThis.__verifyList = () => { throw new Error('nothing to verify'); };
  const { container } = openList({ _id: 'L', assetDid: 'did:cel:old', name: 'List', ownerDid: 'did:owner', createdAt: 1 });
  assert.match(container.textContent, /Signed History/);
  assert.match(container.textContent, /Made before Originals 6\. Its owner re-mints it when they open it\./);
  assert.doesNotMatch(container.textContent, /verified/i);
});

test('a list with no Original yet says when it will be minted, and shows no asset DID', () => {
  serve({ 'originalsHost:getAccepted': null });
  const { container } = openList({ _id: 'L', name: 'List', ownerDid: 'did:owner', createdAt: 1 });
  assert.match(container.textContent, /Not an Original yet\. It's minted when its owner next opens it\./);
  assert.doesNotMatch(container.textContent, /List DID \(Original\)/);
});

test('an Original is called verified only once the check passes, with the version it is valid as of', async () => {
  serve({ 'originalsHost:getAccepted': hosted });
  let finish;
  globalThis.__verifyList = listId => {
    assert.equal(listId, 'L');
    return new Promise(resolve => { finish = resolve; });
  };
  const { container } = openList({ _id: 'L', assetDid: 'did:vh:zList', name: 'List', ownerDid: 'did:owner', createdAt: 1 });
  assert.match(container.textContent, /List DID \(Original\)/);
  assert.match(container.textContent, /Verifying signed history/);
  assert.doesNotMatch(container.textContent, /history verified/);
  finish({ did: 'did:vh:zList', verified: true, content: 'available', validAsOf: { checkpoint: '2-zHead', signers: [] }, checkpoint: '2-zHead', reasons: ['not-anchored'] });
  await waitFor(() => assert.match(container.textContent, /Signed history verified, as of version 2/));
});

test('a failed check names why, and never reads as verified', async () => {
  serve({ 'originalsHost:getAccepted': hosted });
  globalThis.__verifyList = async () => ({ did: 'did:vh:zList', verified: false, content: 'partial', validAsOf: null,
    checkpoint: '2-zHead', reasons: ['not-anchored'], error: "Its content doesn't match its signed history" });
  const { container } = openList({ _id: 'L', assetDid: 'did:vh:zList', name: 'List', ownerDid: 'did:owner', createdAt: 1 });
  await waitFor(() => assert.match(container.textContent, /Signed history failed verification: Its content doesn't match its signed history/));
  assert.doesNotMatch(container.textContent, /history verified/);
});
