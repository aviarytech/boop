// Fixtures for the #286 P3 service DID and receipt tests.
//
// TURNKEY IS MOCKED: `localBackend` stands in for the parent org's service
// wallet with local Ed25519 keys, and `mockTurnkey` for api.turnkey.com.
// Nothing here talks to Turnkey.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import * as ed25519 from '@noble/ed25519';
import { base58Encode } from '../../shared/actionRecord.ts';

const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

/** The service wallet with local keys: one per derivation path, signing exactly the bytes given. */
export function localBackend() {
  const secrets = new Map();
  const signed = [];
  const backend = {
    signed,
    secretAt: path => secrets.get(path),
    async keyAt(path) {
      if (!secrets.has(path)) secrets.set(path, ed25519.utils.randomSecretKey());
      return ed25519.getPublicKeyAsync(secrets.get(path));
    },
    async sign(publicKey, message) {
      for (const [path, secret] of secrets) {
        if (same(await ed25519.getPublicKeyAsync(secret), publicKey)) { signed.push(path); return ed25519.signAsync(message, secret); }
      }
      throw new Error('no such key');
    },
  };
  return backend;
}

export const hex = bytes => Buffer.from(bytes).toString('hex');

/** A P-256 API key pair in Turnkey's format: compressed public key and private scalar, hex. */
async function apiKeyPair() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const b64 = value => Buffer.from(value, 'base64url');
  return { apiPublicKey: (b64(jwk.y).at(-1) & 1 ? '03' : '02') + hex(b64(jwk.x)), apiPrivateKey: hex(b64(jwk.d)), publicKey: pair.publicKey };
}

/** Stands in for api.turnkey.com with one wallet of local Ed25519 keys in the parent org. */
export async function mockTurnkey({ organizationId = 'parent-org' } = {}) {
  const api = await apiKeyPair();
  const accounts = []; // { path, address, secret }
  const requests = [];
  let override = null;
  const addAccount = async path => {
    const secret = ed25519.utils.randomSecretKey();
    const address = base58Encode(await ed25519.getPublicKeyAsync(secret));
    accounts.push({ path, address, secret });
    return address;
  };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const stamp = JSON.parse(Buffer.from(init.headers['X-Stamp'], 'base64url').toString());
    requests.push({ url, body, stamp });
    assert.equal(stamp.publicKey, api.apiPublicKey);
    assert.equal(body.organizationId, organizationId);
    const done = result => Response.json({ activity: { status: 'ACTIVITY_STATUS_COMPLETED', result } });
    if (override) return override(url, body);
    const endpoint = new URL(url).pathname;
    if (endpoint === '/public/v1/submit/create_wallet') {
      const addresses = [];
      for (const a of body.parameters.accounts) addresses.push(await addAccount(a.path));
      return done({ createWalletResult: { walletId: 'wallet-service', addresses } });
    }
    if (endpoint === '/public/v1/query/list_wallet_accounts') {
      assert.equal(body.walletId, 'wallet-service');
      return Response.json({ accounts: accounts.map(({ path, address }) => ({ curve: 'CURVE_ED25519', path, address, addressFormat: 'ADDRESS_FORMAT_SOLANA' })) });
    }
    if (endpoint === '/public/v1/submit/create_wallet_accounts') {
      assert.equal(body.parameters.walletId, 'wallet-service');
      const addresses = [];
      for (const a of body.parameters.accounts) addresses.push(await addAccount(a.path));
      return done({ createWalletAccountsResult: { addresses } });
    }
    if (endpoint === '/public/v1/submit/sign_raw_payload') {
      const account = accounts.find(a => a.address === body.parameters.signWith);
      if (!account) return new Response('no such key', { status: 404 });
      const signature = hex(await ed25519.signAsync(Buffer.from(body.parameters.payload, 'hex'), account.secret));
      return done({ signRawPayloadResult: { r: signature.slice(0, 64), s: signature.slice(64), v: '00' } });
    }
    return new Response('unexpected', { status: 500 });
  };
  const credentials = { apiPublicKey: api.apiPublicKey, apiPrivateKey: api.apiPrivateKey, organizationId };
  return { credentials, fetchImpl, requests, accounts, respondWith: fn => { override = fn; } };
}
