import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

await build({
  entryPoints: ['src/components/ProvenanceInfo.tsx'], outfile: 'tmp/provenance-presentation/component.mjs',
  bundle: true, jsx: 'automatic', platform: 'node', format: 'esm',
  external: ['react', 'react/jsx-runtime', 'react-router-dom', 'convex/server'],
  plugins: [{ name: 'provenance-fixture', setup(b) {
    b.onResolve({ filter: /(?:lib\/(authenticatedConvex|originals)|hooks\/(useCurrentUser|useSettings))$/ }, ({ path }) => ({ path: path.split('/').pop(), namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: {
      authenticatedConvex: 'export const useQuery=()=>null; export const useMutation=()=>async()=>{};',
      useCurrentUser: 'export const useCurrentUser=()=>({did:"did:owner"});',
      useSettings: 'export const useSettings=()=>({haptic:()=>{}});',
      originals: 'export const verifyListEnvelope=async()=>({verified:false}); export const isRetroactiveGenesis=()=>false; export const createListAsset=async()=>{};',
    }[path] }));
  } }],
});
const { ItemProvenanceInfo, ListProvenanceInfo } = await import(pathToFileURL(`${process.cwd()}/tmp/provenance-presentation/component.mjs`));
afterEach(cleanup);

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
