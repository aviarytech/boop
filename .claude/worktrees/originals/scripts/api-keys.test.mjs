import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/api-keys-test";

async function loadApiKeysModule() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["src/lib/apiKeys.ts"],
    outfile: `${outdir}/apiKeys.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
  });
  return import(pathToFileURL(`${process.cwd()}/${outdir}/apiKeys.mjs`).href);
}

const apiKeys = await loadApiKeysModule();

// generateApiKey: prefix, charset, and uniqueness
{
  const a = apiKeys.generateApiKey();
  const b = apiKeys.generateApiKey();
  assert.ok(a.startsWith("pa_live_"), "key should start with pa_live_");
  assert.equal(a.length, "pa_live_".length + 40);
  assert.match(a.slice("pa_live_".length), /^[A-Za-z0-9]{40}$/);
  assert.notEqual(a, b, "two generated keys should differ");
}

// formatKeyPrefix: first 12 chars
{
  const key = apiKeys.generateApiKey();
  const prefix = apiKeys.formatKeyPrefix(key);
  assert.equal(prefix.length, 12);
  assert.equal(prefix, key.slice(0, 12));
}

// hashApiKey: deterministic, 64 lowercase hex chars, input-sensitive
{
  const h1 = await apiKeys.hashApiKey("pa_live_example");
  const h2 = await apiKeys.hashApiKey("pa_live_example");
  const h3 = await apiKeys.hashApiKey("pa_live_different");
  assert.equal(h1, h2, "hash should be deterministic");
  assert.match(h1, /^[0-9a-f]{64}$/, "hash should be 64 lowercase hex chars");
  assert.notEqual(h1, h3, "different inputs should hash differently");
}

// hasScope
{
  assert.equal(apiKeys.hasScope(["*"], "items:write"), true);
  assert.equal(apiKeys.hasScope(["items:write"], "items:write"), true);
  assert.equal(apiKeys.hasScope(["items:read"], "items:write"), false);
  assert.equal(apiKeys.hasScope([], "items:read"), false);
}

// AGENT_SCOPES
{
  assert.deepEqual(apiKeys.AGENT_SCOPES, [
    "lists:read",
    "items:read",
    "items:write",
  ]);
}

// sanitizeScopes: strips "*" and unknown scopes, keeps valid ones
{
  assert.deepEqual(
    apiKeys.sanitizeScopes(["items:read", "bogus", "*", "items:write"]),
    ["items:read", "items:write"],
    "should drop wildcard and unknown scopes"
  );
  assert.deepEqual(apiKeys.sanitizeScopes(["*"]), [], "wildcard alone yields nothing");
  assert.deepEqual(
    apiKeys.sanitizeScopes([...apiKeys.AGENT_SCOPES]),
    ["lists:read", "items:read", "items:write"]
  );
}

await rm(outdir, { recursive: true, force: true });
console.log("api-keys helper tests passed");
