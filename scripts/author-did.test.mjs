// #286 PR b: author DIDs on two Turnkey keys, the server's continuation check,
// and the sign-in flow that moves an account onto an author DID.
//
// TURNKEY IS MOCKED (scripts/helpers/author-did-fixture.ts): each wallet
// account is a local Ed25519 key. The DID mint, resolution and checks are real
// (didwebvh-ts). The SDK 5 end-to-end proof is scripts/originals-author-sdk5.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const outdir = 'tmp/author-did-test';
await mkdir(outdir, { recursive: true });
const load = async (entry, name, plugins = []) => {
  await build({ entryPoints: [entry], outfile: `${outdir}/${name}.mjs`, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent', plugins });
  return import(`${pathToFileURL(`${process.cwd()}/${outdir}/${name}.mjs`).href}?t=${Date.now()}`);
};
const fixture = await load('scripts/helpers/author-did-fixture.ts', 'fixture');
const { mockTurnkey, mintAuthor, mintLegacyDid, updateAuthor, resignLastEntry, withProof, deactivateAuthor, pinned, authorDid, authorDidLog, shared } = fixture;

// authorIdentity with its Turnkey session and Convex URL replaced by the test's.
const t = globalThis.__authorIdentityTest = { ready: true, backend: null };
const identity = await load('src/lib/authorIdentity.ts', 'identity', [{
  name: 'stubs', setup(b) {
    b.onResolve({ filter: /^(\.\/turnkeySession|\.\/convexUrls|@capacitor\/core)$/ }, args => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ loader: 'js', contents: {
      './turnkeySession': 'const t=()=>globalThis.__authorIdentityTest; export const authorSigningReady=async()=>t().ready; export const turnkeyAuthorBackend=()=>t().backend;',
      './convexUrls': 'export const getConvexHttpUrl=()=>"https://convex.test";',
      '@capacitor/core': 'export const Capacitor={isNativePlatform:()=>false};',
    }[path] }));
  },
}]);
globalThis.window ??= { location: { host: 'boop.ad' } };
globalThis.localStorage ??= { removeItem() {}, getItem: () => null, setItem() {} };

const SUB_ORG = 'sub-org';
const PATH = 'user-sub-org';

test('an author DID: one update key (the author key), #orig-1 the assertion key, every controller the DID', async () => {
  const turnkey = await mockTurnkey([shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]);
  const author = await mintAuthor(turnkey, { path: PATH });
  const [genesis] = authorDid.parseDidLog(author.jsonl);
  assert.deepEqual(genesis.parameters.updateKeys, [author.keys.author.multikey]);
  for (const vm of genesis.state.verificationMethod) assert.equal(vm.controller, author.did);
  assert.deepEqual(genesis.state.assertionMethod, ['#orig-1']);
  assert.equal(genesis.state.verificationMethod.find(vm => vm.id === '#orig-1').publicKeyMultibase, author.keys.assertion.multikey);
  assert.notEqual(author.keys.author.multikey, author.keys.assertion.multikey);
  assert.ok(!turnkey.calls.some(c => c.op === 'create'), 'an existing assertion account is reused');
  assert.deepEqual((await authorDidLog.checkDidLog(author.jsonl, pinned(author.keys))).authorProblems, []);
  assert.match((await authorDidLog.checkDidLog(author.jsonl)).authorProblems.join(), /keys are unknown/, 'unpinned, nothing is an author DID');
  const stranger = await mintAuthor(await mockTurnkey(), { path: PATH });
  assert.ok((await authorDidLog.checkDidLog(stranger.jsonl, pinned(author.keys))).authorProblems.length > 0, 'another sub-org\'s keys are not this account\'s author DID');
});

test('a sub-org without the assertion account gets it created through the session', async () => {
  const turnkey = await mockTurnkey([shared.AUTHOR_KEY_PATH]);
  const keys = await authorDid.resolveAuthorKeys(turnkey, SUB_ORG);
  assert.deepEqual(turnkey.calls.filter(c => c.op === 'create'), [{ op: 'create', path: shared.ASSERTION_KEY_PATH }]);
  assert.equal(keys.assertion.path, shared.ASSERTION_KEY_PATH);
});

test('a Turnkey signature that does not verify for the expected key is refused, not published', async () => {
  const turnkey = await mockTurnkey([shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]);
  const keys = await authorDid.resolveAuthorKeys(turnkey, SUB_ORG);
  const wrongKey = { ...turnkey, sign: (s, _address, m) => turnkey.sign(s, keys.assertion.address, m) };
  await assert.rejects(() => authorDid.mintAuthorDid({ backend: wrongKey, subOrgId: SUB_ORG, keys, domain: 'boop.ad', path: PATH }), /does not verify/);
});

test('pre-#286 DIDs are not author DIDs', async () => {
  const legacy = await mintLegacyDid();
  const { authorProblems } = await authorDidLog.checkDidLog(legacy.jsonl);
  assert.ok(authorProblems.some(p => /not controlled by the DID/.test(p)));
  assert.ok(authorProblems.some(p => /also an update key/.test(p)));
});

test('storeDidLog: only a continuation signed by the update keys before it', async () => {
  const turnkey = await mockTurnkey([shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]);
  const author = await mintAuthor(turnkey, { path: PATH });
  const updated = await updateAuthor(turnkey, author);
  const checked = await authorDidLog.checkDidLogWrite(author.jsonl, updated);
  assert.equal(checked.entries, 2);
  assert.equal(checked.did, author.did);
  assert.equal((await authorDidLog.checkDidLogWrite(author.jsonl, author.jsonl)).entries, 1, 'storing the same log again is fine');

  // Signed by the assertion key, which is not an update key.
  const forged = await resignLastEntry(updated, author.keys.author.multikey, turnkey.secretFor(shared.ASSERTION_KEY_PATH), author.keys.assertion.multikey);
  await assert.rejects(() => authorDidLog.checkDidLogWrite(author.jsonl, forged), /not an update key/);

  // Another DID (a new SCID) is not a continuation.
  const other = await mintAuthor(await mockTurnkey(), { path: PATH });
  await assert.rejects(() => authorDidLog.checkDidLogWrite(author.jsonl, other.jsonl), /new SCID/);

  // Served history can be neither dropped nor rewritten.
  await assert.rejects(() => authorDidLog.checkDidLogWrite(updated, author.jsonl), /drops entries/);
  const [first, second] = updated.split('\n');
  const rewritten = [JSON.stringify({ ...JSON.parse(first), versionTime: '2020-01-01T00:00:00Z' }), second].join('\n');
  await assert.rejects(() => authorDidLog.checkDidLogWrite(author.jsonl, rewritten), /does not verify|rewrites|only verifies/);

  // A tampered new entry stops resolution short of the end.
  const tampered = [first, JSON.stringify({ ...JSON.parse(second), state: { ...JSON.parse(second).state, service: [] } })].join('\n');
  await assert.rejects(() => authorDidLog.checkDidLogWrite(author.jsonl, tampered), /does not verify|only verifies/);
  await assert.rejects(() => authorDidLog.checkDidLogWrite(null, 'not json'), /not JSON Lines/);
});

// #300 review: didwebvh-ts 2.8 accepts `proof: []`, i.e. no signature at all.
test('an entry without a signature is refused, at genesis or after', async () => {
  const turnkey = await mockTurnkey([shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]);
  const author = await mintAuthor(turnkey, { path: PATH });
  const updated = await updateAuthor(turnkey, author);
  for (const proof of [[], null, {}]) {
    await assert.rejects(() => authorDidLog.checkDidLogWrite(author.jsonl, withProof(updated, 1, proof)), /not signed|does not verify|not a did:key/, JSON.stringify(proof));
    await assert.rejects(() => authorDidLog.checkDidLog(withProof(author.jsonl, 0, proof)), /not signed|does not verify|not a did:key|Missing proof/, JSON.stringify(proof));
  }
});

test('witnesses, pre-rotation, deactivation and other domains are refused', async () => {
  const turnkey = await mockTurnkey([shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]);
  const author = await mintAuthor(turnkey, { path: PATH });
  const [genesis] = authorDid.parseDidLog(author.jsonl);
  for (const parameters of [{ witness: { threshold: 1, witnesses: [{ id: 'did:key:z6Mkw' }] } }, { nextKeyHashes: ['Qm'] }]) {
    const tampered = JSON.stringify({ ...genesis, parameters: { ...genesis.parameters, ...parameters } });
    await assert.rejects(() => authorDidLog.checkDidLog(tampered), /witnesses|pre-rotation/);
  }
  const deactivated = await deactivateAuthor(turnkey, author);
  await assert.rejects(() => authorDidLog.checkDidLogWrite(author.jsonl, deactivated), /deactivated/);
  await assert.rejects(() => authorDidLog.checkDidLog(author.jsonl, { domain: 'evil.example' }), /names boop.ad, not evil.example/);
  assert.equal((await authorDidLog.checkDidLog(author.jsonl, { domain: 'boop.ad' })).did, author.did);
});

/** A fake Convex HTTP API serving one account's DID log. */
function server(initial = {}) {
  const state = { log: initial.log ?? null, did: initial.did ?? null, calls: [], fail: initial.fail ?? {}, pin: initial.pin };
  const fetch = async (url, options = {}) => {
    const { pathname } = new URL(url);
    const body = options.body ? JSON.parse(options.body) : undefined;
    state.calls.push([options.method ?? 'GET', pathname, body]);
    if (state.fail[pathname]) return new Response('refused', { status: state.fail[pathname] });
    if (pathname === '/api/did/log' && !options.method) return state.log ? new Response(state.log) : new Response('Not found', { status: 404 });
    if (pathname === '/api/did/log') { await authorDidLog.checkDidLog(body.log); state.log = body.log; return Response.json({ ok: true }); }
    if (pathname === '/api/user/updateDID') { state.did = body.did; return Response.json({ success: true, did: body.did }); }
    if (pathname === '/api/user/remintDid') {
      const checked = await authorDidLog.checkDidLog(body.didLog, state.pin);
      assert.deepEqual(checked.authorProblems, []);
      state.did = body.did; state.log = body.didLog;
      return Response.json({ success: true, newDid: body.did, rewritten: 3 });
    }
    throw new Error(`unexpected ${pathname}`);
  };
  return { state, fetch };
}

async function ensure(user, api, turnkey) {
  t.backend = turnkey;
  api.state.pin ??= pinned(await authorDid.resolveAuthorKeys(turnkey, SUB_ORG));
  return identity.ensureAuthorDid({ turnkeySubOrgId: SUB_ORG, ...user }, 'jwt', {
    backend: turnkey, ready: async () => t.ready, fetch: api.fetch, httpUrl: 'https://convex.test', domain: 'boop.ad',
  });
}

test('without a live Turnkey session nothing is minted and nothing can sign', async () => {
  identity.clearCurrentAuthor();
  t.ready = false;
  const api = server();
  try {
    assert.deepEqual(await ensure({ did: 'did:temp:x' }, api, await mockTurnkey()), { status: 'not-ready' });
  } finally { t.ready = true; }
  assert.deepEqual(api.state.calls, []);
  assert.equal(await identity.turnkeyListAuthorSource(), null);
});

test('a new account stores its author log, then adopts the DID; nothing is adopted if the server refuses', async () => {
  const turnkey = await mockTurnkey([shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]);
  const api = server();
  const result = await ensure({ did: 'did:temp:sub-org' }, api, turnkey);
  assert.equal(result.status, 'adopted');
  assert.deepEqual(api.state.calls.map(c => c.slice(0, 2).join(' ')), ['GET /api/did/log', 'POST /api/did/log', 'POST /api/user/updateDID'], 'the log is served before the DID is adopted');
  assert.equal(api.state.did, result.did);
  assert.ok(result.did.endsWith(`:boop.ad:${PATH}`));

  const refused = server({ fail: { '/api/user/updateDID': 403 } });
  const other = await mockTurnkey();
  await assert.rejects(() => ensure({ did: 'did:temp:sub-org' }, refused, other), /updateDID failed: 403/);
});

test('a pre-#286 or stale-domain DID is re-genesised through remintDid', async () => {
  for (const legacy of [await mintLegacyDid('boop.ad', PATH), await mintAuthor(await mockTurnkey(), { domain: 'trypoo.app', path: PATH })]) {
    const turnkey = await mockTurnkey([shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]);
    const api = server({ log: legacy.jsonl, did: legacy.did });
    const result = await ensure({ did: legacy.did }, api, turnkey);
    assert.equal(result.status, 'reminted');
    assert.equal(result.previousDid, legacy.did);
    assert.notEqual(result.did, legacy.did);
    assert.equal(api.state.calls.at(-1)[1], '/api/user/remintDid');
    assert.ok(!api.state.calls.some(c => c[1] === '/api/user/updateDID'));
  }
});

test('an account already on its author DID keeps it, and its ListAuthor signs with #orig-1 at the current version', async () => {
  const turnkey = await mockTurnkey([shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]);
  const author = await mintAuthor(turnkey, { path: PATH });
  const api = server({ log: author.jsonl, did: author.did });
  assert.deepEqual(await ensure({ did: author.did }, api, turnkey), { status: 'current', did: author.did });
  assert.ok(!api.state.calls.some(c => c[0] === 'POST'), 'nothing is minted or posted');

  const listAuthor = await identity.turnkeyListAuthorSource();
  assert.deepEqual(listAuthor.author, { did: author.did, verificationMethod: `${author.did}#orig-1`, versionId: author.versionId });
  assert.equal(listAuthor.signer.verificationMethod, `${author.did}#orig-1`);
  assert.equal(listAuthor.signer.cryptosuite, 'eddsa-jcs-2022');
  assert.equal(listAuthor.evidence.did, author.did);
  assert.equal(listAuthor.evidence.log, author.jsonl);
  assert.equal(listAuthor.evidence.source, 'supplied');
  assert.ok(!Number.isNaN(Date.parse(listAuthor.evidence.obtainedAt)));

  t.ready = false;
  try { assert.equal(await identity.turnkeyListAuthorSource(), null, 'an expired session signs nothing'); }
  finally { t.ready = true; }
  identity.clearCurrentAuthor();
  assert.equal(await identity.turnkeyListAuthorSource(), null, 'nobody signed in');
});

test('a device with the old DID cached follows the move another device made, minting nothing', async () => {
  const turnkey = await mockTurnkey([shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]);
  const author = await mintAuthor(turnkey, { path: PATH });
  const api = server({ log: author.jsonl, did: author.did });
  const before = turnkey.calls.filter(c => c.op === 'sign').length;
  const result = await ensure({ did: 'did:webvh:OLD:boop.ad:user-sub-org' }, api, turnkey);
  assert.deepEqual(result, { status: 'moved', did: author.did, previousDid: 'did:webvh:OLD:boop.ad:user-sub-org' });
  assert.equal(turnkey.calls.filter(c => c.op === 'sign').length, before, 'no throwaway genesis');
  assert.ok(!api.state.calls.some(c => c[0] === 'POST'));
  assert.equal((await identity.turnkeyListAuthorSource()).author.did, author.did);
});

test('a sign-up whose updateDID failed adopts the author DID it already stored', async () => {
  const turnkey = await mockTurnkey([shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]);
  const author = await mintAuthor(turnkey, { path: PATH });
  const api = server({ log: author.jsonl });
  assert.deepEqual(await ensure({ did: 'did:temp:sub-org' }, api, turnkey), { status: 'adopted', did: author.did });
  assert.deepEqual(api.state.calls.filter(c => c[0] === 'POST').map(c => [c[1], c[2].did]), [['/api/user/updateDID', author.did]]);
});

test('an author DID whose served log names other keys is re-genesised (the server decides whether to move it)', async () => {
  const someoneElse = await mintAuthor(await mockTurnkey(), { path: PATH });
  const api = server({ log: someoneElse.jsonl, did: someoneElse.did });
  const result = await ensure({ did: someoneElse.did }, api, await mockTurnkey([shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]));
  assert.equal(result.status, 'reminted');
});
