// LWS agent auth, phase 1 (docs/lws-agent-auth.md): the author DID rule with
// agent methods, the JWT verifier, access requests, owner decisions, token
// exchange and the agent credential. Real did:webvh logs and Ed25519 keys;
// TURNKEY IS MOCKED (scripts/helpers/author-did-fixture.ts) and Convex is an
// in-memory database running the real handlers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { SignJWT } from 'jose';
import { getFunctionName } from 'convex/server';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

ed.hashes.sha512 ??= sha512;
process.env.LWS_BASE_URL = 'https://lws.test/';
process.env.JWT_SECRET = 'lws-test-secret-not-a-deployed-credential';
const B = 'https://lws.test';

const outdir = 'tmp/lws-agent-auth-test';
await mkdir(outdir, { recursive: true });
const entries = {
  fixture: 'scripts/helpers/author-did-fixture.ts',
  lwsJwt: 'convex/lib/lwsJwt.ts', lwsAccessLib: 'convex/lib/lwsAccess.ts', lwsUrls: 'convex/lib/lwsUrls.ts', lwsTokens: 'convex/lib/lwsTokens.ts',
  actor: 'convex/lib/actor.ts', jwt: 'convex/lib/jwt.ts', authorDidShared: 'shared/authorDid.ts',
  lwsAccess: 'convex/lwsAccess.ts', lwsHttp: 'convex/lwsHttp.ts', rateLimits: 'convex/rateLimits.ts', actorSession: 'convex/actorSession.ts',
  permissions: 'convex/lib/permissions.ts', lists: 'convex/lists.ts', agentReadHttp: 'convex/agentReadHttp.ts',
  devLws: 'convex/devLws.ts',
};
await build({
  entryPoints: Object.fromEntries(Object.entries(entries)), outdir, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  outExtension: { '.js': '.mjs' }, packages: 'external', logLevel: 'error',
});
const load = name => import(`${pathToFileURL(`${process.cwd()}/${outdir}/${name}.mjs`).href}`);
const [fixture, lwsJwt, lib, urls, tokens, actor, jwtLib, shared, lwsAccess, lwsHttp, rateLimits, actorSession, permissions, lists, agentReadHttp, devLws] = await Promise.all(Object.keys(entries).map(load));
const { mockTurnkey, mintAuthor, agentKey, changeAgentMethod, pinned, authorDidLog } = fixture;

const b64u = value => Buffer.from(typeof value === 'string' ? value : value).toString('base64url');
function signJwt(claims, secret, header = { alg: 'EdDSA' }) {
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  return `${input}.${b64u(ed.sign(new TextEncoder().encode(input), secret))}`;
}
const nowS = () => Math.floor(Date.now() / 1000);
let jtis = 0;
const claimsFor = (subject, aud, extra = {}) => ({ sub: subject, iss: subject, client_id: subject, aud, iat: nowS(), exp: nowS() + 300, jti: `jti-${++jtis}`, ...extra });
const hash = value => createHash('sha256').update(value).digest('hex');

// ---------------------------------------------------------------------------
// The author DID rule
// ---------------------------------------------------------------------------

async function ownerWithAgent() {
  const turnkey = await mockTurnkey([shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]);
  const author = await mintAuthor(turnkey, { path: 'user-sub-org' });
  const agent = await agentKey();
  const updated = await changeAgentMethod(turnkey, author, { add: { fragment: 'agent-abcdefghij', publicKeyMultibase: agent.multikey } });
  return { turnkey, author, agent, updated };
}

test('an author DID may list agent methods in authentication', async () => {
  const { author, agent, updated } = await ownerWithAgent();
  const checked = await authorDidLog.checkDidLogWrite(author.jsonl, updated.jsonl, pinned(author.keys));
  assert.deepEqual(checked.authorProblems, [], 'the stored author flag stays true');
  assert.deepEqual(shared.agentMethods(updated.doc), [{ fragment: 'agent-abcdefghij', id: `${updated.did}#agent-abcdefghij`, publicKeyMultibase: agent.multikey }]);
  assert.deepEqual(updated.doc.authentication, ['#key-0', '#agent-abcdefghij']);
  assert.deepEqual(updated.doc.assertionMethod, ['#orig-1']);
  assert.ok(shared.isAgentFragment('agent-abcdefghij') && shared.AGENT_VM_PATTERN.test('agent-a2b3c4d5e6'));
  for (const bad of ['key-0', 'orig-1', 'agent-ABCDEFGHIJ', 'agent-abcdefghi', 'agent-abcdefghijk', 'agent-abcdefgh01', 'xagent-abcdefghij']) assert.equal(shared.isAgentFragment(bad), false, bad);

  // Removing it again is an author DID too.
  const removed = shared.nextAgentDocument(updated.doc, [author.keys.author.multikey], { remove: 'agent-abcdefghij' });
  assert.deepEqual(removed.authentication, ['#key-0']);
  assert.equal(removed.verificationMethod.length, 2);
});

test('agent methods of any other shape are refused', async () => {
  const { author, updated } = await ownerWithAgent();
  const doc = updated.doc;
  const updateKeys = [author.keys.author.multikey];
  const [key0, orig1, agentVm] = doc.verificationMethod;
  const problems = changes => shared.authorDidProblems({ ...doc, ...changes }, updateKeys, pinned(author.keys).keys);
  assert.deepEqual(problems({}), []);
  const cases = {
    'not in authentication': { authentication: ['#key-0'] },
    'listed twice': { authentication: ['#key-0', '#agent-abcdefghij', '#agent-abcdefghij'] },
    'before #key-0': { authentication: ['#agent-abcdefghij', '#key-0'] },
    'in assertionMethod': { assertionMethod: ['#orig-1', '#agent-abcdefghij'] },
    'in capabilityInvocation': { capabilityInvocation: ['#agent-abcdefghij'] },
    'in keyAgreement': { keyAgreement: ['#agent-abcdefghij'] },
    'embedded in authentication': { authentication: ['#key-0', { ...agentVm }] },
    'a bad fragment': { verificationMethod: [key0, orig1, { ...agentVm, id: '#agent-ABCDEFGHIJ' }], authentication: ['#key-0', '#agent-ABCDEFGHIJ'] },
    'not a Multikey': { verificationMethod: [key0, orig1, { ...agentVm, type: 'Ed25519VerificationKey2020' }] },
    'not Ed25519': { verificationMethod: [key0, orig1, { ...agentVm, publicKeyMultibase: 'zQ3shokFTS3brHcDQrn82RUDfCZESWL1ZdCEJwekUDPQiYBme' }] },
    'another controller': { verificationMethod: [key0, orig1, { ...agentVm, controller: 'did:example:evil' }] },
    'an extra member': { verificationMethod: [key0, orig1, { ...agentVm, publicKeyJwk: { kty: 'OKP' } }] },
    'the author key': { verificationMethod: [key0, orig1, { ...agentVm, publicKeyMultibase: author.keys.author.multikey }] },
    'the assertion key': { verificationMethod: [key0, orig1, { ...agentVm, publicKeyMultibase: author.keys.assertion.multikey }] },
    "another agent's key": {
      verificationMethod: [key0, orig1, agentVm, { ...agentVm, id: '#agent-bbbbbbbbbb' }],
      authentication: ['#key-0', '#agent-abcdefghij', '#agent-bbbbbbbbbb'],
    },
    'a dangling reference': { authentication: ['#key-0', '#agent-abcdefghij', '#agent-cccccccccc'] },
  };
  for (const [what, changes] of Object.entries(cases)) assert.ok(problems(changes).length > 0, what);
  // Two distinct agents are fine; 26 are too many.
  const many = n => Array.from({ length: n }, (_, i) => `agent-${String.fromCharCode(97 + (i % 26))}${'a'.repeat(9)}`);
  const keys = await Promise.all(Array.from({ length: 26 }, async () => (await agentKey()).multikey));
  const withAgents = n => ({
    verificationMethod: [key0, orig1, ...many(n).map((f, i) => ({ id: `#${f}`, type: 'Multikey', controller: doc.id, publicKeyMultibase: keys[i] }))],
    authentication: ['#key-0', ...many(n).map(f => `#${f}`)],
  });
  assert.deepEqual(problems(withAgents(2)), []);
  assert.deepEqual(problems(withAgents(25)), []);
  assert.match(problems(withAgents(26)).join(), /at most 25/);
});

test('nextAgentDocument refuses changes that would not leave an author DID', async () => {
  const { author, agent, updated } = await ownerWithAgent();
  const keys = [author.keys.author.multikey];
  const add = (fragment, publicKeyMultibase) => () => shared.nextAgentDocument(updated.doc, keys, { add: { fragment, publicKeyMultibase } });
  assert.throws(add('agent-abcdefghij', (await agentKey()).multikey), /already a verification method/);
  assert.throws(add('agent-bbbbbbbbbb', agent.multikey), /already in this DID/);
  assert.throws(add('agent-bbbbbbbbbb', author.keys.author.multikey), /already in this DID/);
  assert.throws(add('key-1', (await agentKey()).multikey), /not an agent method fragment/);
  assert.throws(add('agent-bbbbbbbbbb', 'z6MkNotAKey'), /not an Ed25519 Multikey/);
  assert.throws(() => shared.nextAgentDocument(updated.doc, keys, { remove: 'agent-cccccccccc' }), /not in this DID/);
  assert.throws(() => shared.nextAgentDocument(updated.doc, keys, { remove: 'key-0' }), /not an agent method fragment/);
  // The input is never changed.
  const before = JSON.stringify(updated.doc);
  shared.nextAgentDocument(updated.doc, keys, { add: { fragment: 'agent-bbbbbbbbbb', publicKeyMultibase: (await agentKey()).multikey } });
  assert.equal(JSON.stringify(updated.doc), before);
});

// ---------------------------------------------------------------------------
// The JWT verifier
// ---------------------------------------------------------------------------

test('did:key credentials: each claim rule', async () => {
  const agent = await agentKey();
  const did = `did:key:${agent.multikey}`;
  const aud = `${B}/lws-access/requests`;
  const verify = (token, now = Date.now()) => lwsJwt.verifyDidKeyJwt(token, { audience: aud, now });
  const ok = verify(signJwt(claimsFor(did, [aud, 'https://other.test']), agent.secret));
  assert.equal(ok.didKey, did);
  assert.equal(ok.publicKeyMultibase, agent.multikey);
  assert.equal(verify(signJwt(claimsFor(did, aud), agent.secret, { alg: 'EdDSA', kid: `${did}#${agent.multikey}`, typ: 'JWT' })).subject, did);

  const rejects = (token, pattern, what) => assert.throws(() => verify(token), pattern, what);
  rejects(signJwt(claimsFor(did, aud), agent.secret, { alg: 'none' }), /not EdDSA/, 'alg none');
  rejects(`${b64u(JSON.stringify({ alg: 'none' }))}.${b64u(JSON.stringify(claimsFor(did, aud)))}.`, /signature/, 'unsigned');
  rejects(signJwt(claimsFor(did, aud), agent.secret, { alg: 'ES256' }), /not EdDSA/, 'alg ES256');
  rejects(signJwt(claimsFor(did, aud), agent.secret, { alg: 'Ed25519' }), /not EdDSA/, 'alg Ed25519');
  rejects(signJwt(claimsFor(did, aud), agent.secret, { alg: 'EdDSA', jwk: { kty: 'OKP' } }), /carries jwk/, 'embedded jwk');
  rejects(signJwt(claimsFor(did, aud), agent.secret, { alg: 'EdDSA', crit: ['exp'] }), /Critical/, 'crit');
  rejects(signJwt(claimsFor(did, aud), agent.secret, { alg: 'EdDSA', kid: `${did}#other` }), /kid/, 'wrong kid');
  rejects(signJwt(claimsFor(did, aud, { iss: 'did:key:other' }), agent.secret), /differ/, 'iss differs');
  rejects(signJwt(claimsFor(did, aud, { client_id: 'https://app.test' }), agent.secret), /differ/, 'client_id differs');
  rejects(signJwt(claimsFor(did, 'https://elsewhere.test'), agent.secret), /aud/, 'wrong aud');
  rejects(signJwt(claimsFor(did, []), agent.secret), /aud/, 'empty aud');
  rejects(signJwt(claimsFor(did, aud, { exp: undefined }), agent.secret), /exp and iat/, 'no exp');
  rejects(signJwt(claimsFor(did, aud, { iat: undefined }), agent.secret), /exp and iat/, 'no iat');
  rejects(signJwt(claimsFor(did, aud, { iat: nowS() - 400, exp: nowS() - 61 }), agent.secret), /expired/, 'expired');
  rejects(signJwt(claimsFor(did, aud, { iat: nowS() + 120, exp: nowS() + 300 }), agent.secret), /future/, 'iat ahead');
  rejects(signJwt(claimsFor(did, aud, { iat: nowS(), exp: nowS() + 601 }), agent.secret), /more than 600/, 'too long-lived');
  rejects(signJwt(claimsFor(did, aud, { exp: nowS() - 10, iat: nowS() }), agent.secret), /not after iat/, 'exp before iat');
  rejects(signJwt(claimsFor(did, aud, { nbf: nowS() + 300 }), agent.secret), /not valid yet/, 'nbf ahead');
  rejects(signJwt(claimsFor(did, aud, { jti: undefined }), agent.secret), /jti/, 'no jti');
  rejects(signJwt(claimsFor(did, aud, { jti: '' }), agent.secret), /jti/, 'empty jti');
  rejects(signJwt(claimsFor(did, aud), (await agentKey()).secret), /does not verify/, 'another key');
  rejects(signJwt(claimsFor('did:key:z6MkNotAKey', aud), agent.secret), /Ed25519 did:key/, 'bad did:key');
  // Within the allowed skew.
  assert.ok(verify(signJwt(claimsFor(did, aud, { iat: nowS() + 50, exp: nowS() + 100 }), agent.secret)));
  assert.ok(verify(signJwt(claimsFor(did, aud, { iat: nowS() - 300, exp: nowS() - 30 }), agent.secret)));

  // One signature, one spelling: a re-encoded segment is refused.
  const token = signJwt(claimsFor(did, aud), agent.secret);
  const [h, p, s] = token.split('.');
  rejects(`${h}=.${p}.${s}`, /base64url/, 'padding');
  const last = s.at(-1), alt = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('').find(c => c !== last && Buffer.from(`${s.slice(0, -1)}${c}`, 'base64url').equals(Buffer.from(s, 'base64url')));
  if (alt) rejects(`${h}.${p}.${s.slice(0, -1)}${alt}`, /signature/, 'non-canonical signature');
  rejects(`${h}.${p}`, /compact/, 'two parts');
  // Replay bookkeeping is per issuer.
  const a = lwsJwt.checkLwsClaims(claimsFor(did, aud, { jti: 'same' }), { audience: aud, now: Date.now() });
  const b = lwsJwt.checkLwsClaims(claimsFor('did:key:z6Mkother', aud, { jti: 'same' }), { audience: aud, now: Date.now() });
  assert.notEqual(a.replayKey, b.replayKey);
  assert.ok(a.replayUntil > Date.now());
});

test('agent credentials as the user: kid must be an agent method in authentication', async () => {
  const { turnkey, agent, updated } = await ownerWithAgent();
  const did = updated.did;
  const document = updated.doc;
  const kid = `${did}#agent-abcdefghij`;
  const verify = (token, doc = document) => lwsJwt.verifyAgentJwt(token, { audience: B, now: Date.now(), document: doc });
  const ok = verify(signJwt(claimsFor(did, B), agent.secret, { alg: 'EdDSA', kid }));
  assert.equal(ok.kid, kid);
  assert.equal(ok.fragment, 'agent-abcdefghij');
  assert.equal(ok.publicKeyMultibase, agent.multikey);

  const rejects = (token, pattern, what, doc) => assert.throws(() => verify(token, doc), pattern, what);
  rejects(signJwt(claimsFor(did, B), agent.secret, { alg: 'EdDSA' }), /kid is required/, 'no kid');
  rejects(signJwt(claimsFor(did, B), agent.secret, { alg: 'EdDSA', kid: '#agent-abcdefghij' }), /not a method of the subject/, 'relative kid');
  rejects(signJwt(claimsFor(did, B), agent.secret, { alg: 'EdDSA', kid: `${did}#agent-zzzzzzzzzz` }), /not a verification method/, 'unknown kid');
  // The author key signs DID updates, never LWS credentials.
  rejects(signJwt(claimsFor(did, B), turnkey.secretFor(shared.AUTHOR_KEY_PATH), { alg: 'EdDSA', kid: `${did}#key-0` }), /not an agent method/, '#key-0');
  rejects(signJwt(claimsFor(did, B), agent.secret, { alg: 'EdDSA', kid: `${did}#orig-1` }), /not an agent method/, '#orig-1');
  rejects(signJwt(claimsFor(did, B), (await agentKey()).secret, { alg: 'EdDSA', kid }), /does not verify/, 'another key');
  rejects(signJwt(claimsFor(did, `${B}/elsewhere`), agent.secret, { alg: 'EdDSA', kid }), /aud/, 'wrong aud');
  rejects(signJwt(claimsFor('did:webvh:other:boop.ad:user-x', B), agent.secret, { alg: 'EdDSA', kid }), /DID document's/, 'another subject');
  rejects(signJwt(claimsFor(did, B, { iat: nowS() - 700, exp: nowS() - 100 }), agent.secret, { alg: 'EdDSA', kid }), /expired/, 'expired');
  rejects(signJwt(claimsFor(did, B), agent.secret, { alg: 'none', kid }), /not EdDSA/, 'alg none');
  // A method that is in the document but not in authentication.
  const notAuthenticating = { ...document, authentication: ['#key-0'] };
  rejects(signJwt(claimsFor(did, B), agent.secret, { alg: 'EdDSA', kid }), /not in authentication/, 'not in authentication', notAuthenticating);
  const embedded = { ...document, authentication: ['#key-0', { ...document.verificationMethod[2] }] };
  rejects(signJwt(claimsFor(did, B), agent.secret, { alg: 'EdDSA', kid }), /not in authentication/, 'embedded', embedded);
  const duplicated = { ...document, verificationMethod: [...document.verificationMethod, document.verificationMethod[2]] };
  rejects(signJwt(claimsFor(did, B), agent.secret, { alg: 'EdDSA', kid }), /not a verification method/, 'duplicate id', duplicated);
  const foreign = { ...document, verificationMethod: document.verificationMethod.map(vm => vm.id === '#agent-abcdefghij' ? { ...vm, controller: 'did:example:x' } : vm) };
  rejects(signJwt(claimsFor(did, B), agent.secret, { alg: 'EdDSA', kid }), /Multikey the DID controls/, 'foreign controller', foreign);
  assert.equal(lwsJwt.latestDidState(updated.jsonl).id, did);
  assert.equal(lwsJwt.latestDidState('not json'), null);
});

// ---------------------------------------------------------------------------
// Access requests, scopes and URLs
// ---------------------------------------------------------------------------

const U = 'user-sub-org';
function accessRequestBody(assignee, overrides = {}, access = {}) {
  return {
    '@context': ['https://www.w3.org/ns/lws/v1'],
    type: ['AccessRequest'],
    storage: `${B}/lws/${U}`,
    name: 'Shopping bot',
    ...overrides,
    access: [{ type: ['AccessPolicy'], action: ['read', 'create'], assignee, target: { type: 'StorageResource', value: [`${B}/lws/${U}/`] }, ...access }],
  };
}

test('access request shape', async () => {
  const assignee = `did:key:${(await agentKey()).multikey}`;
  const parse = (body) => lib.parseAccessRequest(body, B);
  const ok = parse(accessRequestBody(assignee));
  assert.ok(ok.ok, ok.detail);
  assert.deepEqual(ok.value, { storage: `${B}/lws/${U}`, userPath: U, assignee, publicKeyMultibase: assignee.slice(8), actions: ['read', 'create'], name: 'Shopping bot' });
  assert.ok(parse({ ...accessRequestBody(assignee), '@context': 'https://www.w3.org/ns/lws/v1', type: 'AccessRequest', name: undefined }).ok, 'single values and no name');
  assert.equal(parse({ ...accessRequestBody(assignee), name: undefined }).value.name, 'Agent');
  assert.ok(parse(accessRequestBody(assignee, {}, { target: undefined })).ok, 'target is optional');
  assert.ok(parse(accessRequestBody(assignee, {}, { action: ['modify', 'delete'] })).ok, "the spec's modify");
  const bad = {
    'no context': accessRequestBody(assignee, { '@context': ['https://www.w3.org/ns/cid/v1'] }),
    'not an AccessRequest': accessRequestBody(assignee, { type: ['AccessGrant'] }),
    'another server': accessRequestBody(assignee, { storage: `https://evil.test/lws/${U}` }),
    'the root, not the storage': accessRequestBody(assignee, { storage: `${B}/lws/${U}/` }),
    'not a user path': accessRequestBody(assignee, { storage: `${B}/lws/../admin` }),
    'a long name': accessRequestBody(assignee, { name: 'x'.repeat(61) }),
    'a control character': accessRequestBody(assignee, { name: 'bot‮' }),
    'an empty name': accessRequestBody(assignee, { name: '  ' }),
    'a bad inbox': accessRequestBody(assignee, { inbox: 'javascript:alert(1)' }),
    'no actions': accessRequestBody(assignee, {}, { action: [] }),
    'an unknown action': accessRequestBody(assignee, {}, { action: ['read', 'control'] }),
    'a repeated action': accessRequestBody(assignee, {}, { action: ['read', 'read'] }),
    'a https assignee': accessRequestBody('https://agent.test/id'),
    'a P-256 did:key': accessRequestBody('did:key:zDnaerx9CtbPJ1q36T5Ln5wYt3MQYeGRG5ehnPAmxcf5mDZpv'),
    'a subcontainer target': accessRequestBody(assignee, {}, { target: { type: 'StorageResource', value: [`${B}/lws/${U}/list/`] } }),
    'two targets': accessRequestBody(assignee, {}, { target: { type: 'StorageResource', value: [`${B}/lws/${U}/`, `${B}/lws/${U}/x/`] } }),
    'a DataResource target': accessRequestBody(assignee, {}, { target: { type: 'DataResource', value: [`${B}/lws/${U}/`] } }),
    'constraints': accessRequestBody(assignee, {}, { constraint: [{ leftOperand: 'purpose', operator: 'eq', rightOperand: 'x' }] }),
    'no AccessPolicy type': accessRequestBody(assignee, {}, { type: ['Policy'] }),
  };
  for (const [what, body] of Object.entries(bad)) assert.equal(parse(body).ok, false, what);
  assert.equal(parse({ ...accessRequestBody(assignee), access: [] }).ok, false, 'no policy');
  assert.equal(parse({ ...accessRequestBody(assignee), access: [accessRequestBody(assignee).access[0], accessRequestBody(assignee).access[0]] }).ok, false, 'two policies');
  assert.equal(parse('[]').ok, false);
});

test('actions map to scopes, and approval can only narrow them', () => {
  assert.deepEqual(lib.scopesForActions(['read']), ['lists:read', 'items:read']);
  assert.deepEqual(lib.scopesForActions(['create']), ['items:write']);
  assert.deepEqual(lib.scopesForActions(['update', 'delete']), ['items:write']);
  assert.deepEqual(lib.scopesForActions(['modify']), ['items:write']);
  assert.deepEqual(lib.scopesForActions(['delete', 'read']), ['lists:read', 'items:read', 'items:write']);
  assert.throws(() => lib.scopesForActions(['*']));
  assert.ok(!lib.scopesForActions(['read', 'create', 'update', 'delete']).includes('*'));
  assert.deepEqual(lib.narrowActions(['read', 'create'], undefined), ['read', 'create']);
  assert.deepEqual(lib.narrowActions(['read', 'create'], ['read']), ['read']);
  assert.equal(lib.narrowActions(['read'], ['read', 'delete']), null);
  assert.equal(lib.narrowActions(['read'], []), null);
  assert.equal(lib.narrowActions(['read'], ['bogus']), null);
});

test('LWS URLs', () => {
  assert.equal(urls.lwsBaseUrl(), B, 'no trailing slash');
  assert.equal(urls.storageUri(U), `${B}/lws/${U}`);
  assert.equal(urls.storageRootUri(U), `${B}/lws/${U}/`);
  assert.throws(() => urls.storageUri('../x'));
  assert.deepEqual(urls.parseStoragePath(`${B}/lws/${U}`), { userPath: U, subpath: '' });
  assert.deepEqual(urls.parseStoragePath(`${B}/lws/${U}/`), { userPath: U, subpath: '/' });
  assert.deepEqual(urls.parseStoragePath(`${B}/lws/${U}/L1/I1`), { userPath: U, subpath: '/L1/I1' });
  for (const url of [`https://evil.test/lws/${U}`, `${B}/lws/`, `${B}/lws/${U}?x=1`, `${B}/lws/${U}#f`, `${B}/lws/${U}//x`, `${B}/lws/${U}/../x`, `${B}/lws/admin`, `${B}/lwsx/${U}`]) {
    assert.equal(urls.parseStoragePath(url), null, url);
  }
  const challenge = urls.lwsChallenge(`https://deployment.convex.site/lws/${U}/L1/I1?x=1`, { error: 'invalid_token' });
  assert.equal(challenge['WWW-Authenticate'], `Bearer resource_metadata="${B}/.well-known/oauth-protected-resource/lws/${U}/L1/I1", error="invalid_token"`);
  assert.equal(challenge.Link, `<${B}/lws/${U}>; rel="https://www.w3.org/ns/lws#storage"`);
  assert.throws(() => urls.lwsChallenge(`${B}/api/v1/lists`));
  const saved = process.env.LWS_BASE_URL;
  delete process.env.LWS_BASE_URL;
  try {
    process.env.CONVEX_SITE_URL = 'https://site.convex.test';
    assert.equal(urls.lwsBaseUrl(), 'https://site.convex.test');
    delete process.env.CONVEX_SITE_URL;
    assert.throws(() => urls.lwsBaseUrl(), /must be set/);
  } finally { process.env.LWS_BASE_URL = saved; }
});

test('identifiers and tokens', () => {
  for (let i = 0; i < 50; i++) {
    assert.ok(shared.isAgentFragment(tokens.generateAgentFragment()));
    assert.match(tokens.generateAccessRequestId(), tokens.ACCESS_REQUEST_ID_PATTERN);
    assert.match(tokens.generateLwsAccessToken(), /^lwsat_[A-Za-z0-9_-]{43}$/);
  }
  assert.equal(tokens.timingSafeEqual('abc', 'abc'), true);
  assert.equal(tokens.timingSafeEqual('abc', 'abd'), false);
  assert.equal(tokens.timingSafeEqual('abc', 'abcd'), false);
  // Never a session, and never any credential outside LWS storage: the JWT
  // extractor skips it (even with a session cookie beside it), and
  // requestCredentials yields nothing for it.
  const request = new Request(`${B}/api/v1/lists`, { headers: { Authorization: 'Bearer lwsat_abc', Cookie: 'auth_token=session.jwt.here' } });
  assert.equal(jwtLib.extractTokenFromRequest(request), null);
  assert.deepEqual(actor.requestCredentials(request), { authToken: undefined, apiKey: undefined });
  const session = new Request(`${B}/x`, { headers: { Authorization: 'Bearer a.b.c' } });
  assert.deepEqual(actor.requestCredentials(session), { authToken: 'a.b.c', apiKey: undefined });
});

// ---------------------------------------------------------------------------
// End to end on an in-memory Convex
// ---------------------------------------------------------------------------

const modules = { lwsAccess, rateLimits, actorSession, lists };
function convex(rows) {
  let next = 1;
  const all = () => Object.values(rows).flat();
  const effects = [];
  const db = {
    get: async id => all().find(row => row._id === id) ?? null,
    insert: async (table, value) => { const _id = `${table}:${next++}`; (rows[table] ??= []).push({ _id, _creationTime: Date.now(), ...value }); return _id; },
    patch: async (id, patch) => { const row = all().find(r => r._id === id); assert.ok(row, `missing ${id}`); Object.assign(row, patch); },
    delete: async id => { for (const table of Object.values(rows)) { const at = table.findIndex(row => row._id === id); if (at >= 0) table.splice(at, 1); } },
    query: table => {
      const predicates = [];
      const q = {
        withIndex: (_index, fn) => {
          const b = {
            eq: (k, v) => { predicates.push(r => r[k] === v); return b; },
            gte: (k, v) => { predicates.push(r => r[k] !== undefined && r[k] >= v); return b; },
            lte: (k, v) => { predicates.push(r => r[k] === undefined || r[k] <= v); return b; },
            lt: (k, v) => { predicates.push(r => r[k] === undefined || r[k] < v); return b; },
            gt: (k, v) => { predicates.push(r => r[k] !== undefined && r[k] > v); return b; },
          };
          fn?.(b); return q;
        },
        order: () => q,
        collect: async () => (rows[table] ?? []).filter(r => predicates.every(p => p(r))),
        take: async n => (await q.collect()).slice(0, n),
        first: async () => (await q.collect())[0] ?? null,
        unique: async () => (await q.collect())[0] ?? null,
      };
      return q;
    },
  };
  const ctx = { rows, effects, db, scheduler: { runAt: async (...a) => { effects.push(['runAt', getFunctionName(a[1])]); }, runAfter: async () => {} } };
  ctx.runQuery = ctx.runMutation = async (ref, args) => { const [m, f] = getFunctionName(ref).split(':'); return modules[m][f]._handler(ctx, args); };
  return ctx;
}
const call = (ctx, name, args) => lwsAccess[name]._handler(ctx, args);
const http = (ctx, handler, request) => lwsHttp[handler]._handler(ctx, request);

async function sessionToken(subject) {
  return new SignJWT({ email: `${subject}@example.test` }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject).setIssuer('originals-auth').setAudience('originals-api')
    .setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
}

async function world() {
  const turnkey = await mockTurnkey([shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]);
  const author = await mintAuthor(turnkey, { path: U });
  const ownerToken = await sessionToken('owner-sub-org');
  const ctx = convex({
    users: [{ _id: 'U1', did: author.did, turnkeySubOrgId: 'owner-sub-org', displayName: 'Owner', createdAt: 1 }],
    didLogs: [{ _id: 'D1', userDid: author.did, path: U, log: author.jsonl, author: true, updatedAt: 1 }],
    accessSessions: [{ _id: 'S1', tokenHash: hash(ownerToken), subject: 'owner-sub-org', expiresAt: Date.now() + 3600000 }],
    agentApiKeys: [{ _id: 'K1', ownerDid: author.did, keyHash: hash('pa_live_wildcard'), scopes: ['*'] }],
    lwsAccessRequests: [], lwsAgents: [], lwsAccessTokens: [], lwsJtis: [], rateLimits: [],
  });
  return { turnkey, author, ctx, ownerToken };
}

const postRequest = (body, jwt, headers = {}) => new Request(`https://deployment.convex.site/lws-access/requests`, {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/lws+json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), 'CF-Connecting-IP': '203.0.113.9', ...headers },
});
const tokenRequest = fields => new Request(`https://deployment.convex.site/oauth/token`, {
  method: 'POST', body: new URLSearchParams(fields).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '203.0.113.9' },
});
const exchangeFields = (subjectToken, extra = {}) => ({
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', subject_token: subjectToken,
  subject_token_type: 'urn:ietf:params:oauth:token-type:jwt', resource: `${B}/lws/${U}`, ...extra,
});

test('an agent asks, the owner approves, and the agent trades a JWT for an access token', async () => {
  const { turnkey, author, ctx, ownerToken } = await world();
  const agent = await agentKey();
  const didKey = `did:key:${agent.multikey}`;
  const requestJwt = () => signJwt(claimsFor(didKey, `${B}/lws-access/requests`), agent.secret);

  // Request: unauthenticated, wrong signer, then right.
  assert.equal((await http(ctx, 'postAccessRequest', postRequest(accessRequestBody(didKey)))).status, 401);
  const stranger = await agentKey();
  const wrongSigner = await http(ctx, 'postAccessRequest', postRequest(accessRequestBody(didKey), signJwt(claimsFor(`did:key:${stranger.multikey}`, `${B}/lws-access/requests`), stranger.secret)));
  assert.equal(wrongSigner.status, 403);
  assert.equal(wrongSigner.headers.get('Content-Type'), 'application/problem+json');
  assert.equal((await http(ctx, 'postAccessRequest', postRequest(JSON.parse(JSON.stringify(accessRequestBody(didKey)).replaceAll(U, 'user-nobody')), requestJwt()))).status, 404);
  const replayed = requestJwt();
  const created = await http(ctx, 'postAccessRequest', postRequest(accessRequestBody(didKey), replayed));
  assert.equal(created.status, 201);
  const location = created.headers.get('Location');
  assert.match(location, new RegExp(`^${B}/lws-access/requests/[A-Za-z0-9_-]{32}$`));
  const document = await created.json();
  assert.equal(document.id, location);
  assert.equal(document.status, 'pending');
  assert.deepEqual(document.access[0].action, ['read', 'create']);
  const [row] = ctx.rows.lwsAccessRequests;
  assert.ok(shared.isAgentFragment(row.fragment));
  assert.equal(row.userId, 'U1');
  assert.equal(row.agentDidKey, didKey);
  assert.equal(row.expiresAt - row.createdAt, 24 * 3600 * 1000);
  // A replayed JWT is refused; a fresh one for the same key gets the same request back.
  assert.equal((await http(ctx, 'postAccessRequest', postRequest(accessRequestBody(didKey), replayed))).status, 401);
  const again = await http(ctx, 'postAccessRequest', postRequest(accessRequestBody(didKey), requestJwt()));
  assert.equal(again.status, 200);
  assert.equal(again.headers.get('Location'), location);
  assert.equal(ctx.rows.lwsAccessRequests.length, 1);

  // Poll: only the assignee, and pending until approved.
  const requestId = location.split('/').pop();
  const poll = (secret = agent.secret, subject = didKey) => http(ctx, 'getAccessRequest', new Request(`https://deployment.convex.site/lws-access/requests/${requestId}`, {
    headers: { Authorization: `Bearer ${signJwt(claimsFor(subject, location), secret)}` },
  }));
  assert.equal((await (await poll()).json()).status, 'pending');
  assert.equal((await poll(stranger.secret, `did:key:${stranger.multikey}`)).status, 404, "another agent can't see it");

  // The owner's view, through a session only.
  const pending = await call(ctx, 'pendingAccessRequestsInternal', { authToken: ownerToken });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].requestId, requestId);
  assert.deepEqual(pending[0].scopes, ['lists:read', 'items:read', 'items:write']);
  await assert.rejects(() => call(ctx, 'pendingAccessRequestsInternal', { apiKey: 'pa_live_wildcard' }), /unavailable/i, 'an API key, even with *');

  // Approving before the DID lists the key is refused.
  await assert.rejects(() => call(ctx, 'approveAccessRequestInternal', { authToken: ownerToken, requestId }), /does not list/);
  // A DID update that lists another key at the fragment is refused too.
  const wrong = await changeAgentMethod(turnkey, author, { add: { fragment: row.fragment, publicKeyMultibase: stranger.multikey } });
  ctx.rows.didLogs[0].log = wrong.jsonl;
  await assert.rejects(() => call(ctx, 'approveAccessRequestInternal', { authToken: ownerToken, requestId }), /not the requested key/);
  const updated = await changeAgentMethod(turnkey, author, { add: { fragment: row.fragment, publicKeyMultibase: agent.multikey } });
  ctx.rows.didLogs[0].log = updated.jsonl;
  await assert.rejects(() => call(ctx, 'approveAccessRequestInternal', { authToken: ownerToken, requestId, actions: ['read', 'delete'] }), /only narrow/);
  const approved = await call(ctx, 'approveAccessRequestInternal', { authToken: ownerToken, requestId, actions: ['read'] });
  const kid = `${author.did}#${row.fragment}`;
  assert.equal(approved.vmId, kid);
  const [agentRow] = ctx.rows.lwsAgents;
  assert.deepEqual(agentRow.scopes, ['lists:read', 'items:read']);
  assert.equal(row.status, 'approved');
  await assert.rejects(() => call(ctx, 'approveAccessRequestInternal', { authToken: ownerToken, requestId }), /approved/);

  // The agent's poll now carries the grant and the kid to sign with.
  const granted = await (await poll()).json();
  assert.equal(granted.status, 'approved');
  assert.deepEqual(granted.grant.type, ['AccessGrant']);
  assert.deepEqual(granted.grant.access[0].action, ['read']);
  assert.equal(granted.verificationMethod, kid);

  // Token exchange.
  const subjectToken = (claims = {}, header = { alg: 'EdDSA', kid }, secret = agent.secret) => signJwt(claimsFor(author.did, B, claims), secret, header);
  const exchange = async (fields) => { const response = await http(ctx, 'tokenEndpoint', tokenRequest(fields)); return { status: response.status, body: await response.json(), headers: response.headers }; };
  const first = subjectToken();
  const issued = await exchange(exchangeFields(first));
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  assert.equal(issued.headers.get('Cache-Control'), 'no-store');
  assert.match(issued.body.access_token, /^lwsat_/);
  assert.equal(issued.body.issued_token_type, 'urn:ietf:params:oauth:token-type:access_token');
  assert.equal(issued.body.token_type, 'Bearer');
  assert.equal(issued.body.expires_in, 3600);
  assert.equal(issued.body.scope, 'lists:read items:read');
  const [tokenRow] = ctx.rows.lwsAccessTokens;
  assert.equal(tokenRow.tokenHash, hash(issued.body.access_token), 'stored hashed');
  assert.equal(tokenRow.storage, `${B}/lws/${U}`);
  assert.ok(ctx.effects.some(([kind, fn]) => kind === 'runAt' && fn === 'lwsAccess:deleteAccessToken'));
  assert.ok(agentRow.lastUsedAt >= tokenRow.expiresAt - 3600000);

  const refused = async (fields, error, what) => { const r = await exchange(fields); assert.equal(r.status, 400, what); assert.equal(r.body.error, error, `${what}: ${JSON.stringify(r.body)}`); };
  await refused(exchangeFields(first), 'invalid_request', 'replayed jti');
  await refused(exchangeFields(subjectToken({}, { alg: 'EdDSA', kid: `${author.did}#key-0` }, turnkey.secretFor(shared.AUTHOR_KEY_PATH))), 'invalid_request', '#key-0');
  await refused(exchangeFields(subjectToken({}, { alg: 'EdDSA', kid: `${author.did}#agent-zzzzzzzzzz` })), 'invalid_request', 'unknown kid');
  await refused(exchangeFields(subjectToken({ aud: `${B}/lws-access/requests` })), 'invalid_request', 'wrong aud');
  await refused(exchangeFields(subjectToken(), { resource: `${B}/lws/user-other` }), 'invalid_target', 'another storage');
  await refused(exchangeFields(subjectToken(), { resource: `${B}/lws/${U}/` }), 'invalid_target', 'the root, not the storage');
  await refused(exchangeFields(subjectToken(), { scope: 'items:write' }), 'invalid_scope', 'scope beyond the agent');
  await refused(exchangeFields(subjectToken(), { grant_type: 'client_credentials' }), 'unsupported_grant_type', 'grant type');
  await refused(exchangeFields(subjectToken(), { subject_token_type: 'urn:ietf:params:oauth:token-type:id_token' }), 'invalid_request', 'token type');
  await refused(exchangeFields(subjectToken(), { actor_token: 'x' }), 'invalid_request', 'actor token');
  const repeated = new URLSearchParams(exchangeFields(subjectToken())); repeated.append('resource', `${B}/lws/${U}`);
  assert.equal((await http(ctx, 'tokenEndpoint', new Request(`${B}/oauth/token`, { method: 'POST', body: repeated.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }))).status, 400, 'repeated parameter');
  assert.equal((await http(ctx, 'tokenEndpoint', new Request(`${B}/oauth/token`, { method: 'POST', body: JSON.stringify(exchangeFields(subjectToken())), headers: { 'Content-Type': 'application/json' } }))).status, 400, 'JSON body');
  // The DID must be an author DID: a log stored without the author flag gives nothing.
  ctx.rows.didLogs[0].author = false;
  await refused(exchangeFields(subjectToken()), 'invalid_request', 'not an author DID');
  ctx.rows.didLogs[0].author = true;
  // A narrowed scope works.
  assert.equal((await exchange(exchangeFields(subjectToken(), { scope: 'items:read' }))).body.scope, 'items:read');

  // The access token authenticates as the user, as this agent.
  const resolved = await actor.authenticate(ctx, { agentToken: issued.body.access_token });
  assert.equal(resolved.did, author.did);
  assert.equal(resolved.userId, 'U1');
  assert.equal(resolved.viaApiKey, true);
  assert.deepEqual(resolved.credential, { kind: 'agent', id: agentRow._id });
  assert.deepEqual(resolved.scopes, ['lists:read', 'items:read']);
  await assert.rejects(() => actor.authenticate(ctx, { agentToken: issued.body.access_token, apiKey: 'pa_live_wildcard' }), /Invalid access token/, 'never combined');
  await assert.rejects(() => actor.authenticate(ctx, { agentToken: issued.body.access_token, authToken: ownerToken }), /Invalid access token/, 'never combined');
  await assert.rejects(() => actor.authenticate(ctx, { agentToken: 'lwsat_forged' }), /Invalid access token/);
  await assert.rejects(() => actor.authenticate(ctx, { agentToken: issued.body.access_token.slice(6) }), /Invalid access token/, 'no prefix');
  // The operation wrappers never take it, owner operations included.
  await assert.rejects(() => call(ctx, 'activeAgentsInternal', { agentToken: issued.body.access_token }), /Authentication required/);
  // The account being deleted.
  ctx.rows.users[0].deletionRequestedAt = Date.now();
  await assert.rejects(() => actor.authenticate(ctx, { agentToken: issued.body.access_token }), /unavailable/);
  delete ctx.rows.users[0].deletionRequestedAt;
  // Expired.
  tokenRow.expiresAt = Date.now() - 1;
  await assert.rejects(() => actor.authenticate(ctx, { agentToken: issued.body.access_token }), /Invalid access token/, 'expired');
  tokenRow.expiresAt = Date.now() + 1000;

  // Revoke: the row, its tokens, and the token endpoint, while the DID still lists the key.
  const active = await call(ctx, 'activeAgentsInternal', { authToken: ownerToken });
  assert.deepEqual(active.map(a => a.vmId), [kid]);
  await call(ctx, 'revokeAgentInternal', { authToken: ownerToken, agentId: agentRow._id });
  assert.ok(agentRow.revokedAt);
  assert.equal(ctx.rows.lwsAccessTokens.length, 0, 'tokens deleted');
  await assert.rejects(() => actor.authenticate(ctx, { agentToken: issued.body.access_token }), /Invalid access token/);
  await refused(exchangeFields(subjectToken()), 'invalid_request', 'revoked agent');
  assert.equal((await (await poll()).json()).status, 'revoked');
  assert.deepEqual(await call(ctx, 'activeAgentsInternal', { authToken: ownerToken }), []);
});

test('requests: deny, expiry, the pending cap, rate limits and someone else\'s request', async () => {
  const { ctx, ownerToken } = await world();
  const make = async (ip = '198.51.100.1') => {
    const agent = await agentKey();
    const didKey = `did:key:${agent.multikey}`;
    const response = await http(ctx, 'postAccessRequest', postRequest(accessRequestBody(didKey), signJwt(claimsFor(didKey, `${B}/lws-access/requests`), agent.secret), { 'CF-Connecting-IP': ip }));
    return { response, requestId: response.headers.get('Location')?.split('/').pop() };
  };
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const { response, requestId } = await make(`198.51.100.${i}`);
    assert.equal(response.status, 201);
    ids.push(requestId);
  }
  assert.equal((await make('198.51.100.200')).response.status, 429, 'at most 10 pending per user');
  await call(ctx, 'denyAccessRequestInternal', { authToken: ownerToken, requestId: ids[0] });
  assert.equal(ctx.rows.lwsAccessRequests[0].status, 'denied');
  await assert.rejects(() => call(ctx, 'approveAccessRequestInternal', { authToken: ownerToken, requestId: ids[0] }), /denied/);
  // A pending request past its day is expired, lazily or by the cron.
  ctx.rows.lwsAccessRequests[1].expiresAt = Date.now() - 1;
  await assert.rejects(() => call(ctx, 'approveAccessRequestInternal', { authToken: ownerToken, requestId: ids[1] }), /expired/);
  ctx.rows.lwsAccessRequests[2].expiresAt = Date.now() - 1;
  ctx.rows.lwsJtis.push({ _id: 'J0', jtiHash: 'x', expiresAt: Date.now() - 1 });
  const cleaned = await call(ctx, 'cleanupInternal', {});
  assert.equal(cleaned.requests, 1);
  assert.equal(cleaned.jtis, 1);
  assert.equal(ctx.rows.lwsAccessRequests[2].status, 'expired');
  assert.equal((await call(ctx, 'pendingAccessRequestsInternal', { authToken: ownerToken })).length, 7);
  // Another account's request is indistinguishable from none.
  ctx.rows.users.push({ _id: 'U2', did: 'did:webvh:x:boop.ad:user-other', turnkeySubOrgId: 'other', displayName: 'Other', createdAt: 1 });
  await assert.rejects(() => lwsAccess.approveAccessRequestForUser._handler(ctx, { userId: 'U2', requestId: ids[3] }), /unavailable/i);
  await assert.rejects(() => lwsAccess.revokeAgentForUser._handler(ctx, { userId: 'U2', agentId: 'lwsAgents:404' }), /unavailable/i);
  // Per-IP budget: 10 a minute.
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await http(ctx, 'postAccessRequest', postRequest({}, 'x.y.z', { 'CF-Connecting-IP': '192.0.2.77' }))).status);
  assert.equal(statuses.at(-1), 429);
  assert.ok(ctx.rows.rateLimits.every(row => !row.key.includes('192.0.2.77')), 'the IP is stored hashed');
});

test('metadata documents', async () => {
  const ctx = convex({});
  const config = await (await http(ctx, 'getLwsConfiguration', new Request(`https://deployment.convex.site/.well-known/lws-configuration`))).json();
  assert.equal(config.issuer, B);
  assert.equal(config.token_endpoint, `${B}/oauth/token`);
  assert.deepEqual(config.grant_types_supported, ['urn:ietf:params:oauth:grant-type:token-exchange']);
  assert.deepEqual(config.subject_token_types_supported, ['urn:ietf:params:oauth:token-type:jwt']);
  const prm = await http(ctx, 'getProtectedResourceMetadata', new Request(`https://deployment.convex.site/.well-known/oauth-protected-resource/lws/${U}/L1/I1`));
  assert.deepEqual(await prm.json(), { resource: `${B}/lws/${U}/L1/I1`, authorization_servers: [B], bearer_methods_supported: ['header'] });
  assert.equal((await http(ctx, 'getProtectedResourceMetadata', new Request(`https://deployment.convex.site/.well-known/oauth-protected-resource/lws/admin`))).status, 404);
  // The challenge points at exactly this document.
  const challenge = urls.lwsChallenge(`https://deployment.convex.site/lws/${U}/L1/I1`);
  assert.match(challenge['WWW-Authenticate'], new RegExp(`resource_metadata="${B}/.well-known/oauth-protected-resource/lws/${U}/L1/I1"`));
});

// ---------------------------------------------------------------------------
// Agent tokens are good on LWS storage only, and only for the user's own lists
// ---------------------------------------------------------------------------

/** world(), plus an approved agent with a live access token, a list shared with the user, and the user's own list. */
async function agentWorld() {
  const w = await world();
  const token = 'lwsat_agent-token-for-tests';
  Object.assign(w.ctx.rows, {
    lwsAgents: [{ _id: 'A1', userId: 'U1', ownerDid: w.author.did, fragment: 'agent-abcdefghij', vmId: `${w.author.did}#agent-abcdefghij`, publicKeyMultibase: 'z6Mk', name: 'Bot', actions: ['read', 'create'], scopes: ['lists:read', 'items:read', 'items:write'], requestId: 'r', createdAt: 1 }],
    lwsAccessTokens: [{ _id: 'T1', tokenHash: hash(token), agentId: 'A1', userId: 'U1', storage: `${B}/lws/${U}`, scopes: ['lists:read', 'items:read', 'items:write'], expiresAt: Date.now() + 3600000 }],
    lists: [
      { _id: 'OWN', ownerDid: w.author.did, name: 'Mine', createdAt: 1 },
      { _id: 'SHARED', ownerDid: 'did:webvh:x:boop.ad:user-friend', name: "A friend's", createdAt: 1 },
      { _id: 'PUBLISHED', ownerDid: 'did:webvh:x:boop.ad:user-friend', name: 'Published', createdAt: 1 },
    ],
    listGrants: [{ _id: 'G1', listId: 'SHARED', recipientId: 'U1', role: 'editor', acceptedAt: 1 }],
    publications: [{ _id: 'P1', listId: 'PUBLISHED', status: 'active', webvhDid: 'did:webvh:pub', publishedAt: 1 }],
    bookmarks: [{ _id: 'BM1', userDid: w.author.did, listId: 'PUBLISHED' }],
  });
  w.ctx.rows.users.push({ _id: 'U2', did: 'did:webvh:x:boop.ad:user-friend', turnkeySubOrgId: 'friend', displayName: 'Friend', createdAt: 1 });
  return { ...w, token };
}

test('an lwsat_ bearer is no credential on /api/* routes', async () => {
  const { ctx, token, ownerToken } = await agentWorld();
  assert.equal((await actor.authenticate(ctx, { agentToken: token })).credential.kind, 'agent', 'the token itself is valid');
  const request = new Request(`${B}/api/v1/lists`, { headers: { Authorization: `Bearer ${token}` } });
  assert.deepEqual(actor.requestCredentials(request), { authToken: undefined, apiKey: undefined });
  const response = await agentReadHttp.getLists._handler(ctx, request);
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /Mine/);
  // A session still works on the same route.
  const withSession = new Request(`${B}/api/v1/lists`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert.equal(actor.requestCredentials(withSession).authToken, ownerToken);
  // Called directly, the operation wrappers ignore an agent token, so there is no credential.
  await assert.rejects(() => lists.getUserListsInternal._handler(ctx, { agentToken: token }), /Authentication required/);
  await assert.rejects(() => actorSession.resolve._handler(ctx, { agentToken: token }), /Authentication required/);
  await assert.rejects(() => actorSession.authorize._handler(ctx, { agentToken: token, authority: 'read', scope: 'lists:read', resources: { lists: ['OWN'] } }), /Authentication required/);
});

test("an agent is authorized for the user's own lists only", async () => {
  const { ctx, token, ownerToken } = await agentWorld();
  const agent = await actor.authenticate(ctx, { agentToken: token });
  const session = await actor.authenticate(ctx, { authToken: ownerToken });
  const allowed = (who, lists, authority) => permissions.authorizeResources(ctx, who, { lists }, authority).then(() => true, () => false);
  for (const authority of ['read', 'edit', 'owner']) assert.equal(await allowed(agent, ['OWN'], authority), true, authority);
  // The user may use the shared and published lists; the agent may not, at any authority.
  assert.equal(await allowed(session, ['SHARED'], 'edit'), true);
  assert.equal(await allowed(session, ['PUBLISHED'], 'read'), true);
  for (const authority of ['read', 'edit', 'owner']) {
    assert.equal(await allowed(agent, ['SHARED'], authority), false, `shared, ${authority}`);
    assert.equal(await allowed(agent, ['PUBLISHED'], authority), false, `published and bookmarked, ${authority}`);
  }
  assert.equal(await allowed(agent, ['OWN', 'SHARED'], 'read'), false, 'one foreign list fails the lot');
  // Items resolve to their list.
  ctx.rows.items = [{ _id: 'IS', listId: 'SHARED', name: 'x', checked: false, createdAt: 1, createdByDid: 'did:other' }];
  await assert.rejects(() => permissions.authorizeResources(ctx, agent, { items: ['IS'] }, 'read'), /unavailable/i);
  // Not while the account is being erased.
  ctx.rows.users[0].deletionRequestedAt = Date.now();
  assert.equal(await allowed({ ...agent }, ['OWN'], 'read'), false);
});

// Phase 4: scripts/lws-agent.mjs, the CLI agent, against the server's own verifiers.
test('the CLI agent signs credentials the server accepts', async () => {
  const cli = await import(pathToFileURL(`${process.cwd()}/scripts/lws-agent.mjs`).href);
  const key = await cli.newKey();
  const requests = `${B}/lws-access/requests`;
  const asItself = lwsJwt.verifyDidKeyJwt(await cli.didKeyJwt(key, requests), { audience: requests, now: Date.now() });
  assert.equal(asItself.didKey, key.didKey);
  assert.equal(asItself.publicKeyMultibase, key.multikey);
  const did = 'did:webvh:QmScid:boop.test:user-sub-org';
  const vm = `${did}#agent-abcdefghij`;
  const document = {
    id: did,
    verificationMethod: [{ id: vm, type: 'Multikey', controller: did, publicKeyMultibase: key.multikey }],
    authentication: [vm],
  };
  const asUser = lwsJwt.verifyAgentJwt(await cli.agentJwt(key, vm, B), { audience: B, now: Date.now(), document });
  assert.equal(asUser.kid, vm);
  assert.equal(asUser.subject, did);
  assert.deepEqual(cli.authParams('Bearer resource_metadata="https://x/.well-known/a", error="invalid_token"'),
    { resource_metadata: 'https://x/.well-known/a', error: 'invalid_token' });
  assert.deepEqual(cli.parseLinks('<https://x/s>; rel="https://www.w3.org/ns/lws#storage", <https://x/>; rel=up'),
    [{ href: 'https://x/s', rel: ['https://www.w3.org/ns/lws#storage'] }, { href: 'https://x/', rel: ['up'] }]);
});

test('the dev seed refuses anything that may be prod, and accounts it did not make', () => {
  assert.throws(() => devLws.assertDevSeedAllowed({ WEBVH_DOMAIN: 'boop.ad', LWS_DEV_SEED: '1' }), /prod/);
  assert.throws(() => devLws.assertDevSeedAllowed({ WEBVH_DOMAIN: 'www.boop.ad', LWS_DEV_SEED: '1' }), /prod/);
  assert.throws(() => devLws.assertDevSeedAllowed({ LWS_DEV_SEED: '1' }), /prod/, 'unset domain is not clearly dev');
  assert.throws(() => devLws.assertDevSeedAllowed({ WEBVH_DOMAIN: 'lvh.me:5173' }), /LWS_DEV_SEED/);
  assert.throws(() => devLws.assertDevSeedAllowed({ WEBVH_DOMAIN: 'lvh.me:5173', LWS_DEV_SEED: 'true' }), /LWS_DEV_SEED/);
  assert.doesNotThrow(() => devLws.assertDevSeedAllowed({ WEBVH_DOMAIN: 'lvh.me:5173', LWS_DEV_SEED: '1' }));
  assert.equal(devLws.isSeedUser({ turnkeySubOrgId: 'lws-e2e-0123456789abcdef', email: 'lws-e2e+a1b2c3@example.invalid' }), true);
  assert.equal(devLws.isSeedUser({ turnkeySubOrgId: 'lws-e2e-0123456789abcdef', email: 'brian@example.com' }), false);
  assert.equal(devLws.isSeedUser({ turnkeySubOrgId: '20ed9d43-2d31-44aa', email: 'lws-e2e+a1@example.invalid' }), false);
  assert.equal(devLws.isSeedUser(null), false);
});
