import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/cloudflare-test";

async function loadCloudflareModule(env = {}) {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["./convex/cloudflare.ts"],
    outfile: `${outdir}/cloudflare.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["convex/*"],
  });
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return import(
    `${pathToFileURL(`${process.cwd()}/${outdir}/cloudflare.mjs`).href}?t=${Date.now()}`
  );
}

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
  return calls;
}

const TOKEN = "test-token";
const ZONE = "test-zone-id";

test("createCustomHostname posts to the right URL with the right body", async () => {
  const cf = await loadCloudflareModule({
    CLOUDFLARE_API_TOKEN: TOKEN,
    CLOUDFLARE_ZONE_ID: ZONE,
  });
  const calls = stubFetch(async () =>
    new Response(
      JSON.stringify({
        success: true,
        result: {
          id: "ch_abc",
          hostname: "www.forexample.com",
          status: "pending",
          ssl: { status: "initializing" },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );

  const result = await cf.createCustomHostname("www.forexample.com");

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `https://api.cloudflare.com/client/v4/zones/${ZONE}/custom_hostnames`
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(
    calls[0].init.headers.Authorization,
    `Bearer ${TOKEN}`
  );
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.hostname, "www.forexample.com");
  assert.deepEqual(body.ssl, { method: "http", type: "dv" });
  assert.equal(result.id, "ch_abc");
  assert.equal(result.status, "pending");
  assert.equal(result.ssl.status, "initializing");
});

test("getCustomHostname GETs the hostname and returns the parsed record", async () => {
  const cf = await loadCloudflareModule({
    CLOUDFLARE_API_TOKEN: TOKEN,
    CLOUDFLARE_ZONE_ID: ZONE,
  });
  const calls = stubFetch(async () =>
    new Response(
      JSON.stringify({
        success: true,
        result: {
          id: "ch_abc",
          hostname: "www.forexample.com",
          status: "active",
          ssl: { status: "active" },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );

  const result = await cf.getCustomHostname("ch_abc");

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `https://api.cloudflare.com/client/v4/zones/${ZONE}/custom_hostnames/ch_abc`
  );
  assert.equal(calls[0].init.method, "GET");
  assert.equal(result.status, "active");
  assert.equal(result.ssl.status, "active");
});

test("deleteCustomHostname DELETEs and returns void", async () => {
  const cf = await loadCloudflareModule({
    CLOUDFLARE_API_TOKEN: TOKEN,
    CLOUDFLARE_ZONE_ID: ZONE,
  });
  const calls = stubFetch(async () =>
    new Response(
      JSON.stringify({ success: true, result: { id: "ch_abc" } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );

  const result = await cf.deleteCustomHostname("ch_abc");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(result, undefined);
});

test("missing CLOUDFLARE_API_TOKEN throws a clear error", async () => {
  delete process.env.CLOUDFLARE_API_TOKEN;
  process.env.CLOUDFLARE_ZONE_ID = ZONE;
  const cf = await loadCloudflareModule({});
  delete process.env.CLOUDFLARE_API_TOKEN;
  await assert.rejects(
    () => cf.createCustomHostname("www.forexample.com"),
    /CLOUDFLARE_API_TOKEN is not set/
  );
});

test("missing CLOUDFLARE_ZONE_ID throws a clear error", async () => {
  delete process.env.CLOUDFLARE_ZONE_ID;
  process.env.CLOUDFLARE_API_TOKEN = TOKEN;
  const cf = await loadCloudflareModule({});
  delete process.env.CLOUDFLARE_ZONE_ID;
  await assert.rejects(
    () => cf.createCustomHostname("www.forexample.com"),
    /CLOUDFLARE_ZONE_ID is not set/
  );
});

test("4xx response surfaces as Error with joined CF errors", async () => {
  const cf = await loadCloudflareModule({
    CLOUDFLARE_API_TOKEN: TOKEN,
    CLOUDFLARE_ZONE_ID: ZONE,
  });
  stubFetch(async () =>
    new Response(
      JSON.stringify({
        success: false,
        errors: [
          { code: 1414, message: "hostname is invalid" },
          { code: 1500, message: "zone limit reached" },
        ],
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
  );

  await assert.rejects(
    () => cf.createCustomHostname("not-a-real-hostname"),
    /hostname is invalid.*zone limit reached/
  );
});
