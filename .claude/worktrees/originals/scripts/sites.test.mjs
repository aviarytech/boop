import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/sites-test";

async function loadSitesModule() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["src/lib/sites.ts"],
    outfile: `${outdir}/sites.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
  });
  return import(pathToFileURL(`${process.cwd()}/${outdir}/sites.mjs`).href);
}

const sites = await loadSitesModule();

{
  const hostname = sites.buildBoopHostname("brisk", "paper", 7, "boop.ad");
  assert.equal(hostname, "brisk-paper-07.boop.ad");
}

{
  const hostname = sites.buildBoopHostname("tiny", "paper", 0, "https://trypoo.app");
  assert.equal(hostname, "tiny-paper-00.trypoo.app");
}

{
  let calls = 0;
  const hostname = await sites.generateMemorableHostname({
    baseDomain: "boop.ad",
    isAvailable: async (candidate) => {
      calls += 1;
      return candidate !== "brisk-paper-07.boop.ad";
    },
    randomInt: () => (calls === 0 ? 7 : 8),
    pickAdjective: () => "brisk",
    pickNoun: () => "paper",
    maxAttempts: 2,
  });
  assert.equal(hostname, "brisk-paper-08.boop.ad");
  assert.equal(calls, 2);
}

{
  assert.throws(
    () => sites.validateHtmlPayload("   "),
    /drop a little HTML first/i
  );
  assert.equal(sites.validateHtmlPayload("<h1>Hello</h1>"), "<h1>Hello</h1>");
}

{
  const digest = await sites.sha256Hex("hello");
  assert.equal(
    digest,
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
  );
}

await rm(outdir, { recursive: true, force: true });
console.log("sites helper tests passed");
