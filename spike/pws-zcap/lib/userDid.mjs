// THROWAWAY spike code (#286). A user did:webvh minted the way
// src/lib/authorDid.ts mintAuthorDid does (two keys, #key-0 updates, #orig-1
// asserts), then updated so #orig-1 is also listed under capabilityDelegation,
// which is what PWS-AUTHZ 5.1 requires of a delegating key.
import { createDID, updateDID, resolveDIDFromLog, prepareDataForSigning, multibaseEncode, MultibaseEncoding } from "didwebvh-ts";
import * as ed from "@noble/ed25519";
import { newKey, localTurnkeyBackend } from "./common.mjs";

export const SUB_ORG = "spike-sub-org";

export async function mintUserDid({ domain = "spike.boop.test", path = "u-spike" } = {}) {
  const author = { ...newKey(), address: "author-address" };
  const assertion = { ...newKey(), address: "assertion-address" };
  const backend = localTurnkeyBackend([author, assertion]);

  // authorUpdateSigner in src/lib/authorDid.ts, with the backend above.
  const signer = {
    async sign(input) {
      const payload = await prepareDataForSigning(input.document, input.proof);
      return { proofValue: multibaseEncode(await backend.sign(SUB_ORG, author.address, payload), MultibaseEncoding.BASE58_BTC) };
    },
    getVerificationMethodId: () => `did:key:${author.multikey}`,
    verify: (signature, message, publicKey) => ed.verifyAsync(signature, message, publicKey.length === 33 ? publicKey.slice(1) : publicKey),
  };

  const controller = `did:webvh:{SCID}:${encodeURIComponent(domain)}:${path}`;
  const genesis = await createDID({
    domain, signer, verifier: signer, updateKeys: [author.multikey],
    verificationMethods: [
      { id: "#key-0", type: "Multikey", controller, publicKeyMultibase: author.multikey },
      { id: "#orig-1", type: "Multikey", controller, publicKeyMultibase: assertion.multikey },
    ],
    paths: [path], portable: false, authentication: ["#key-0"], assertionMethod: ["#orig-1"],
  });
  return { author, assertion, backend, signer, did: genesis.did, genesis };
}

/**
 * One more log entry that lists #orig-1 under capabilityDelegation as well as
 * assertionMethod. didwebvh-ts 2.8.0 `updateDID` has `authentication`,
 * `assertionMethod` and `keyAgreement` overrides but none for the capability
 * relationships; the only way in is a verification method's single-valued
 * `purpose`, with assertionMethod restored through its override.
 */
export async function addCapabilityDelegation(user) {
  const state = user.genesis.doc;
  const result = await updateDID({
    log: user.genesis.log, signer: user.signer, verifier: user.signer, updateKeys: [user.author.multikey],
    verificationMethods: state.verificationMethod.map(vm => (vm.id.endsWith("#orig-1") ? { ...vm, purpose: "capabilityDelegation" } : { ...vm })),
    authentication: state.authentication, assertionMethod: state.assertionMethod,
  });
  const resolved = await resolveDIDFromLog(result.log, { verifier: user.signer });
  return { log: result.log, doc: resolved.doc, versionId: resolved.meta.versionId, jsonl: result.log.map(e => JSON.stringify(e)).join("\n") };
}
