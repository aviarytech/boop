// THROWAWAY spike code (#286, plans/pws-spike-findings.md). Never merged.
//
// Shared fixtures: a user did:webvh shaped like boop's author DID, an agent
// did:key, a Turnkey-shaped signing backend backed by local keys, and the
// offline document loader the zcap libraries need.
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { extendDocumentLoader } from "@interop/zcap";

ed.hashes.sha512 ??= sha512;

export const ZCAP_CONTEXT_URL = "https://w3id.org/zcap/v1";
export const DID_CONTEXT_V1 = "https://www.w3.org/ns/did/v1";

export const multikey = publicKey => `z${base58.encode(Uint8Array.from([0xed, 0x01, ...publicKey]))}`;
export const multikeyBytes = mk => base58.decode(mk.slice(1)).slice(2);

export function newKey() {
  const secretKey = ed.utils.randomSecretKey();
  const publicKey = ed.getPublicKey(secretKey);
  return { secretKey, publicKey, multikey: multikey(publicKey) };
}

/** did:key document for an Ed25519 Multikey, as the did:key method derives it. */
export function didKeyDocument(did) {
  const mk = did.slice("did:key:".length);
  const vm = `${did}#${mk}`;
  return {
    "@context": [DID_CONTEXT_V1, "https://w3id.org/security/multikey/v1"],
    id: did,
    verificationMethod: [{ id: vm, type: "Multikey", controller: did, publicKeyMultibase: mk }],
    authentication: [vm], assertionMethod: [vm], capabilityInvocation: [vm], capabilityDelegation: [vm],
  };
}

/**
 * Stand-in for a live Turnkey session, with the exact shape of
 * `AuthorKeyBackend.sign` in src/lib/authorDid.ts: Ed25519 over exactly the
 * given bytes, no hashing, addressed by sub-org and account address. The keys
 * are local here; in the app they live in the user's Turnkey sub-org.
 */
export function localTurnkeyBackend(accounts) {
  const calls = [];
  return {
    calls,
    async sign(subOrgId, address, message) {
      const account = accounts.find(a => a.address === address);
      if (!account) throw new Error(`no account ${address} in ${subOrgId}`);
      calls.push({ subOrgId, address, message: Uint8Array.from(message) });
      return ed.sign(message, account.secretKey);
    },
  };
}

/**
 * The signer interface jsonld-signatures / ezcap want: `{ id, sign({data}) }`.
 * `signBytes` is the same callback `remoteKeySigner` takes in
 * src/lib/originalsSigning.ts (there it is `signChecked(backend, subOrgId, keys.assertion, message)`).
 */
export function remoteZcapSigner({ verificationMethod, signBytes }) {
  return {
    id: verificationMethod,
    algorithm: "Ed25519",
    async sign({ data }) {
      const signature = await signBytes(data);
      if (signature.length !== 64) throw new Error("Ed25519 signature must be 64 bytes");
      return signature;
    },
  };
}

/**
 * Offline document loader over a fixed set of DID documents. did:key documents
 * are derived; every other DID must be supplied. A DID URL with a fragment
 * resolves to that verification method (with `@context`, as the suites expect).
 */
const RELATIONSHIPS = ["authentication", "assertionMethod", "capabilityInvocation", "capabilityDelegation", "keyAgreement"];

/**
 * did:webvh documents written by didwebvh-ts name their keys relatively
 * (`#orig-1`). jsonld-signatures compares a proof's absolute verification
 * method id with the controller document's relationship entries as plain
 * strings, so the document has to be made absolute before it is handed over.
 */
export function absolutizeDidDocument(document) {
  const did = document.id;
  const abs = ref => (typeof ref === "string" && ref.startsWith("#") ? `${did}${ref}` : ref);
  const out = { ...document };
  if (out.verificationMethod) out.verificationMethod = out.verificationMethod.map(vm => ({ ...vm, id: abs(vm.id) }));
  for (const rel of RELATIONSHIPS) if (out[rel]) out[rel] = out[rel].map(abs);
  return out;
}

export function staticDidLoader(documents, roots = {}, { absolutize = true } = {}) {
  return extendDocumentLoader(async url => {
    if (roots[url]) return { contextUrl: null, documentUrl: url, document: roots[url] };
    const [did, fragment] = url.split("#");
    let document = did.startsWith("did:key:") ? didKeyDocument(did) : documents[did];
    if (!document) throw new Error(`document loader: ${url} is not available offline`);
    if (absolutize) document = absolutizeDidDocument(document);
    if (fragment === undefined) return { contextUrl: null, documentUrl: url, document };
    const method = (document.verificationMethod ?? []).find(vm => (vm.id.startsWith("#") ? `${did}${vm.id}` : vm.id) === url);
    if (!method) throw new Error(`document loader: no verification method ${url}`);
    return { contextUrl: null, documentUrl: url, document: { "@context": document["@context"], ...method, id: url } };
  });
}

export const rootZcapId = target => `urn:zcap:root:${encodeURIComponent(target)}`;
export const rootZcap = (target, controller) => ({ "@context": ZCAP_CONTEXT_URL, id: rootZcapId(target), invocationTarget: target, controller });
