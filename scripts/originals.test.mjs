import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/originals-test";

async function loadOriginalsModule() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["src/lib/originals.ts"],
    outfile: `${outdir}/originals.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    // jsonld/rdf-canonize are CJS and call require() at load; esm output needs a real require.
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
  });
  return import(pathToFileURL(`${process.cwd()}/${outdir}/originals.mjs`).href);
}

const originals = await loadOriginalsModule();

// buildListResource: the genesis resource is content-addressed over the metadata
{
  const r = await originals.buildListResource("Groceries", "did:webvh:example:alice", "2026-07-27T00:00:00.000Z");
  assert.equal(r.contentType, "application/json");
  assert.match(r.hash, /^[0-9a-f]{64}$/, "hash should be lowercase hex sha-256");

  const same = await originals.buildListResource("Groceries", "did:webvh:example:alice", "2026-07-27T00:00:00.000Z");
  assert.equal(r.hash, same.hash, "same metadata should hash identically");

  const different = await originals.buildListResource("Chores", "did:webvh:example:alice", "2026-07-27T00:00:00.000Z");
  assert.notEqual(r.hash, different.hash, "different names should hash differently");

  // The hash must cover the content actually carried on the resource.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(r.content));
  const expected = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  assert.equal(r.hash, expected, "hash must be the sha-256 of resource.content");
}

// createListAsset: real did:cel genesis, no network
{
  const asset = await originals.createListAsset("Groceries", "did:webvh:example:alice");
  assert.match(asset.assetDid, /^did:cel:/, "genesis must produce a did:cel, not did:peer");
  assert.equal(asset.name, "Groceries");
  assert.equal(asset.createdBy, "did:webvh:example:alice");
  assert.ok(!Number.isNaN(Date.parse(asset.createdAt)), "createdAt should be an ISO timestamp");

  const second = await originals.createListAsset("Groceries", "did:webvh:example:alice");
  assert.notEqual(asset.assetDid, second.assetDid, "each list gets its own DID");

  // The envelope is what makes the DID more than an opaque string.
  const envelope = JSON.parse(asset.envelope);
  assert.equal(envelope.format, "originals/asset");
  assert.equal(envelope.assetDid, asset.assetDid, "envelope must describe this asset");
  assert.ok(envelope.eventLog, "envelope must carry the signed CEL log");
  assert.ok(envelope.didDocuments["did:cel"], "envelope must carry the did:cel document");
}

// verifyListEnvelope: a persisted envelope round-trips and verifies
{
  const asset = await originals.createListAsset("Chores", "did:webvh:example:alice");

  const ok = await originals.verifyListEnvelope(asset.envelope);
  assert.equal(ok.verified, true, `envelope should verify, got: ${ok.error ?? ""}`);
  assert.equal(ok.assetDid, asset.assetDid);
  assert.deepEqual(ok.warnings, []);

  // Tampering with the genesis resource must fail closed, not pass quietly.
  const tampered = JSON.parse(asset.envelope);
  tampered.resources[0].content = JSON.stringify({ name: "Not Chores" });
  const bad = await originals.verifyListEnvelope(JSON.stringify(tampered));
  assert.equal(bad.verified, false, "tampered resource content must not verify");

  // Garbage in must not throw at the call site.
  const garbage = await originals.verifyListEnvelope("not json");
  assert.equal(garbage.verified, false);
  assert.ok(garbage.error, "malformed input should report an error, not throw");
}

// --- envelopes sealed before the CEL cryptosuite rename still verify -------

// SDK 3.0 renamed the CEL cryptosuite to `originals-cel-ed25519-jcs-v1` and
// started signing the proof configuration. Logs sealed earlier cannot be
// re-signed, so `eddsa-jcs-2022` stays accepted on READ — every list already in
// the database depends on that. The fixture is a real envelope minted by SDK
// 2.1.0; if a future bump drops the legacy suite, this fails instead of every
// existing list silently going unverifiable.
{
  const { readFile } = await import("node:fs/promises");
  const legacy = await readFile("scripts/fixtures/cel-envelope-sdk-2.1.0.json", "utf8");

  assert.ok(
    legacy.includes('"cryptosuite":"eddsa-jcs-2022"'),
    "fixture must carry the pre-3.0 suite, else it proves nothing"
  );

  const result = await originals.verifyListEnvelope(legacy);
  assert.equal(
    result.verified,
    true,
    `2.x-sealed envelope must still verify, got: ${result.error ?? ""}`
  );
  assert.deepEqual(result.warnings, []);
}

console.log("originals helper tests passed");
