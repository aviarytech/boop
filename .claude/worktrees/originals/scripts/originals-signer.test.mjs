import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { ed25519 } from "@noble/curves/ed25519.js";
import { OriginalsCel } from "@originals/sdk";

const outdir = "tmp/originals-signer-test";

/**
 * Exercises the real signer seam: the proofs it builds are handed to the SDK's
 * own verifier, so a wrong preimage, encoding, or verificationMethod fails here
 * exactly as it would against a live Turnkey key.
 */
async function loadSigner() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["src/lib/originalsSigner.ts"],
    outfile: `${outdir}/originalsSigner.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
  });
  return import(pathToFileURL(`${process.cwd()}/${outdir}/originalsSigner.mjs`).href);
}

const signerLib = await loadSigner();

/** Stands in for Turnkey: same interface, but the key is local so tests stay offline. */
function localSigner() {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    publicKeyMultibase: signerLib.multikeyFromEd25519PublicKey(publicKey),
    async signBytes(bytes) {
      return ed25519.sign(bytes, privateKey);
    },
  };
}

function celFor(raw) {
  return new OriginalsCel({
    layer: "peer",
    signer: signerLib.createCelSigner(raw),
    config: { peer: { verificationMethod: signerLib.verificationMethodId(raw) } },
  });
}

test("multikeyFromEd25519PublicKey produces a z-prefixed Ed25519 Multikey", () => {
  const publicKey = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
  const multikey = signerLib.multikeyFromEd25519PublicKey(publicKey);

  assert.match(multikey, /^z6Mk/, "Ed25519 Multikey is base58btc with the 0xed01 multicodec header");
  assert.throws(
    () => signerLib.multikeyFromEd25519PublicKey(publicKey.slice(0, 31)),
    /32 bytes/,
    "a short key must be rejected, not silently encoded"
  );
});

test("turnkeyAddressToMultikey converts a Solana-format address to a Multikey", () => {
  // Turnkey creates CURVE_ED25519 accounts with ADDRESS_FORMAT_SOLANA, whose
  // address is the base58 raw public key — NOT the Multikey a DID needs.
  const publicKey = ed25519.getPublicKey(ed25519.utils.randomSecretKey());
  const solanaAddress = signerLib.base58Encode(publicKey);

  assert.equal(
    signerLib.turnkeyAddressToMultikey(solanaAddress),
    signerLib.multikeyFromEd25519PublicKey(publicKey),
    "the address decodes to the same key the Multikey encodes"
  );
  assert.doesNotMatch(solanaAddress, /^z6Mk/, "a raw Solana address is not already a Multikey");
  assert.throws(() => signerLib.turnkeyAddressToMultikey("not!base58"), /base58/i);
});

test("controllerDid and verificationMethodId follow did:key conventions", () => {
  const raw = localSigner();

  assert.equal(signerLib.controllerDid(raw), `did:key:${raw.publicKeyMultibase}`);
  assert.equal(
    signerLib.verificationMethodId(raw),
    `did:key:${raw.publicKeyMultibase}#${raw.publicKeyMultibase}`,
    "CEL expects the canonical did:key VM form `<did>#<key>`"
  );
});

test("normalizeTurnkeySignature trims the recovery byte and rejects bad lengths", () => {
  const sig = new Uint8Array(64).fill(7);
  const hex = Buffer.from(sig).toString("hex");

  assert.deepEqual(signerLib.normalizeTurnkeySignature(hex), sig, "64 bytes passes through");
  assert.deepEqual(
    signerLib.normalizeTurnkeySignature(`0x${hex}`),
    sig,
    "a 0x prefix is stripped"
  );
  assert.deepEqual(
    signerLib.normalizeTurnkeySignature(hex + "01"),
    sig,
    "65 bytes drops the trailing recovery byte"
  );
  assert.throws(() => signerLib.normalizeTurnkeySignature(hex.slice(0, 100)), /signature length/i);
});

test("createCelSigner builds an eddsa-jcs-2022 DataIntegrityProof", async () => {
  const raw = localSigner();
  const proof = await signerLib.createCelSigner(raw)({ hello: "world" });

  assert.equal(proof.type, "DataIntegrityProof");
  assert.equal(proof.cryptosuite, "eddsa-jcs-2022");
  assert.equal(proof.proofPurpose, "assertionMethod");
  assert.equal(proof.verificationMethod, signerLib.verificationMethodId(raw));
  assert.match(proof.proofValue, /^z/, "proofValue is base58btc multibase");
  assert.ok(!Number.isNaN(Date.parse(proof.created)), "created is an ISO timestamp");
});

test("a genesis event signed through the seam verifies in the SDK", async () => {
  const raw = localSigner();
  const { log, did } = await celFor(raw).create("Groceries", []);

  assert.match(did, /^did:cel:/);
  const result = await celFor(raw).verify(log);
  assert.equal(result.verified, true, `genesis must verify: ${JSON.stringify(result.errors)}`);
});

test("appended update events verify — the log stays authorable", async () => {
  const raw = localSigner();
  const cel = celFor(raw);

  const { log } = await cel.create("Groceries", []);
  const afterAdd = await cel.update(log, { action: "item:added", itemDid: "did:cel:zItem" });
  const afterRename = await cel.update(afterAdd, { action: "renamed", name: "Weekly shop" });

  assert.equal(afterRename.events.length, 3, "create + two updates");
  const result = await cel.verify(afterRename);
  assert.equal(result.verified, true, `appends must verify: ${JSON.stringify(result.errors)}`);
});

test("one signer controls many assets with distinct DIDs", async () => {
  // did:cel derives from the genesis event, not the key — this is what makes
  // items-as-assets affordable on a single Turnkey account.
  const raw = localSigner();
  const cel = celFor(raw);

  const a = await cel.create("Milk", []);
  const b = await cel.create("Milk", []);

  assert.notEqual(a.did, b.did, "the genesis nonce keeps identical names distinct");
  assert.equal((await cel.verify(a.log)).verified, true);
  assert.equal((await cel.verify(b.log)).verified, true);
});

test("a foreign signer cannot append to someone else's asset", async () => {
  // The single-writer constraint that forces collaborator actions to be
  // credentials rather than log events. If this ever passes, revisit the spec.
  const owner = localSigner();
  const collaborator = localSigner();

  const { log } = await celFor(owner).create("Groceries", []);
  const tampered = await celFor(collaborator).update(log, { action: "item:checked" });

  const result = await celFor(owner).verify(tampered);
  assert.equal(result.verified, false, "an append by a non-controller must not verify");
});

test("a signer that signs the wrong bytes fails verification", async () => {
  const raw = localSigner();
  const liar = {
    publicKeyMultibase: raw.publicKeyMultibase,
    async signBytes() {
      return ed25519.sign(new TextEncoder().encode("something else"), ed25519.utils.randomSecretKey());
    },
  };

  const cel = new OriginalsCel({
    layer: "peer",
    signer: signerLib.createCelSigner(liar),
    config: { peer: { verificationMethod: signerLib.verificationMethodId(liar) } },
  });

  const { log } = await cel.create("Groceries", []);
  assert.equal((await cel.verify(log)).verified, false, "a bogus signature must fail closed");
});

test("createWebVHSigner exposes the didwebvh-ts ExternalSigner shape", async () => {
  const raw = localSigner();
  const signer = signerLib.createWebVHSigner(raw);

  assert.equal(
    signer.getVerificationMethodId(),
    `did:key:${raw.publicKeyMultibase}`,
    "didwebvh-ts identifies the signer by its did:key, without the fragment"
  );

  const { proofValue } = await signer.sign({
    document: { id: "did:webvh:example" },
    proof: { type: "DataIntegrityProof" },
  });
  assert.match(proofValue, /^z/, "proofValue is base58btc multibase");

  // The signer must verify its own output, or didwebvh-ts rejects the log it mints.
  const message = new TextEncoder().encode("round trip");
  const signature = await raw.signBytes(message);
  const publicKey = signerLib.decodeMultikey(raw.publicKeyMultibase);
  assert.equal(await signer.verify(signature, message, publicKey), true);
});
