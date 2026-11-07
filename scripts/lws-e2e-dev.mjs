#!/usr/bin/env node
// End-to-end LWS agent auth against the DEV Convex deployment
// (docs/lws-agent-auth.md "End-to-end on dev").
//
//   npx convex env set LWS_DEV_SEED 1      # dev only
//   node scripts/lws-e2e-dev.mjs
//   npx convex env remove LWS_DEV_SEED
//
// `npx convex run` targets the deployment in .env.local (CONVEX_DEPLOYMENT,
// dev). HTTP goes to that deployment's site URL. The agent is
// scripts/lws-agent.mjs, run as a separate process the way a real agent runs.
//
// What stands in for the app: the owner's Turnkey keys are local Ed25519
// keys, and devLws.ts stores the DID log they sign after the same write check
// /api/did/log makes. The app's own code builds the DID (src/lib/authorDid.ts
// mintAuthorDid) and the agent-key update (src/lib/agentKeys.ts
// buildAgentUpdate). Approval and revocation are the deployed
// lwsAccess.approveAccessRequestForUser / revokeAgentForUser.
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import * as agent from './lws-agent.mjs';

const run = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;
const OUT = `${ROOT}tmp/lws-e2e`;
const AGENT = `${ROOT}scripts/lws-agent.mjs`;

// --- plumbing ------------------------------------------------------------------

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: pass ? '' : String(detail).slice(0, 160) });
  return !!pass;
}

async function convex(fn, args = {}) {
  try {
    const { stdout } = await run('npx', ['convex', 'run', fn, JSON.stringify(args)], { cwd: ROOT, maxBuffer: 16 << 20 });
    const text = stdout.trim();
    return text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`convex run ${fn} failed: ${(error.stderr || error.message).split('\n').filter(l => !/ExperimentalWarning|trace-warnings/.test(l)).join(' ').slice(0, 600)}`);
  }
}

async function cli(...argv) {
  try {
    const { stdout } = await run(process.execPath, [AGENT, ...argv], { cwd: ROOT });
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`lws-agent ${argv[0]}: ${(error.stderr || error.message).trim()}`);
  }
}

async function siteUrl() {
  const env = await readFile(`${ROOT}.env.local`, 'utf8').catch(() => '');
  const cloud = env.match(/^VITE_CONVEX_URL=(\S+)/m)?.[1];
  if (cloud?.endsWith('.convex.cloud')) return cloud.replace(/\.convex\.cloud\/?$/, '.convex.site');
  const { stdout } = await run('npx', ['convex', 'env', 'get', 'CONVEX_SITE_URL'], { cwd: ROOT });
  return stdout.trim().replace(/\/+$/, '');
}

async function http(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* text */ }
  return { status: response.status, headers: response.headers, body };
}

const rels = (headers) => agent.parseLinks(headers.get('Link'));
const relHref = (headers, rel) => rels(headers).find(link => link.rel.includes(rel))?.href;
const LWS = 'https://www.w3.org/ns/lws#';

/** ETag, Last-Modified and the Link rels a resource GET must carry. */
function checkResourceHeaders(name, response, { up, type, storage }) {
  const h = response.headers;
  const problems = [];
  if (response.status !== 200) problems.push(`status ${response.status}`);
  if (!/^"[^"]+"$/.test(h.get('ETag') ?? '')) problems.push(`ETag ${h.get('ETag')}`);
  if (Number.isNaN(Date.parse(h.get('Last-Modified') ?? ''))) problems.push(`Last-Modified ${h.get('Last-Modified')}`);
  if (relHref(h, 'up') !== up) problems.push(`up ${relHref(h, 'up')} ≠ ${up}`);
  if (relHref(h, 'type') !== type) problems.push(`type ${relHref(h, 'type')}`);
  if (relHref(h, agent.STORAGE_REL) !== storage) problems.push(`storage ${relHref(h, agent.STORAGE_REL)}`);
  if (!relHref(h, 'linkset')) problems.push('no linkset');
  return check(name, problems.length === 0, problems.join('; '));
}

/** The app's DID code, bundled for Node with the browser-only modules stubbed. */
async function appDidCode() {
  await mkdir(OUT, { recursive: true });
  await build({
    stdin: {
      contents: [
        "export * as authorDid from './src/lib/authorDid.ts';",
        "export * as agentKeys from './src/lib/agentKeys.ts';",
        "export * as shared from './shared/authorDid.ts';",
      ].join('\n'),
      resolveDir: ROOT, loader: 'ts',
    },
    outfile: `${OUT}/app.mjs`, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'silent',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    plugins: [{
      name: 'stubs', setup(b) {
        b.onResolve({ filter: /^(\.\/turnkeySession|\.\/convexUrls|@capacitor\/core)$/ }, args => ({ path: args.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ loader: 'js', contents: {
          './turnkeySession': 'export const authorSigningReady=async()=>true; export const turnkeyAuthorBackend=()=>{throw new Error("no Turnkey in the e2e")};',
          './convexUrls': 'export const getConvexHttpUrl=()=>{throw new Error("unused")};',
          '@capacitor/core': 'export const Capacitor={isNativePlatform:()=>false,getPlatform:()=>"web"};',
        }[path] }));
      },
    }],
  });
  globalThis.window ??= { location: { host: 'localhost' } };
  globalThis.localStorage ??= { removeItem() {}, getItem: () => null, setItem() {} };
  return import(`${pathToFileURL(`${OUT}/app.mjs`).href}?t=${Date.now()}`);
}

/** A sub-org's Turnkey wallet, as local keys: the author key and the assertion key. */
async function localTurnkey(shared) {
  const accounts = [];
  for (const path of [shared.AUTHOR_KEY_PATH, shared.ASSERTION_KEY_PATH]) {
    const key = await agent.newKey();
    accounts.push({ walletId: 'local', path, publicKey: key.publicKey, address: agent.base58(key.publicKey), secret: key.secret });
  }
  const ed = await import('@noble/ed25519');
  return {
    accounts: accounts.map(({ path, address }) => ({ path, address })),
    secretFor: (path) => accounts.find(a => a.path === path).secret,
    backend: {
      ed25519Accounts: async () => accounts.map(({ secret: _s, ...a }) => ({ ...a })),
      createEd25519Account: async () => { throw new Error('no new accounts'); },
      sign: async (_subOrg, address, message) => ed.signAsync(message, accounts.find(a => a.address === address).secret),
    },
  };
}

/** A test account on dev: a local author DID minted by the app's code, stored by the seed, with lists. */
async function seedAccount(app, domain, lists) {
  const n = randomBytes(5).toString('hex');
  const subOrgId = `lws-e2e-${randomBytes(8).toString('hex')}`;
  const turnkey = await localTurnkey(app.shared);
  const keys = await app.authorDid.resolveAuthorKeys(turnkey.backend, subOrgId);
  const path = `user-${subOrgId.slice(0, 16)}`;
  const minted = await app.authorDid.mintAuthorDid({ backend: turnkey.backend, subOrgId, keys, domain, path });
  const seeded = await convex('devLws:seed', { n, subOrgId, log: minted.jsonl, accounts: turnkey.accounts, lists });
  return { ...seeded, subOrgId, keys, turnkey };
}

// --- the run -----------------------------------------------------------------------

async function main() {
  const B = await siteUrl();
  console.log(`dev site: ${B}`);
  const app = await appDidCode();
  const { domain } = await convex('devLws:config');
  const seeded = [];
  const statePath = `${OUT}/agent-${Date.now()}.json`;
  const narrowPath = `${OUT}/agent-narrow-${Date.now()}.json`;
  try {
    // 1. Seed: the owner, and a second account the agent must not reach.
    const owner = await seedAccount(app, domain, [
      { name: 'LWS e2e groceries', items: ['Milk', 'Bread'] },
      { name: 'LWS e2e chores', items: ['Laundry'] },
    ]);
    seeded.push(owner.userId);
    const other = await seedAccount(app, domain, [{ name: 'Not yours', items: ['Secret'] }]);
    seeded.push(other.userId);
    check('seed: two accounts with author DIDs', owner.did.startsWith('did:webvh:') && other.did.startsWith('did:webvh:'));
    const storage = `${B}/lws/${owner.path}`;
    const root = `${storage}/`;
    const [groceries] = owner.lists;
    const listUrl = `${root}${groceries.listId}/`;
    const itemUrl = `${listUrl}${groceries.itemIds[0]}`;

    // 2. The agent: a key, and an access request over real HTTP.
    await cli('keygen', '--state', statePath);
    const requested = await cli('request', storage, '--name', 'e2e agent', '--actions', 'read,create,update,delete', '--state', statePath);
    check('request: 201 + Location', requested.status === 201 && requested.requestUrl.startsWith(`${B}/lws-access/requests/`), JSON.stringify(requested));
    const pendingStatus = await cli('status', '--state', statePath);
    check('status: pending before approval', pendingStatus.status === 'pending', JSON.stringify(pendingStatus));

    // 3. The owner: the pending request, the DID update the app would sign, then approve.
    const [pending] = await convex('lwsAccess:pendingAccessRequestsForUser', { userId: owner.userId });
    const state = await agent.loadState(statePath);
    check('owner sees the request with the agent key', pending?.agentPublicKeyMultibase === state.key.multikey, JSON.stringify(pending));
    check('the CLI prints the fingerprint the app shows', requested.fingerprint === app.agentKeys.shortKey(pending.agentDidKey), `${requested.fingerprint} / ${app.agentKeys.shortKey(pending.agentDidKey)}`);
    const served = await (await fetch(`${B}/api/did/log?path=${encodeURIComponent(owner.path)}`)).text();
    const author = { subOrgId: owner.subOrgId, did: owner.did, keys: owner.keys };
    const deps = { backend: owner.turnkey.backend, ready: async () => true };
    const added = await app.agentKeys.buildAgentUpdate(author, served, { add: { fragment: pending.fragment, publicKeyMultibase: pending.agentPublicKeyMultibase } }, deps);
    await convex('devLws:storeDidContinuation', { userId: owner.userId, log: added.jsonl, accounts: owner.turnkey.accounts });
    const servedAfter = await (await fetch(`${B}/api/did/log?path=${encodeURIComponent(owner.path)}`)).text();
    check('DID serves the agent method', servedAfter.includes(`#${pending.fragment}`));
    const approved = await convex('lwsAccess:approveAccessRequestForUser', { userId: owner.userId, requestId: pending.requestId });
    check('approve', approved?.vmId === `${owner.did}#${pending.fragment}`, JSON.stringify(approved));

    // 4. The agent: its grant, then a token through discovery.
    const granted = await cli('status', '--state', statePath);
    check('status: approved with verificationMethod', granted.status === 'approved' && granted.verificationMethod === approved.vmId, JSON.stringify(granted));
    const tokenResult = await cli('token', '--state', statePath);
    check('token: discovery + exchange, the granted actions, 300 s', tokenResult.scope === 'read create update delete'
      && Math.abs(Date.parse(tokenResult.expiresAt) - Date.now() - 300_000) < 30_000, JSON.stringify(tokenResult));
    const accessToken = (await agent.loadState(statePath)).token.accessToken;
    const auth = { Authorization: `Bearer ${accessToken}` };

    // 5. Reads.
    const description = await http(storage);
    check('GET description (public)', description.status === 200
      && description.headers.get('Content-Type')?.startsWith('application/lws+cid')
      && description.body?.service?.some(s => s.type === 'StorageRoot' && s.serviceEndpoint === root)
      && description.body?.service?.some(s => s.type === 'AccessRequestService'), `${description.status} ${JSON.stringify(description.body).slice(0, 120)}`);
    const rootGet = await http(root, { headers: auth });
    checkResourceHeaders('GET root container: headers', rootGet, { up: undefined, type: `${LWS}Container`, storage });
    check('GET root container: own lists only', rootGet.body?.items?.length === 2 && rootGet.body.items.every(m => m.id.startsWith(root)), JSON.stringify(rootGet.body).slice(0, 160));
    const listGet = await http(listUrl, { headers: auth });
    checkResourceHeaders('GET list container: headers', listGet, { up: root, type: `${LWS}Container`, storage });
    check('GET list container: items', listGet.body?.items?.length === 2, JSON.stringify(listGet.body).slice(0, 160));
    const itemGet = await http(itemUrl, { headers: auth });
    checkResourceHeaders('GET item: headers', itemGet, { up: listUrl, type: `${LWS}DataResource`, storage });
    check('GET item: body', itemGet.body?.name === 'Milk' && itemGet.body?.id === itemUrl, JSON.stringify(itemGet.body).slice(0, 160));
    const conditional = await http(itemUrl, { headers: { ...auth, 'If-None-Match': itemGet.headers.get('ETag') } });
    check('GET item If-None-Match → 304', conditional.status === 304, conditional.status);

    // 6. Create.
    const created = await http(listUrl, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Eggs', priority: 'high' }) });
    const location = created.headers.get('Location');
    check('POST item → 201 + Location', created.status === 201 && location?.startsWith(listUrl) && created.body?.name === 'Eggs', `${created.status} ${location} ${JSON.stringify(created.body).slice(0, 100)}`);

    // 7. Conditional writes.
    const etag = created.headers.get('ETag');
    const renamed = await http(location, { method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/merge-patch+json', 'If-Match': etag }, body: JSON.stringify({ name: 'Free-range eggs' }) });
    check('PATCH If-Match → 200', renamed.status === 200 && renamed.body?.name === 'Free-range eggs' && renamed.headers.get('ETag') !== etag, `${renamed.status} ${JSON.stringify(renamed.body).slice(0, 100)}`);
    const stale = await http(location, { method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json-patch+json', 'If-Match': etag }, body: JSON.stringify([{ op: 'replace', path: '/name', value: 'Lost update' }]) });
    check('PATCH stale If-Match → 412', stale.status === 412, `${stale.status} ${JSON.stringify(stale.body).slice(0, 100)}`);
    const checkedItem = await cli('patch', location, '{"checked":true}', '--state', statePath);
    check('PATCH checked:true (agent CLI, fresh If-Match) → 200', checkedItem.status === 200 && checkedItem.body?.checked === true && checkedItem.body?.checkedAt, JSON.stringify(checkedItem).slice(0, 160));
    const reread = await http(location, { headers: auth });
    check('GET after writes', reread.body?.name === 'Free-range eggs' && reread.body?.checked === true, JSON.stringify(reread.body).slice(0, 120));

    // 8. Delete.
    const deleted = await http(location, { method: 'DELETE', headers: { ...auth, 'If-Match': reread.headers.get('ETag') } });
    const gone = await http(location, { headers: auth });
    check('DELETE → 204, then 404', deleted.status === 204 && gone.status === 404, `${deleted.status} ${gone.status}`);

    // 8b. A second agent approved for [read, create] only: it may create, never update or delete.
    await cli('keygen', '--state', narrowPath);
    await cli('request', storage, '--name', 'e2e narrow agent', '--actions', 'read,create', '--state', narrowPath);
    const narrowPending = (await convex('lwsAccess:pendingAccessRequestsForUser', { userId: owner.userId })).find(r => r.name === 'e2e narrow agent');
    const servedForNarrow = await (await fetch(`${B}/api/did/log?path=${encodeURIComponent(owner.path)}`)).text();
    const narrowAdded = await app.agentKeys.buildAgentUpdate(author, servedForNarrow, { add: { fragment: narrowPending.fragment, publicKeyMultibase: narrowPending.agentPublicKeyMultibase } }, deps);
    await convex('devLws:storeDidContinuation', { userId: owner.userId, log: narrowAdded.jsonl, accounts: owner.turnkey.accounts });
    await convex('lwsAccess:approveAccessRequestForUser', { userId: owner.userId, requestId: narrowPending.requestId });
    await cli('status', '--state', narrowPath);
    const narrowToken = await cli('token', '--state', narrowPath);
    check('narrow agent: token for read create', narrowToken.scope === 'read create', JSON.stringify(narrowToken));
    const narrowAuth = { Authorization: `Bearer ${(await agent.loadState(narrowPath)).token.accessToken}` };
    const narrowCreated = await http(listUrl, { method: 'POST', headers: { ...narrowAuth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Narrow' }) });
    const narrowItem = narrowCreated.headers.get('Location');
    check('narrow agent: POST → 201', narrowCreated.status === 201 && narrowCreated.body?.name === 'Narrow', `${narrowCreated.status} ${JSON.stringify(narrowCreated.body).slice(0, 100)}`);
    const narrowPatch = await http(narrowItem, { method: 'PATCH', headers: { ...narrowAuth, 'Content-Type': 'application/merge-patch+json' }, body: JSON.stringify({ name: 'Changed' }) });
    check('narrow agent: PATCH → 403 insufficient_scope', narrowPatch.status === 403 && /insufficient_scope/.test(narrowPatch.headers.get('WWW-Authenticate') ?? ''), `${narrowPatch.status} ${narrowPatch.headers.get('WWW-Authenticate')}`);
    const narrowDelete = await http(narrowItem, { method: 'DELETE', headers: narrowAuth });
    const narrowAfter = await http(narrowItem, { headers: narrowAuth });
    check('narrow agent: DELETE → 403, item unchanged', narrowDelete.status === 403 && narrowAfter.body?.name === 'Narrow', `${narrowDelete.status} ${JSON.stringify(narrowAfter.body).slice(0, 80)}`);
    await http(narrowItem, { method: 'DELETE', headers: auth });

    // 9. Refusals.
    const anonymous = await http(root);
    const challenge = agent.authParams(anonymous.headers.get('WWW-Authenticate'));
    check('no token → 401 + resource_metadata', anonymous.status === 401 && challenge.resource_metadata === `${B}/.well-known/oauth-protected-resource/lws/${owner.path}/` && !challenge.error
      && relHref(anonymous.headers, agent.STORAGE_REL) === storage, `${anonymous.status} ${anonymous.headers.get('WWW-Authenticate')}`);
    const api = await http(`${B}/api/v1/lists`, { headers: auth });
    check('lwsat_ token on /api/v1/lists → 401', api.status === 401, api.status);

    const discovery = (await agent.loadState(statePath)).discovery;
    const replayJwt = await agent.agentJwt(state.key, approved.vmId, discovery.issuer);
    const first = await agent.exchange(discovery.tokenEndpoint, replayJwt, storage).then(() => 'ok', e => e.message);
    const again = await agent.exchange(discovery.tokenEndpoint, replayJwt, storage).then(() => 'ok', e => e.message);
    check('token: same jti twice → refused', first === 'ok' && /invalid_request/.test(again) && /jti/.test(again), `${first} / ${again}`);

    // The author's own key, as #key-0: a valid signature by a key of the DID, but not an agent method.
    const authorKey = await agent.keyFromSecret(owner.turnkey.secretFor(app.shared.AUTHOR_KEY_PATH));
    const keyZero = await agent.agentJwt(authorKey, `${owner.did}#key-0`, discovery.issuer);
    const keyZeroResult = await agent.exchange(discovery.tokenEndpoint, keyZero, storage).then(() => 'ok', e => e.message);
    check('token: kid #key-0 → refused', /invalid_request/.test(keyZeroResult), keyZeroResult);

    const otherStorage = `${B}/lws/${other.path}`;
    const otherRoot = await http(`${otherStorage}/`, { headers: auth });
    const otherList = await http(`${otherStorage}/${other.lists[0].listId}/`, { headers: auth });
    check('other account storage → 401', otherRoot.status === 401 && otherList.status === 401, `${otherRoot.status} ${otherList.status}`);
    const otherTarget = await agent.exchange(discovery.tokenEndpoint, await agent.agentJwt(state.key, approved.vmId, discovery.issuer), otherStorage).then(() => 'ok', e => e.message);
    check('token for other storage → invalid_target', /invalid_target/.test(otherTarget), otherTarget);
    const crossList = await http(`${root}${other.lists[0].listId}/`, { headers: auth });
    check("other account's list via own storage → 404", crossList.status === 404, crossList.status);

    // 10. Revoke, then the DID update that removes the key.
    const active = (await convex('lwsAccess:activeAgentsForUser', { userId: owner.userId })).find(a => a.vmId === approved.vmId);
    await convex('lwsAccess:revokeAgentForUser', { userId: owner.userId, agentId: active.agentId });
    const afterRevoke = await http(root, { headers: auth });
    check('after revoke: token → 401', afterRevoke.status === 401 && /invalid_token/.test(afterRevoke.headers.get('WWW-Authenticate') ?? ''), afterRevoke.status);
    const exchangeAfter = await agent.exchange(discovery.tokenEndpoint, await agent.agentJwt(state.key, approved.vmId, discovery.issuer), storage).then(() => 'ok', e => e.message);
    check('after revoke: exchange refused (key still in DID)', /invalid_request/.test(exchangeAfter), exchangeAfter);
    const revokedStatus = await cli('status', '--state', statePath);
    check('after revoke: status revoked, no grant', revokedStatus.status === 'revoked' && !revokedStatus.verificationMethod, JSON.stringify(revokedStatus));
    const servedNow = await (await fetch(`${B}/api/did/log?path=${encodeURIComponent(owner.path)}`)).text();
    const removed = await app.agentKeys.buildAgentUpdate(author, servedNow, { remove: pending.fragment }, deps);
    await convex('devLws:storeDidContinuation', { userId: owner.userId, log: removed.jsonl, accounts: owner.turnkey.accounts });
    const exchangeRemoved = await agent.exchange(discovery.tokenEndpoint, await agent.agentJwt(state.key, approved.vmId, discovery.issuer), storage).then(() => 'ok', e => e.message);
    check('after key removal: exchange refused', /invalid_request/.test(exchangeRemoved), exchangeRemoved);
  } catch (error) {
    check('run completed', false, error.message);
  } finally {
    // 11. Cleanup, always.
    try {
      const cleaned = await convex('devLws:cleanup', { userIds: seeded, all: true });
      const left = await convex('devLws:remaining');
      check('cleanup', left.accounts === 0, JSON.stringify({ cleaned, left }));
      console.log(`cleanup: ${JSON.stringify(cleaned)}`);
    } catch (error) {
      check('cleanup', false, error.message);
    }
    await rm(statePath, { force: true });
    await rm(narrowPath, { force: true });
  }

  const width = Math.max(...results.map(r => r.name.length));
  console.log(`\n${'check'.padEnd(width)}  result`);
  for (const r of results) console.log(`${r.name.padEnd(width)}  ${r.pass ? 'PASS' : `FAIL  ${r.detail}`}`);
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
}

await main();
