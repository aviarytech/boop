import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { ed25519 } from "@noble/curves/ed25519.js";

const outdir = "tmp/credentials-test";

/**
 * Real signatures over real credentials, verified by the SDK's own verifier —
 * these replace the unsigned `vcProofs` placeholders.
 */
async function loadModules() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  for (const name of ["credentials", "originalsSigner"]) {
    await build({
      entryPoints: [`src/lib/${name}.ts`],
      outfile: `${outdir}/${name}.mjs`,
      bundle: true, platform: "node", format: "esm", target: "node20",
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    });
  }
  return {
    credentials: await import(pathToFileURL(`${process.cwd()}/${outdir}/credentials.mjs`).href),
    signer: await import(pathToFileURL(`${process.cwd()}/${outdir}/originalsSigner.mjs`).href),
  };
}

const { credentials, signer } = await loadModules();

function localSigner() {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    publicKeyMultibase: signer.multikeyFromEd25519PublicKey(publicKey),
    async signBytes(bytes) { return ed25519.sign(bytes, privateKey); },
  };
}

const LIST_DID = "did:cel:zListXyz";

test("an item claim names the list as its subject and carries a real proof", async () => {
  const raw = localSigner();
  const actorDid = signer.controllerDid(raw);

  const claim = await credentials.issueItemClaim({
    listDid: LIST_DID, itemId: "item-1", action: "checked",
    itemName: "Milk", actorDid, signer: raw,
    issuedAt: "2026-01-15T12:00:00.000Z",
  });

  assert.ok(claim.proof, "an unsigned credential is the bug we are fixing");
  assert.equal(claim.issuer, actorDid);
  assert.equal(claim.credentialSubject.id, LIST_DID, "the list is the asset; the item is a claim on it");
  assert.equal(claim.credentialSubject.itemId, "item-1");
  assert.equal(claim.credentialSubject.action, "checked");
  assert.equal(await credentials.verifyCredential(claim), true);
});

test("tampering with a signed claim breaks verification", async () => {
  const raw = localSigner();
  const claim = await credentials.issueItemClaim({
    listDid: LIST_DID, itemId: "item-1", action: "checked",
    actorDid: signer.controllerDid(raw), signer: raw,
  });

  const forged = {
    ...claim,
    credentialSubject: { ...claim.credentialSubject, itemId: "item-99" },
  };
  assert.equal(await credentials.verifyCredential(forged), false);
});

test("a collaborator can claim against a list they do not control", async () => {
  const collaborator = localSigner();
  const claim = await credentials.issueItemClaim({
    listDid: LIST_DID, itemId: "item-1", action: "checked",
    actorDid: signer.controllerDid(collaborator), signer: collaborator,
  });

  assert.equal(await credentials.verifyCredential(claim), true);
  assert.equal(claim.issuer, signer.controllerDid(collaborator), "the claim stands on their own key");
});

test("an unknown action is refused rather than signed", async () => {
  const raw = localSigner();
  await assert.rejects(
    () => credentials.issueItemClaim({
      listDid: LIST_DID, itemId: "item-1", action: "promoted",
      actorDid: signer.controllerDid(raw), signer: raw,
    }),
    /unknown item action/i
  );
});

test("a future-dated credential does not verify", async () => {
  const raw = localSigner();
  const claim = await credentials.issueItemClaim({
    listDid: LIST_DID, itemId: "item-1", action: "checked",
    actorDid: signer.controllerDid(raw), signer: raw,
    issuedAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  assert.equal(await credentials.verifyCredential(claim), false);
});

test("claims get distinct ids", async () => {
  const raw = localSigner();
  const args = {
    listDid: LIST_DID, itemId: "item-1", action: "checked",
    actorDid: signer.controllerDid(raw), signer: raw,
  };
  const a = await credentials.issueItemClaim(args);
  const b = await credentials.issueItemClaim(args);

  assert.notEqual(a.id, b.id);
  assert.match(a.id, /^urn:uuid:/);
});
