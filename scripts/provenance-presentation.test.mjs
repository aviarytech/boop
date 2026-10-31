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
const { actionRecordSigningInput, base58Encode, buildActionRecord, ed25519Multikey, encodeSignature } = await import('../shared/actionRecord.ts');

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
afterEach(() => { cleanup(); delete globalThis.__provenanceQuery; delete globalThis.__verifyList; });

/** Serves stable query results by function name, as Convex subscriptions do. */
function serve(results) {
  globalThis.__provenanceQuery = ref => results[getFunctionName(ref)] ?? null;
}
async function actionRecord(_id, change, { ownerDid, secret, status = 'signed', credential = { kind: 'session', id: 'session-row-abc123' } }) {
  const built = buildActionRecord(change, { occurredAt: 1700000000000, owner: { did: ownerDid, userId: 'U-owner' }, credential });
  const record = { _id, ...built, status, listId: change.subject.listId, itemId: change.subject.itemId, ownerUserId: 'U-owner' };
  if (status !== 'signed') return status === 'failed' ? { ...record, error: 'signing_request_failed' } : record;
  const publicKeyMultibase = ed25519Multikey(await ed25519.getPublicKeyAsync(secret));
  return { ...record, signature: encodeSignature(await ed25519.signAsync(actionRecordSigningInput(built.payload), secret)),
    publicKeyMultibase, verificationMethod: `did:key:${publicKeyMultibase}#${publicKeyMultibase}`, signedAt: 1700000005000 };
}
const subject = { listId: 'L', itemId: 'I' };
const completed = { action: 'item.completed', subject, before: { checked: false }, after: { checked: true, checkedAt: 5 } };
const created = { action: 'item.created', subject, before: null, after: { name: 'Item', checked: false } };
const reopened = { action: 'item.reopened', subject, before: { checked: true }, after: { checked: false } };
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

test('new action records show their truthful signing status without claiming verification or intent', async () => {
  const secret = ed25519.utils.randomSecretKey();
  const ownerDid = 'did:webvh:QmScid:boop.ad:user-owner';
  serve({ 'actionRecords:getItemActionRecords': [
    await actionRecord('R1', created, { ownerDid, secret }),
    await actionRecord('R2', completed, { ownerDid, secret, status: 'pending', credential: { kind: 'apiKey', id: 'key-row-111aaa' } }),
    await actionRecord('R3', reopened, { ownerDid, secret, status: 'failed', credential: { kind: 'apiKey', id: 'key-row-222bbb' } }),
    await actionRecord('R4', completed, { ownerDid, secret, status: 'unsigned' }),
  ] });
  const { container } = render(React.createElement(ItemProvenanceInfo, { item: bareItem }));
  fireEvent.click(container.querySelector('button'));
  const text = () => container.textContent;
  assert.match(text(), /Action records \(4\)/);
  assert.match(text(), /Creation recordSigned/);
  assert.match(text(), /Completion recordPending signature/);
  assert.match(text(), /Reopen recordSigning failed/);
  assert.match(text(), /Completion recordUnsigned/);
  // Sessions and distinct API keys of one account read differently.
  assert.match(text(), /Via signed-in session …abc123/);
  assert.match(text(), /Via API key …111aaa/);
  assert.match(text(), /Via API key …222bbb/);
  // A did:webvh owner's key cannot be checked from the DID alone, so nothing says "verified".
  await waitFor(() => assert.match(text(), /matches the key boop recorded.*not independently verified here/));
  assert.doesNotMatch(text(), /Signature verified/);
  assert.match(text(), /after an operation authenticated by the named session or API key.*does not show personal intent or who was using that credential/);
  assert.doesNotMatch(text(), /Verifiable Credential|cryptographic proof|Historical action records/);
});

test('a signature is called verified only against a key the owner DID itself encodes, and tampering is flagged', async () => {
  const secret = ed25519.utils.randomSecretKey();
  const didKey = `did:key:${base58Encode(await ed25519.getPublicKeyAsync(secret))}`;
  const genuine = await actionRecord('R1', completed, { ownerDid: didKey, secret });
  serve({ 'actionRecords:getItemActionRecords': [genuine] });
  const first = render(React.createElement(ItemProvenanceInfo, { item: bareItem }));
  fireEvent.click(first.container.querySelector('button'));
  await waitFor(() => assert.match(first.container.textContent, /Completion recordSignedSignature verified against the key in the authorizing account's DID/));
  cleanup();

  // Same record, signed by a key the did:key owner does not name: integrity holds, binding does not.
  const other = ed25519.utils.randomSecretKey();
  serve({ 'actionRecords:getItemActionRecords': [await actionRecord('R1', completed, { ownerDid: didKey, secret: other })] });
  const second = render(React.createElement(ItemProvenanceInfo, { item: bareItem }));
  fireEvent.click(second.container.querySelector('button'));
  await waitFor(() => assert.match(second.container.textContent, /not independently verified here/));
  assert.doesNotMatch(second.container.textContent, /Signature verified/);
  cleanup();

  const tampered = { ...genuine, payload: genuine.payload.replace('"checkedAt":5', '"checkedAt":6') };
  serve({ 'actionRecords:getItemActionRecords': [tampered] });
  const third = render(React.createElement(ItemProvenanceInfo, { item: bareItem }));
  fireEvent.click(third.container.querySelector('button'));
  await waitFor(() => assert.match(third.container.textContent, /Completion recordSignature check failed/));
  assert.doesNotMatch(third.container.textContent, /recordSigned|Signature verified/);
});

test('list-level records and historical placeholders are presented side by side with separate labels', async () => {
  const secret = ed25519.utils.randomSecretKey();
  const ownerDid = 'did:webvh:QmScid:boop.ad:user-owner';
  const listSubject = { listId: 'L', listAssetDid: 'did:cel:list' };
  serve({ 'actionRecords:getListActionRecords': [
    await actionRecord('R2', { action: 'list.renamed', subject: listSubject, before: { name: 'Old' }, after: { name: 'List' } }, { ownerDid, secret, status: 'pending' }),
    await actionRecord('R1', { action: 'list.created', subject: listSubject, before: null, after: { name: 'Old', kind: 'list' } }, { ownerDid, secret }),
  ] });
  const list = { _id: 'L', assetDid: 'did:cel:list', name: 'List', ownerDid, createdAt: 1,
    vcProof: { type: 'ListOwnershipCredential', issuer: ownerDid, issuanceDate: 1, credentialSubject: { id: 'did:cel:list', ownerDid },
      proof: JSON.stringify({ '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential'], issuer: ownerDid, credentialSubject: { id: ownerDid } }) } };
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
  assert.match(container.textContent, /Made before Originals 5\. Its owner re-mints it when they open it\./);
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
