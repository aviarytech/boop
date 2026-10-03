import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { ed25519 } from "@noble/curves/ed25519.js";

const outdir = "tmp/originals-test";

async function loadModules() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  for (const name of ["originals", "originalsSigner"]) {
    await build({
      entryPoints: [`src/lib/${name}.ts`],
      outfile: `${outdir}/${name}.mjs`,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      // jsonld/rdf-canonize are CJS and call require() at load; esm output needs a real require.
      banner: {
        js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
      },
    });
  }
  return {
    originals: await import(pathToFileURL(`${process.cwd()}/${outdir}/originals.mjs`).href),
    signer: await import(pathToFileURL(`${process.cwd()}/${outdir}/originalsSigner.mjs`).href),
  };
}

const { originals, signer } = await loadModules();

/** Stands in for a Turnkey session; the seam is identical either way. */
function localSigner() {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    publicKeyMultibase: signer.multikeyFromEd25519PublicKey(publicKey),
    async signBytes(bytes) {
      return ed25519.sign(bytes, privateKey);
    },
  };
}

const OWNER = "did:webvh:example:alice";

test("a list asset is a verifiable did:cel", async () => {
  const raw = localSigner();
  const list = await originals.createListAsset("Groceries", OWNER, raw);

  assert.match(list.assetDid, /^did:cel:/);
  assert.equal(list.name, "Groceries");
  assert.equal(list.createdBy, OWNER);
  assert.ok(!Number.isNaN(Date.parse(list.createdAt)));

  const verification = await originals.verifyAssetLog(list.eventLog);
  assert.equal(verification.verified, true, verification.errors.join("; "));
  assert.equal(verification.assetDid, list.assetDid, "the log must back the DID it claims");
});

test("each list gets its own DID under one signer", async () => {
  const raw = localSigner();
  const first = await originals.createListAsset("Groceries", OWNER, raw);
  const second = await originals.createListAsset("Groceries", OWNER, raw);

  assert.notEqual(first.assetDid, second.assetDid);
});

test("appending an event keeps the log verifiable and the DID stable", async () => {
  const raw = localSigner();
  const list = await originals.createListAsset("Groceries", OWNER, raw);

  const appended = await originals.appendAssetEvent(
    list.eventLog,
    { action: "added", itemId: "item-1", itemName: "Milk" },
    raw
  );

  assert.equal(JSON.parse(appended).events.length, 2);
  const verification = await originals.verifyAssetLog(appended);
  assert.equal(verification.verified, true, verification.errors.join("; "));
  assert.equal(verification.assetDid, list.assetDid, "appending must not change identity");
});

test("a tampered log fails closed", async () => {
  const raw = localSigner();
  const list = await originals.createListAsset("Groceries", OWNER, raw);

  const log = JSON.parse(list.eventLog);
  log.events[0].data.name = "Someone else's list";

  const verification = await originals.verifyAssetLog(JSON.stringify(log));
  assert.equal(verification.verified, false, "tampered genesis must not verify");
});

test("garbage in a stored log is reported, not thrown", async () => {
  const verification = await originals.verifyAssetLog("not json at all");
  assert.equal(verification.verified, false);
  assert.ok(verification.errors.length > 0, "malformed input should report, not throw");
});

test("pre-Turnkey AssetEnvelopes stay readable", async () => {
  // Lists created before this migration stored an AssetEnvelope, which embeds
  // the event log verbatim. They stay readable and verifiable — just not
  // authorable, since their genesis key lived in one device's localStorage.
  const raw = localSigner();
  const list = await originals.createListAsset("Groceries", OWNER, raw);

  const legacyEnvelope = JSON.stringify({
    format: "originals/asset",
    version: 1,
    assetDid: list.assetDid,
    eventLog: JSON.parse(list.eventLog),
    didDocuments: {},
    resources: [],
  });

  const verification = await originals.verifyAssetLog(legacyEnvelope);
  assert.equal(verification.verified, true, verification.errors.join("; "));
  assert.equal(verification.assetDid, list.assetDid);
});
