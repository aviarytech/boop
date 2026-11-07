#!/usr/bin/env node
// A Linked Web Storage agent for boop (docs/lws-agent-auth.md "Agent CLI").
// Needs only @noble/ed25519 and Node's fetch.
//
//   node scripts/lws-agent.mjs keygen  --state agent.json
//   node scripts/lws-agent.mjs request <storageUrl> --name "My agent" --actions read,create,update,delete --state agent.json
//   node scripts/lws-agent.mjs status  --state agent.json
//   node scripts/lws-agent.mjs token   --state agent.json
//   node scripts/lws-agent.mjs get     <url> --state agent.json
//   node scripts/lws-agent.mjs create  <containerUrl> '<json>' --state agent.json
//   node scripts/lws-agent.mjs patch   <url> '<json>' [--etag '"…"'] --state agent.json
//   node scripts/lws-agent.mjs delete  <url> [--etag '"…"'] --state agent.json
//
// The state file (mode 0600) holds the agent's secret key, its request, its
// grant and its cached access token. Output is JSON on stdout; errors go to
// stderr with exit code 1.
import * as ed from '@noble/ed25519';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
export const JWT_TYPE = 'urn:ietf:params:oauth:token-type:jwt';
export const LWS_CONTEXT = 'https://www.w3.org/ns/lws/v1';
export const STORAGE_REL = 'https://www.w3.org/ns/lws#storage';
const JWT_LIFETIME_S = 300;
/** Refresh a cached access token this long before it expires (boop's last 300 s). */
const TOKEN_MARGIN_MS = 30_000;

export class AgentError extends Error {}

// --- encodings ---------------------------------------------------------------

export const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const fromB64url = (text) => new Uint8Array(Buffer.from(text, 'base64url'));
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes) {
  let n = 0n;
  for (const byte of bytes) n = n * 256n + BigInt(byte);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; out = `1${out}`; }
  return out;
}

/** `z6Mk…`: the Ed25519 Multikey (multicodec 0xed01, base58btc). */
export const ed25519Multikey = (publicKey) => `z${base58(new Uint8Array([0xed, 0x01, ...publicKey]))}`;

// --- keys and JWTs -------------------------------------------------------------

/**
 * The key's fingerprint as Settings → Agents shows it next to a pending
 * request (shared/multikey.ts keyFingerprint): the Multikey's last 12
 * characters in groups of four.
 */
export function keyFingerprint(key) {
  const multikey = key.replace(/^did:key:/, '').split('#')[0];
  const tail = multikey.length > 12 ? multikey.slice(-12) : multikey;
  return tail.match(/.{1,4}/g)?.join(' ') ?? '';
}

export async function newKey() {
  const secret = ed.utils.randomSecretKey();
  return keyFromSecret(secret);
}

export async function keyFromSecret(secret) {
  const publicKey = await ed.getPublicKeyAsync(secret);
  const multikey = ed25519Multikey(publicKey);
  return { secret, publicKey, multikey, didKey: `did:key:${multikey}` };
}

/** A compact EdDSA JWT. `claims` is signed as given. */
export async function signJwt(header, claims, secret) {
  const input = `${b64url(Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', ...header })))}.${b64url(Buffer.from(JSON.stringify(claims)))}`;
  const signature = await ed.signAsync(new TextEncoder().encode(input), secret);
  return `${input}.${b64url(signature)}`;
}

export const newJti = () => b64url(randomBytes(18));

/** LWS self-signed credential claims: sub = iss = client_id, a short life, a fresh jti. */
export function lwsClaims(subject, audience, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  return { sub: subject, iss: subject, client_id: subject, aud: [].concat(audience), iat, exp: iat + JWT_LIFETIME_S, jti: newJti() };
}

/** The agent as itself (did:key), for its access request and polling. */
export function didKeyJwt(key, audience) {
  return signJwt({ kid: `${key.didKey}#${key.multikey}` }, lwsClaims(key.didKey, audience), key.secret);
}

/** The agent as the user: `kid` is the granted method, `sub` the user's DID. */
export function agentJwt(key, verificationMethod, audience, overrides = {}) {
  const did = verificationMethod.split('#')[0];
  return signJwt({ kid: verificationMethod }, { ...lwsClaims(did, audience), ...overrides }, key.secret);
}

// --- state ---------------------------------------------------------------------

export async function loadState(path) {
  let state;
  try { state = JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    throw new AgentError(error.code === 'ENOENT' ? `No state at ${path}: run keygen first` : `Can't read ${path}: ${error.message}`);
  }
  if (!state.key?.secret) throw new AgentError(`${path} holds no key`);
  return { ...state, key: await keyFromSecret(fromB64url(state.key.secret)) };
}

export async function saveState(path, state) {
  const { key, ...rest } = state;
  const stored = { ...rest, key: { secret: b64url(key.secret), publicKeyMultibase: key.multikey, didKey: key.didKey } };
  await writeFile(path, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

// --- HTTP ------------------------------------------------------------------------

const sameOrigin = (a, b) => { const x = new URL(a), y = new URL(b); return x.protocol === y.protocol && x.host === y.host; };

async function fetchJson(url, init = {}, what = url) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!response.ok) throw new AgentError(`${what}: ${response.status} ${body?.detail ?? body?.title ?? body?.error_description ?? body?.error ?? text.slice(0, 200)}`);
  return { response, body };
}

/** Split a header like `Bearer a="b", c="d"` into its auth-params. */
export function authParams(header) {
  const params = {};
  for (const match of (header ?? '').matchAll(/([A-Za-z_][\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g)) {
    params[match[1].toLowerCase()] = match[2] !== undefined ? match[2].replace(/\\(.)/g, '$1') : match[3];
  }
  return params;
}

/** `Link` header → [{href, rel: [..]}]. */
export function parseLinks(header) {
  const links = [];
  for (const part of (header ?? '').split(/,(?=\s*<)/)) {
    const match = part.match(/^\s*<([^>]*)>(.*)$/);
    if (!match) continue;
    const rel = match[2].match(/;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/i);
    links.push({ href: match[1], rel: (rel?.[1] ?? rel?.[2] ?? '').split(/\s+/).filter(Boolean) });
  }
  return links;
}

/** The storage description, and the service of `type` in it. */
export async function storageService(storageUrl, type) {
  const { body } = await fetchJson(storageUrl, { headers: { Accept: 'application/lws+cid, application/json' } }, 'storage description');
  const service = (body?.service ?? []).find(s => [].concat(s.type).includes(type));
  if (!service?.serviceEndpoint) throw new AgentError(`The storage description has no ${type}`);
  return { description: body, endpoint: service.serviceEndpoint };
}

/**
 * The token endpoint for `requestedUri`, found the way LWS Authorization
 * describes: an unauthenticated request's 401 → `resource_metadata` →
 * `authorization_servers` → `/.well-known/lws-configuration`, with the
 * client's discovery validation checks. Returns the storage (the token
 * request's `resource`), the issuer and the token endpoint.
 */
export async function discover(requestedUri) {
  const challenge = await fetch(requestedUri);
  if (challenge.status !== 401) throw new AgentError(`Discovery: expected 401 from ${requestedUri}, got ${challenge.status}`);
  const params = authParams(challenge.headers.get('WWW-Authenticate'));
  const metadataUrl = params.resource_metadata;
  if (!metadataUrl) throw new AgentError('Discovery: the 401 names no resource_metadata');
  // Check 1: the metadata URL has the requested URI's scheme and authority.
  if (!sameOrigin(metadataUrl, requestedUri)) throw new AgentError('Discovery: resource_metadata is on another origin');
  const storage = parseLinks(challenge.headers.get('Link')).find(link => link.rel.includes(STORAGE_REL))?.href;
  if (!storage) throw new AgentError('Discovery: the 401 has no storage Link');

  const { body: metadata } = await fetchJson(metadataUrl, {}, 'protected resource metadata');
  // Check 2: the metadata describes exactly the requested URI (RFC 9728 3.3).
  if (metadata?.resource !== requestedUri) throw new AgentError(`Discovery: metadata resource ${metadata?.resource} is not ${requestedUri}`);
  const issuer = metadata.authorization_servers?.[0];
  if (typeof issuer !== 'string') throw new AgentError('Discovery: no authorization_servers');

  // Check 3: the storage's StorageRoot is on the requested URI's origin.
  const { endpoint: root } = await storageService(storage, 'StorageRoot');
  if (!sameOrigin(root, requestedUri)) throw new AgentError('Discovery: the StorageRoot is on another origin');

  // RFC 8414 3: the well-known path goes between the host and the issuer's path; 3.3: issuer must match.
  const issuerUrl = new URL(issuer);
  if (issuerUrl.protocol !== 'https:' && issuerUrl.hostname !== 'localhost') throw new AgentError('Discovery: the issuer is not https');
  const configUrl = `${issuerUrl.origin}/.well-known/lws-configuration${issuerUrl.pathname === '/' ? '' : issuerUrl.pathname}`;
  const { body: config } = await fetchJson(configUrl, {}, 'authorization server metadata');
  if (config?.issuer !== issuer) throw new AgentError(`Discovery: metadata issuer ${config?.issuer} is not ${issuer}`);
  if (!config.token_endpoint) throw new AgentError('Discovery: no token_endpoint');
  if (config.grant_types_supported && !config.grant_types_supported.includes(TOKEN_EXCHANGE)) throw new AgentError('Discovery: no token exchange');
  if (config.subject_token_types_supported && !config.subject_token_types_supported.includes(JWT_TYPE)) throw new AgentError('Discovery: JWT subject tokens are not supported');
  return { storage, issuer, tokenEndpoint: config.token_endpoint, metadataUrl };
}

/** RFC 8693 token exchange; returns the response body, or throws with the OAuth error. */
export async function exchange(tokenEndpoint, subjectToken, resource) {
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: TOKEN_EXCHANGE, subject_token: subjectToken, subject_token_type: JWT_TYPE, resource }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new AgentError(`Token exchange: ${response.status} ${body.error ?? ''}${body.error_description ? `: ${body.error_description}` : ''}`);
  return body;
}

// --- commands --------------------------------------------------------------------

export async function keygen(statePath, { force = false } = {}) {
  if (!force) {
    try { await readFile(statePath); throw new AgentError(`${statePath} exists; pass --force to replace it`); } catch (error) { if (error instanceof AgentError) throw error; }
  }
  const key = await newKey();
  await saveState(statePath, { key });
  return { didKey: key.didKey, fingerprint: keyFingerprint(key.didKey), state: statePath };
}

export async function request(statePath, storageUrl, { name, actions }) {
  const state = await loadState(statePath);
  const storage = storageUrl.replace(/\/+$/, '');
  const { endpoint } = await storageService(storage, 'AccessRequestService');
  if (!sameOrigin(endpoint, storage)) throw new AgentError('The AccessRequestService is on another origin than the storage');
  const body = {
    '@context': [LWS_CONTEXT],
    type: ['AccessRequest'],
    storage,
    ...(name ? { name } : {}),
    access: [{ type: ['AccessPolicy'], action: actions, assignee: state.key.didKey, target: { type: 'StorageResource', value: [`${storage}/`] } }],
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/lws+json', Authorization: `Bearer ${await didKeyJwt(state.key, endpoint)}` },
    body: JSON.stringify(body),
  });
  const document = await response.json().catch(() => ({}));
  if (response.status !== 201 && response.status !== 200) throw new AgentError(`Access request: ${response.status} ${document.detail ?? document.title ?? ''}`);
  const location = new URL(response.headers.get('Location'), endpoint).href;
  await saveState(statePath, { ...state, storage, requestsEndpoint: endpoint, requestUrl: location, grant: undefined, token: undefined });
  // The owner checks this against the fingerprint the app shows before approving.
  return { status: response.status, requestUrl: location, request: document.status, fingerprint: keyFingerprint(state.key.didKey) };
}

export async function status(statePath) {
  const state = await loadState(statePath);
  if (!state.requestUrl) throw new AgentError('No request yet: run request first');
  const { body } = await fetchJson(state.requestUrl, { headers: { Authorization: `Bearer ${await didKeyJwt(state.key, state.requestUrl)}` } }, 'access request');
  const grant = body.status === 'approved' && body.verificationMethod
    ? { verificationMethod: body.verificationMethod, did: body.verificationMethod.split('#')[0], actions: body.grant?.access?.[0]?.action ?? [] }
    : undefined;
  await saveState(statePath, { ...state, grant, ...(grant ? {} : { token: undefined }) });
  return { status: body.status, ...(grant ?? {}) };
}

export async function token(statePath) {
  let state = await loadState(statePath);
  if (!state.grant) { await status(statePath); state = await loadState(statePath); }
  if (!state.grant) throw new AgentError('The request is not approved');
  const found = await discover(`${state.storage}/`);
  if (found.storage !== state.storage) throw new AgentError(`Discovery named storage ${found.storage}, not ${state.storage}`);
  const jwt = await agentJwt(state.key, state.grant.verificationMethod, found.issuer);
  const result = await exchange(found.tokenEndpoint, jwt, found.storage);
  const cached = { accessToken: result.access_token, scope: result.scope, storage: found.storage, expiresAt: Date.now() + result.expires_in * 1000 };
  await saveState(statePath, { ...state, discovery: found, token: cached });
  return { scope: cached.scope, expiresAt: new Date(cached.expiresAt).toISOString(), tokenEndpoint: found.tokenEndpoint };
}

/** Whether a cached token is missing, expired, or about to expire. */
export const tokenNeedsRefresh = (cached, now = Date.now()) => !cached?.accessToken || cached.expiresAt - TOKEN_MARGIN_MS < now;

/** A cached access token with some life left, else a new one; `fresh` always gets a new one. */
async function accessToken(statePath, { fresh = false } = {}) {
  let state = await loadState(statePath);
  if (fresh || tokenNeedsRefresh(state.token)) { await token(statePath); state = await loadState(statePath); }
  return state.token.accessToken;
}

/**
 * `init` with the access token, sent once; on a 401 invalid_token (it expired
 * or was cut short since it was cached) a new token is fetched and the
 * request sent again, once.
 */
export async function authorizedSend(statePath, url, init = {}, { sendFn = send, getToken = accessToken } = {}) {
  const attempt = async (fresh) => sendFn(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await getToken(statePath, { fresh })}` } });
  const first = await attempt(false);
  if (first.status !== 401 || authParams(first.headers['www-authenticate']).error !== 'invalid_token') return first;
  return attempt(true);
}

const HEADERS = ['etag', 'last-modified', 'location', 'content-type', 'link', 'allow', 'www-authenticate'];
async function send(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { status: response.status, headers: Object.fromEntries(HEADERS.filter(h => response.headers.has(h)).map(h => [h, response.headers.get(h)])), body };
}

export async function get(statePath, url) {
  return authorizedSend(statePath, url);
}

export async function create(statePath, containerUrl, json) {
  return authorizedSend(statePath, containerUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json });
}

/** PATCH: merge-patch for an object, JSON Patch for an array; If-Match from a fresh HEAD unless `etag` is given. */
export async function patch(statePath, url, json, { etag } = {}) {
  const ifMatch = etag ?? (await authorizedSend(statePath, url, { method: 'HEAD' })).headers.etag;
  if (!ifMatch) throw new AgentError(`No ETag for ${url}`);
  const type = Array.isArray(JSON.parse(json)) ? 'application/json-patch+json' : 'application/merge-patch+json';
  return authorizedSend(statePath, url, { method: 'PATCH', headers: { 'Content-Type': type, 'If-Match': ifMatch }, body: json });
}

export async function remove(statePath, url, { etag } = {}) {
  return authorizedSend(statePath, url, { method: 'DELETE', headers: { ...(etag ? { 'If-Match': etag } : {}) } });
}

// --- CLI ---------------------------------------------------------------------------

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const name = argv[i].slice(2);
      if (name === 'force') flags.force = true;
      else flags[name] = argv[++i];
    } else positional.push(argv[i]);
  }
  return { positional, flags };
}

const USAGE = `usage: lws-agent.mjs <keygen|request|status|token|get|create|patch|delete> … --state <file>
  keygen [--force]
  request <storageUrl> [--name <label>] [--actions read,create,update,delete]
  status | token
  get <url> | create <containerUrl> <json> | patch <url> <json> [--etag <etag>] | delete <url> [--etag <etag>]`;

export async function main(argv) {
  const { positional: [command, ...rest], flags } = parseArgs(argv);
  const statePath = flags.state;
  if (!command || !statePath) throw new AgentError(USAGE);
  const need = (n) => { if (rest.length < n) throw new AgentError(USAGE); };
  switch (command) {
    case 'keygen': return keygen(statePath, { force: flags.force });
    case 'request': need(1); return request(statePath, rest[0], { name: flags.name, actions: (flags.actions ?? 'read').split(',').map(s => s.trim()).filter(Boolean) });
    case 'status': return status(statePath);
    case 'token': return token(statePath);
    case 'get': need(1); return get(statePath, rest[0]);
    case 'create': need(2); return create(statePath, rest[0], rest[1]);
    case 'patch': need(2); return patch(statePath, rest[0], rest[1], { etag: flags.etag });
    case 'delete': need(1); return remove(statePath, rest[0], { etag: flags.etag });
    default: throw new AgentError(USAGE);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (result) => { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); },
    (error) => { process.stderr.write(`${error instanceof AgentError ? error.message : error.stack}\n`); process.exit(1); },
  );
}
