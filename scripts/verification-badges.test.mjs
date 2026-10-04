import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, cleanup, fireEvent } = await import('@testing-library/react');

// Small local component transforms only: no app build, backend or network.
await build({
  entryPoints: {
    header: 'src/components/VerificationBadge.tsx',
    public: 'src/components/publish/VerificationBadge.tsx',
  },
  outdir: 'tmp/verification-badges', outExtension: { '.js': '.mjs' },
  bundle: true, jsx: 'automatic', platform: 'node', format: 'esm',
  external: ['react', 'react/jsx-runtime'],
});
const { ListVerificationBadge, ItemVerificationBadge } = await import(pathToFileURL(`${process.cwd()}/tmp/verification-badges/header.mjs`));
const { VerificationBadge: PublicBadge } = await import(pathToFileURL(`${process.cwd()}/tmp/verification-badges/public.mjs`));
afterEach(cleanup);

function assertNoVerificationClaim(container) {
  assert.doesNotMatch(container.textContent, /\bVerified\b|✓|✅|Verifiable Credential|cryptographic proof|cryptographically proves/i);
  // The old shield/checkmark must not survive a copy-only fix.
  assert.equal(container.querySelector('path[d^="M9 12l2 2 4-4"]'), null);
}

for (const did of [undefined, '', 'did:cel:recorded', 'not-a-valid-did']) {
  test(`header identifier ${JSON.stringify(did)} is never verification`, () => {
    const { container, getByLabelText } = render(React.createElement(ListVerificationBadge, { did }));
    const badge = getByLabelText(did ? 'DID (unverified)' : 'No DID');
    fireEvent.mouseEnter(badge.parentElement);
    assert.match(container.textContent, did ? /does not verify authenticity, ownership, or authorship/ : /No decentralized identifier is recorded/);
    assert.ok(getByLabelText('Not anchored'));
    assertNoVerificationClaim(container);
  });

  test(`compact item identifier ${JSON.stringify(did)} is neutral or absent`, () => {
    const { container, getByLabelText } = render(React.createElement(ItemVerificationBadge, { did }));
    if (did) {
      fireEvent.mouseEnter(getByLabelText('DID (unverified)').parentElement);
      assert.match(container.textContent, /does not verify authenticity, ownership, or authorship/);
    } else {
      assert.equal(container.childElementCount, 0);
    }
    assertNoVerificationClaim(container);
  });
}

for (const anchorStatus of ['verified', 'pending', 'none']) {
  test(`anchor ${anchorStatus} retains its separate evidence state`, () => {
    const { container, getByLabelText } = render(React.createElement(ListVerificationBadge, {
      did: 'did:cel:recorded', anchorStatus, anchorBlockHeight: 123456, anchorTxId: 'anchor-transaction',
    }));
    const label = { verified: 'Anchored', pending: 'Pending', none: 'Not anchored' }[anchorStatus];
    fireEvent.mouseEnter(getByLabelText(label).parentElement);
    assert.ok(getByLabelText('DID (unverified)'));
    if (anchorStatus === 'verified') {
      assert.match(container.textContent, /Anchored to Bitcoin/);
      assert.match(container.textContent, /Block: 123,456/);
      assert.match(container.textContent, /Tx: anchor-transaction/);
    } else if (anchorStatus === 'pending') {
      assert.match(container.textContent, /awaiting confirmation/);
      assert.doesNotMatch(container.textContent, /immutable proof of existence/);
    } else {
      assert.match(container.textContent, /has not been anchored/);
      assert.doesNotMatch(container.textContent, /immutable proof of existence/);
    }
  });
}

test('compact item keeps a confirmed anchor without a DID', () => {
  const { getByLabelText, queryByLabelText, container } = render(React.createElement(ItemVerificationBadge, { anchorStatus: 'verified' }));
  assert.equal(queryByLabelText('No DID'), null);
  fireEvent.mouseEnter(getByLabelText('Anchored').parentElement);
  assert.match(container.textContent, /Anchored to Bitcoin/);
});

for (const [name, didDocument] of [
  ['absent', undefined], ['null', null], ['empty', ''], ['malformed JSON', '{oops'],
  ['JSON null', 'null'], ['primitive', '42'], ['array', '[]'],
  ['empty object', '{}'], ['malformed method', '{"verificationMethod":[null]}'],
  ['declared key', JSON.stringify({ id: 'did:webvh:published', verificationMethod: [{ id: 'did:webvh:published#key-1' }] })],
]) {
  test(`public badge with ${name} document remains explicitly unverified`, () => {
    const { container, getByRole } = render(React.createElement(PublicBadge, { did: 'did:webvh:published', didDocument }));
    const button = getByRole('button', { name: 'Identifier details' });
    assert.equal(button.textContent.trim(), 'DID (unverified)');
    assertNoVerificationClaim(container);
    fireEvent.click(button);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.match(container.textContent, /does not verify the DID document or the list's authenticity, ownership, or authorship/);
    assert.match(container.textContent, /Historical attribution records may be unsigned/);
    assertNoVerificationClaim(container);
    if (name === 'declared key') {
      assert.match(container.textContent, /Declared verification method \(unverified\)/);
      assert.match(container.textContent, /did:webvh:published#key-1/);
    }
    fireEvent.click(button);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
  });
}
