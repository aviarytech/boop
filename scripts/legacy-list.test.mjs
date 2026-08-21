import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/legacy-list-test";

async function load(entry, name) {
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: [entry],
    outfile: `${outdir}/${name}.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
  });
  return import(`${pathToFileURL(`${process.cwd()}/${outdir}/${name}.mjs`).href}?t=${Date.now()}`);
}

await rm(outdir, { recursive: true, force: true });
const legacy = await load("convex/lib/legacyList.ts", "legacyList");

const envelopeSealedAt = (iso) =>
  JSON.stringify({ eventLog: { events: [{ type: "create", proof: [{ created: iso }] }] } });

test("reads the genesis proof timestamp", () => {
  assert.equal(
    legacy.genesisSealedAt(envelopeSealedAt("2026-02-01T00:00:00.000Z")),
    Date.parse("2026-02-01T00:00:00.000Z")
  );
});

test("a log it cannot read is unknown, not zero", () => {
  // Returning 0 would make every unreadable log look ancient and therefore
  // legacy, which is the wrong default — it pushes owners into needless copies.
  assert.equal(legacy.genesisSealedAt("not json"), null);
  assert.equal(legacy.genesisSealedAt(JSON.stringify({ eventLog: { events: [] } })), null);
  assert.equal(legacy.genesisSealedAt(JSON.stringify({})), null);
});

test("accepts a bare proof object as well as an array", () => {
  const bare = JSON.stringify({
    eventLog: { events: [{ proof: { created: "2026-02-01T00:00:00.000Z" } }] },
  });
  assert.equal(legacy.genesisSealedAt(bare), Date.parse("2026-02-01T00:00:00.000Z"));
});

test("a client mint is not legacy; a migration re-mint is", () => {
  const created = Date.parse("2026-02-01T00:00:00.000Z");
  // Signed two seconds after the list existed — a browser mint.
  assert.equal(legacy.isLegacyGenesis(created + 2_000, created), false);
  // Signed six months later — the celAssetDids migration.
  assert.equal(legacy.isLegacyGenesis(Date.parse("2026-07-29T00:00:00.000Z"), created), true);
});

test("unknown sealing time is never reported as legacy", () => {
  assert.equal(legacy.isLegacyGenesis(null, Date.parse("2026-02-01T00:00:00.000Z")), false);
});

test("the client and server thresholds agree", async () => {
  // Convex modules cannot import from src/, so the rule is written twice. If
  // they drift, the list index and the provenance panel disagree about the same
  // list — which is worse than either answer alone.
  const clientSrc = await readFile("src/lib/originals.ts", "utf8");
  const match = clientSrc.match(/RETROACTIVE_GENESIS_MS\s*=\s*([0-9_]+)/);
  assert.ok(match, "src/lib/originals.ts no longer defines RETROACTIVE_GENESIS_MS");
  assert.equal(Number(match[1].replace(/_/g, "")), legacy.RETROACTIVE_GENESIS_MS);
});

test("a real 2.1.0-sealed envelope is readable", async () => {
  const fixture = await readFile("scripts/fixtures/cel-envelope-sdk-2.1.0.json", "utf8");
  const sealedAt = legacy.genesisSealedAt(fixture);
  assert.ok(sealedAt !== null, "must parse a genuine envelope, not just synthetic ones");
  // Sealed long after a list created in early 2026 would have been.
  assert.equal(legacy.isLegacyGenesis(sealedAt, Date.parse("2026-01-01T00:00:00.000Z")), true);
});
