// Copy-only regression checks for #232. These are source-contract tests,
// not proof of rendered behavior, independent verification, or live readiness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

for (const path of ['src/components/ShareModal.tsx', 'src/components/publish/PublishModal.tsx']) {
  test(`${path}: both publication states explain mutable public contents`, () => {
    const source = read(path);
    assert.match(source, /The public link shows the current list and can change after publication\./);
    assert.match(source, /It does not show or verify a sealed snapshot\./);
    assert.doesNotMatch(source, /verify who added each item|verifiable DID|with a verifiable/);
  });
}

for (const path of ['src/pages/PublicList.tsx', 'src/components/SharedListResource.tsx']) {
  test(`${path}: reader labels current data independently of evidence presence`, () => {
    const source = read(path);
    assert.match(source, /<section aria-label="Publication evidence"/);
    assert.match(source, /Live list · not a sealed snapshot/);
    assert.match(source, /This page shows the current list, which can change after publication\./);
    assert.match(source, /It does not verify a sealed snapshot or who added each item\./);
  });
}

test('publish dialog does not promise contributor names absent from its public reader', () => {
  const source = read('src/components/publish/PublishModal.tsx');
  assert.match(source, /can see the current list contents\. This page does not verify item authorship\./);
  assert.doesNotMatch(source, /recorded contributor names|Contributor names will be shown/);
});

test('canonical public reader never treats proof presence or a DID as verification', () => {
  const source = read('src/components/SharedListResource.tsx');
  assert.doesNotMatch(source, /Cryptographically signed|Verified with/);
  assert.match(source, /Supplied proof \(unverified\)/);
  assert.match(source, /Declared issuer:/);
  assert.match(source, /Identifier \(unverified\):/);
  assert.match(source, /These supplied details have not been cryptographically verified by this page\./);
});
