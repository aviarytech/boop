import assert from "node:assert/strict";
import { sha512 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";
import * as ed25519 from "@noble/ed25519";
import {
  createDID,
  updateDID,
  resolveDIDFromLog,
  MultibaseEncoding,
  multibaseEncode,
  prepareDataForSigning,
} from "didwebvh-ts";

function configureEd25519() {
  const sha512Fn = (...messages) => sha512(concatBytes(...messages));
  if (ed25519.utils) {
    ed25519.utils.sha512Sync = sha512Fn;
  }
  if (ed25519.etc) {
    ed25519.etc.sha512Sync = sha512Fn;
  }
}

function makeKeypair() {
  const privateKey = ed25519.utils.randomPrivateKey();
  return { privateKey };
}

async function publicKeyMultibaseFor(privateKey) {
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  const prefixed = new Uint8Array(2 + publicKey.length);
  prefixed.set([0xed, 0x01], 0);
  prefixed.set(publicKey, 2);
  return multibaseEncode(prefixed, MultibaseEncoding.BASE58_BTC);
}

class ProofSigner {
  constructor(privateKey, publicKeyMultibase) {
    this.privateKey = privateKey;
    this.publicKeyMultibase = publicKeyMultibase;
  }

  getVerificationMethodId() {
    return `did:key:${this.publicKeyMultibase}`;
  }

  async sign(input) {
    const payload = await prepareDataForSigning(input.document, input.proof);
    const signature = await ed25519.signAsync(payload, this.privateKey);
    return {
      proofValue: multibaseEncode(signature, MultibaseEncoding.BASE58_BTC),
    };
  }

  async verify(signature, message, publicKey) {
    const key = publicKey.length === 33 ? publicKey.slice(1) : publicKey;
    return ed25519.verifyAsync(signature, message, key);
  }
}

function serializeLog(log) {
  return log.map((entry) => JSON.stringify(entry)).join("\n");
}

configureEd25519();

const { privateKey } = makeKeypair();
const publicKeyMultibase = await publicKeyMultibaseFor(privateKey);
const signer = new ProofSigner(privateKey, publicKeyMultibase);
const verificationMethodId = signer.getVerificationMethodId();

const verificationMethods = [
  {
    id: "#key-0",
    type: "Multikey",
    controller: "",
    publicKeyMultibase,
  },
];

const genesis = await createDID({
  domain: "brisk-paper-07.boop.ad",
  signer,
  verifier: signer,
  updateKeys: [verificationMethodId],
  verificationMethods,
  portable: true,
  authentication: ["#key-0"],
  assertionMethod: ["#key-0"],
});

assert.equal(genesis.log[0].parameters.portable, true);
const initialScid = genesis.log[0].parameters.scid;
assert.ok(initialScid, "genesis log should include a SCID");
const migratedDid = `did:webvh:${initialScid}:www.forexample.com`;

const migrated = await updateDID({
  log: genesis.log,
  signer,
  verifier: signer,
  domain: "www.forexample.com",
  controller: migratedDid,
  updateKeys: [verificationMethodId],
  verificationMethods,
  portable: true,
  authentication: ["#key-0"],
  assertionMethod: ["#key-0"],
  witnessProofs: [],
});

assert.equal(migrated.log[0].parameters.scid, initialScid);
assert.equal(migrated.log.at(-1).parameters.scid, undefined);
assert.equal(migrated.did, migratedDid);

const resolved = await resolveDIDFromLog(migrated.log, {
  verifier: signer,
  witnessProofs: [],
});
assert.equal(resolved.meta.scid, initialScid);
assert.equal(resolved.doc.id, migrated.did);

console.log(
  JSON.stringify(
    {
      initialDid: genesis.did,
      migratedDid: migrated.did,
      scid: initialScid,
      entries: migrated.log.length,
      jsonlBytes: new TextEncoder().encode(serializeLog(migrated.log)).byteLength,
    },
    null,
    2
  )
);
