// LWS agent auth, phase 3 (docs/lws-agent-auth.md "App"): the app's DID
// updates that add and remove agent keys, published as continuations of the
// served log, and Originals signing at the version they make.
//
// TURNKEY IS MOCKED (scripts/helpers/author-did-fixture.ts): each wallet
// account is a local Ed25519 key. didwebvh-ts, the server's write check
// (convex/lib/authorDidLog.ts) and the Originals host's judge are real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const outdir = 'tmp/agent-keys-test';
await mkdir(outdir, { recursive: true });
await build({
  stdin: {
    contents: [
      "export * from './scripts/helpers/author-did-fixture.ts';",
      "export * as identity from './src/lib/authorIdentity.ts';",
      "export * as agentKeys from './src/lib/agentKeys.ts';",
      "export { makeHost, judgeSubmission, originals } from './scripts/helpers/originals-v5-fixture.ts';",
    ].join('\n'),
    resolveDir: process.cwd(), loader: 'ts',
  },
  outfile: `${outdir}/bundle.mjs`, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [{
    name: 'stubs', setup(b) {
      b.onResolve({ filter: /^(\.\/turnkeySession|\.\/convexUrls|@capacitor\/core)$/ }, args => ({ path: args.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ loader: 'js', contents: {
        './turnkeySession': 'export const authorSigningReady=async()=>true; export const turnkeyAuthorBackend=()=>globalThis.__agentKeysTest.backend;',
        './convexUrls': 'export const getConvexHttpUrl=()=>"https://convex.test";',
        '@capacitor/core': 'export const Capacitor={isNativePlatform:()=>false,getPlatform:()=>"web"};',
      }[path] }));
    },
  }],
});
const t = globalThis.__agentKeysTest = { backend: null };
globalThis.window ??= { location: { host: 'boop.ad' } };
globalThis.localStorage ??= { removeItem() {}, getItem: () => null, setItem() {} };
const {
  mockTurnkey, mintAuthor, agentKey, changeAgentMethod, pinned, authorDid, authorDidLog, shared, originals,
  identity, agentKeys, makeHost, judgeSubmission,
} = await import(`${pathToFileURL(`${process.cwd()}/${outdir}/bundle.mjs`).href}?t=${Date.now()}`);

const SUB_ORG = 'sub-org';
const PATH = 'user-sub-org';
const A = 'agent-aaaaaaaaaa';
const B = 'agent-bbbbbbbbbb';

/**
 * A fake Convex HTTP API serving one account's DID log. POST /api/did/log
 * runs the server's own write check with the account's keys pinned, and
 * keeps `author` true, as storeDidLog requires of a continuation it stores.
 */
function server(author) {
  const state = { log: author.jsonl, calls: [], conflicts: [] };
  const fetch = async (url, options = {}) => {
    const { pathname, searchParams } = new URL(url);
    const body = options.body ? JSON.parse(options.body) : undefined;
    state.calls.push([options.method ?? 'GET', pathname, body]);
    if (pathname !== '/api/did/log') throw new Error(`unexpected ${pathname}`);
    if (!options.method) {
      assert.equal(searchParams.get('path'), PATH);
      return new Response(state.log);
    }
    assert.equal(options.headers.Authorization, 'Bearer jwt');
    assert.deepEqual([body.userDid, body.path], [author.did, PATH]);
    // Another device's write landed first: compare-and-swap fails.
    const conflict = state.conflicts.shift();
    if (conflict) { state.log = await conflict(state.log); return Response.json({ error: 'DID log conflict' }, { status: 409 }); }
    const checked = await authorDidLog.checkDidLogWrite(state.log, body.log, pinned(author.keys));
    assert.deepEqual(checked.authorProblems, [], 'the stored author flag stays true');
    assert.equal(checked.did, author.did);
    state.log = body.log;
    return Response.json({ ok: true });
  };
  return { state, fetch };
}

async function setup() {
  const turnkey = await mockTurnkey([shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]);
  const author = await mintAuthor(turnkey, { path: PATH });
  const api = server(author);
  const deps = { backend: turnkey, ready: async () => true, fetch: api.fetch, httpUrl: 'https://convex.test', token: 'jwt' };
  const who = { subOrgId: SUB_ORG, did: author.did, keys: author.keys };
  return { turnkey, author, api, deps, who };
}

const lastEntry = jsonl => authorDid.parseDidLog(jsonl).at(-1);
const posts = api => api.state.calls.filter(c => c[0] === 'POST');

test('adding an agent key: one entry, signed by #key-0 only, that the server stores as an author DID', async () => {
  const { turnkey, author, api, deps, who } = await setup();
  const agent = await agentKey();
  const steps = [];
  turnkey.calls.length = 0;
  const result = await agentKeys.addAgentKey(who, { fragment: A, publicKeyMultibase: agent.multikey }, deps, step => steps.push(step));
  assert.equal(result.changed, true);
  assert.deepEqual(steps, ['signing', 'saving']);
  assert.equal(api.state.log, result.log);
  assert.ok(result.log.startsWith(`${author.jsonl}\n`), 'the served bytes are kept, byte for byte');
  assert.equal(result.log.split('\n').length, 2);

  const entry = lastEntry(result.log);
  assert.equal(entry.versionId, result.versionId);
  assert.match(entry.versionId, /^2-/);
  assert.deepEqual(entry.state.authentication, ['#key-0', `#${A}`]);
  assert.deepEqual(entry.state.assertionMethod, ['#orig-1']);
  assert.deepEqual(shared.agentMethods(entry.state), [{ fragment: A, id: `${author.did}#${A}`, publicKeyMultibase: agent.multikey }]);
  // No new parameters: the update keys stay the author key; no witness, watchers or pre-rotation.
  assert.deepEqual(entry.parameters.updateKeys, [author.keys.author.multikey]);
  // didwebvh-ts writes `witness: {}` and `watchers: []` for none.
  for (const name of Object.keys(entry.parameters)) assert.ok(['updateKeys', 'witness', 'watchers', 'nextKeyHashes'].includes(name), name);
  assert.deepEqual(entry.parameters.witness ?? {}, {});
  assert.deepEqual(entry.parameters.nextKeyHashes ?? [], []);
  assert.ok(!entry.parameters.watchers?.length);

  // Signed by the author key alone, through Turnkey; the assertion key signs nothing.
  assert.equal(entry.proof.length, 1);
  assert.equal(entry.proof[0].verificationMethod, `did:key:${author.keys.author.multikey}`);
  assert.deepEqual(turnkey.calls.filter(c => c.op === 'sign').map(c => c.address), [author.keys.author.address]);
  assert.deepEqual((await authorDid.inspectAuthorDid(result.log, author.keys)).problems, []);
});

test('removing an agent key leaves #key-0 alone in authentication', async () => {
  const { author, api, deps, who } = await setup();
  const agent = await agentKey();
  await agentKeys.addAgentKey(who, { fragment: A, publicKeyMultibase: agent.multikey }, deps);
  const removed = await agentKeys.removeAgentKey(who, A, deps);
  assert.equal(removed.changed, true);
  const entry = lastEntry(api.state.log);
  assert.match(entry.versionId, /^3-/);
  assert.deepEqual(entry.state.authentication, ['#key-0']);
  assert.deepEqual(entry.state.verificationMethod.map(vm => vm.id), ['#key-0', '#orig-1']);
  assert.deepEqual(entry.state, authorDid.parseDidLog(author.jsonl)[0].state, 'the state is the genesis state again');
});

test('two agents, then one removed', async () => {
  const { api, deps, who } = await setup();
  const [a, b] = [await agentKey(), await agentKey()];
  await agentKeys.addAgentKey(who, { fragment: A, publicKeyMultibase: a.multikey }, deps);
  await agentKeys.addAgentKey(who, { fragment: B, publicKeyMultibase: b.multikey }, deps);
  assert.deepEqual(lastEntry(api.state.log).state.authentication, ['#key-0', `#${A}`, `#${B}`]);
  await agentKeys.removeAgentKey(who, A, deps);
  const state = lastEntry(api.state.log).state;
  assert.deepEqual(state.authentication, ['#key-0', `#${B}`]);
  assert.deepEqual(shared.agentMethods(state).map(m => [m.fragment, m.publicKeyMultibase]), [[B, b.multikey]]);
  // Reusing one agent's key for another method is refused before anything is signed.
  await assert.rejects(() => agentKeys.addAgentKey(who, { fragment: A, publicKeyMultibase: b.multikey }, deps), /already in this DID/);
});

test('a change already made publishes nothing and needs no Turnkey session', async () => {
  const { turnkey, api, deps, who } = await setup();
  const agent = await agentKey();
  const first = await agentKeys.addAgentKey(who, { fragment: A, publicKeyMultibase: agent.multikey }, deps);
  turnkey.calls.length = 0;
  api.state.calls.length = 0;
  const notReady = { ...deps, ready: async () => false };
  const again = await agentKeys.addAgentKey(who, { fragment: A, publicKeyMultibase: agent.multikey }, notReady);
  assert.deepEqual(again, { did: who.did, log: first.log, versionId: first.versionId, changed: false });
  assert.deepEqual(posts(api), []);
  assert.deepEqual(turnkey.calls.filter(c => c.op === 'sign'), []);
  const gone = await agentKeys.removeAgentKey(who, B, notReady);
  assert.equal(gone.changed, false);
});

test('without a live Turnkey session nothing is signed or posted', async () => {
  const { turnkey, api, deps, who } = await setup();
  turnkey.calls.length = 0;
  const agent = await agentKey();
  await assert.rejects(
    () => agentKeys.addAgentKey(who, { fragment: A, publicKeyMultibase: agent.multikey }, { ...deps, ready: async () => false }),
    err => err.code === 'not-ready',
  );
  assert.deepEqual(posts(api), []);
  assert.deepEqual(turnkey.calls.filter(c => c.op === 'sign'), []);
});

test('a 409 is retried once from the new served log; a second one is reported', async () => {
  const { turnkey, author, api, deps, who } = await setup();
  const [a, b] = [await agentKey(), await agentKey()];
  // Another device adds B between our read and our write.
  api.state.conflicts.push(async log => (await changeAgentMethod(turnkey, { jsonl: log, keys: author.keys }, { add: { fragment: B, publicKeyMultibase: b.multikey } })).jsonl);
  const result = await agentKeys.addAgentKey(who, { fragment: A, publicKeyMultibase: a.multikey }, deps);
  assert.equal(posts(api).length, 2);
  assert.match(result.versionId, /^3-/);
  assert.deepEqual(lastEntry(api.state.log).state.authentication, ['#key-0', `#${B}`, `#${A}`], "the other device's agent is kept");

  const c = await agentKey();
  const twice = log => changeAgentMethod(turnkey, { jsonl: log, keys: author.keys }, { remove: B }).then(r => r.jsonl);
  api.state.conflicts.push(twice, async log => log);
  await assert.rejects(() => agentKeys.addAgentKey(who, { fragment: 'agent-cccccccccc', publicKeyMultibase: c.multikey }, deps), err => err.code === 'rejected' && /409/.test(err.message));
});

test('a served log that is not this account\'s author DID is not continued', async () => {
  const { author, deps, who } = await setup();
  const stranger = await mintAuthor(await mockTurnkey([shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]), { path: PATH });
  const agent = await agentKey();
  const fetchStranger = async (url, options) => (options?.method ? assert.fail('nothing is posted') : new Response(stranger.jsonl));
  await assert.rejects(() => agentKeys.addAgentKey(who, { fragment: A, publicKeyMultibase: agent.multikey }, { ...deps, fetch: fetchStranger }), err => err.code === 'not-author');
  assert.ok(author.jsonl);
});

test('revoked agents whose key is still in the DID are found', async () => {
  const { api, deps, who } = await setup();
  const [a, b] = [await agentKey(), await agentKey()];
  await agentKeys.addAgentKey(who, { fragment: A, publicKeyMultibase: a.multikey }, deps);
  await agentKeys.addAgentKey(who, { fragment: B, publicKeyMultibase: b.multikey }, deps);
  const doc = agentKeys.servedDocument(api.state.log);
  assert.equal(doc.id, who.did);
  assert.deepEqual(agentKeys.strayAgentMethods(doc, [{ fragment: A }], []), [{ fragment: B, publicKeyMultibase: b.multikey }]);
  assert.deepEqual(agentKeys.strayAgentMethods(doc, [{ fragment: A }], [{ fragment: B }]), [], 'a pending request whose approval did not finish is not stray');
  assert.deepEqual(agentKeys.strayAgentMethods(null, [], []), []);
});

// Originals signs with #orig-1 at the author's current version, and gives the
// log as evidence: after an agent change both must be the new ones.
test('after an agent change, Originals signs at the new version, and the list verifies', async () => {
  const { turnkey, author, api, deps } = await setup();
  t.backend = turnkey;
  const ensureDeps = { backend: turnkey, ready: async () => true, fetch: api.fetch, httpUrl: 'https://convex.test', domain: 'boop.ad' };
  assert.deepEqual(await identity.ensureAuthorDid({ did: author.did, turnkeySubOrgId: SUB_ORG }, 'jwt', ensureDeps), { status: 'current', did: author.did });
  originals.setListAuthorSource(identity.turnkeyListAuthorSource);

  const hosted = { ownerDid: author.did, authorLog: author.jsonl, judgeSubmission };
  const host = makeHost(hosted);
  const did = await originals.mintList(host.client, {
    listId: host.listId, ownerDid: author.did, name: 'Groceries',
    content: { kind: 'list', snapshot: originals.buildListSnapshot('Groceries', [{ name: 'Milk', checked: false }]) },
  });

  const agent = await agentKey();
  const result = await identity.changeAuthorAgentKey({ add: { fragment: A, publicKeyMultibase: agent.multikey } }, 'jwt', undefined, deps);
  assert.equal(result.changed, true);
  const listAuthor = await identity.turnkeyListAuthorSource();
  assert.equal(listAuthor.author.versionId, result.versionId, 'the cached author moved to the new version');
  assert.equal(listAuthor.evidence.log, api.state.log);
  assert.equal(identity.currentAuthor().log, api.state.log);

  // The host now holds the new log, as /api/did/log stored it.
  hosted.authorLog = api.state.log;
  const recorded = await originals.recordPublishedVersion(host.client, { listId: host.listId, ownerDid: author.did, did },
    originals.buildListSnapshot('Groceries', [{ name: 'Milk', checked: true }]));
  assert.equal(recorded.appended, true);
  originals.setListAuthorSource(async () => null);
  const verified = await originals.verifyList(host.client, host.listId);
  assert.equal(verified.verified, true, verified.error ?? verified.reasons?.join(', '));

  // Without a confirmed author the change asks for a new sign-in.
  identity.clearCurrentAuthor();
  await assert.rejects(() => identity.changeAuthorAgentKey({ remove: A }, 'jwt', undefined, deps), err => err.code === 'not-ready');
});
