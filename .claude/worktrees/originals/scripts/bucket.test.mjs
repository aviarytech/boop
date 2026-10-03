import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/bucket-test";

async function loadBucketModule(env = {}) {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["./convex/lib/bucket.ts"],
    outfile: `${outdir}/bucket.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["convex/*"],
  });
  for (const k of [
    "BOOP_BUCKET_NAME",
    "BOOP_BUCKET_ACCESS_KEY_ID",
    "BOOP_BUCKET_SECRET_ACCESS_KEY",
    "BOOP_BUCKET_ENDPOINT",
    "BOOP_BUCKET_REGION",
  ]) {
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return import(
    `${pathToFileURL(`${process.cwd()}/${outdir}/bucket.mjs`).href}?t=${Date.now()}`
  );
}

const ENV = {
  BOOP_BUCKET_NAME: "my-bucket-abc",
  BOOP_BUCKET_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  BOOP_BUCKET_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  BOOP_BUCKET_ENDPOINT: "https://storage.railway.app",
  BOOP_BUCKET_REGION: "auto",
};

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method =
      init.method ?? (typeof input !== "string" ? input.method : "GET");
    calls.push({ url, method, init });
    return handler(input, init, calls.length);
  };
  return calls;
}

test("presignPut returns a virtual-hosted URL with signature params", async () => {
  const m = await loadBucketModule(ENV);
  const url = await m.presignPut("sites/abc/index.html", {
    contentType: "text/html",
  });
  const u = new URL(url);
  assert.equal(u.host, "my-bucket-abc.storage.railway.app");
  assert.equal(u.pathname, "/sites/abc/index.html");
  assert.ok(u.searchParams.get("X-Amz-Algorithm")?.startsWith("AWS4"));
  assert.ok(u.searchParams.get("X-Amz-Signature"));
  assert.equal(u.searchParams.get("X-Amz-Expires"), "3600");
});

test("presignGet returns a virtual-hosted URL with custom expiry", async () => {
  const m = await loadBucketModule(ENV);
  const url = await m.presignGet("attachments/xyz.png", { expiresSec: 600 });
  const u = new URL(url);
  assert.equal(u.host, "my-bucket-abc.storage.railway.app");
  assert.equal(u.pathname, "/attachments/xyz.png");
  assert.equal(u.searchParams.get("X-Amz-Expires"), "600");
  assert.ok(u.searchParams.get("X-Amz-Signature"));
});

test("headObject returns metadata on 200", async () => {
  const m = await loadBucketModule(ENV);
  stubFetch(
    async () =>
      new Response(null, {
        status: 200,
        headers: {
          "content-length": "12345",
          "content-type": "text/html",
          etag: '"abc123"',
        },
      })
  );
  const result = await m.headObject("sites/abc/index.html");
  assert.equal(result.exists, true);
  assert.equal(result.contentLength, 12345);
  assert.equal(result.contentType, "text/html");
  assert.equal(result.etag, "abc123");
});

test("headObject returns exists: false on 404", async () => {
  const m = await loadBucketModule(ENV);
  stubFetch(async () => new Response(null, { status: 404 }));
  const result = await m.headObject("missing");
  assert.equal(result.exists, false);
});

test("headObject hits the correct virtual-hosted URL with HEAD", async () => {
  const m = await loadBucketModule(ENV);
  const calls = stubFetch(async () => new Response(null, { status: 200 }));
  await m.headObject("sites/abc/index.html");
  assert.equal(calls.length, 1);
  const u = new URL(calls[0].url);
  assert.equal(u.host, "my-bucket-abc.storage.railway.app");
  assert.equal(u.pathname, "/sites/abc/index.html");
  assert.equal(calls[0].method, "HEAD");
});

test("deleteObject succeeds on 204", async () => {
  const m = await loadBucketModule(ENV);
  const calls = stubFetch(async () => new Response(null, { status: 204 }));
  await m.deleteObject("attachments/foo.png");
  assert.equal(calls[0].method, "DELETE");
});

test("deleteObject does not throw on 404", async () => {
  const m = await loadBucketModule(ENV);
  stubFetch(async () => new Response(null, { status: 404 }));
  await m.deleteObject("missing");
});

test("deleteObject surfaces non-404 errors", async () => {
  const m = await loadBucketModule(ENV);
  stubFetch(async () => new Response("forbidden", { status: 403 }));
  await assert.rejects(() => m.deleteObject("locked"), /DELETE locked failed: 403/);
});

test("putObject signs and PUTs with content-type", async () => {
  const m = await loadBucketModule(ENV);
  const calls = stubFetch(async () => new Response(null, { status: 200 }));
  await m.putObject("sites/abc/index.html", "<html></html>", {
    contentType: "text/html",
  });
  assert.equal(calls[0].method, "PUT");
  const u = new URL(calls[0].url);
  assert.equal(u.host, "my-bucket-abc.storage.railway.app");
  assert.equal(u.pathname, "/sites/abc/index.html");
});

test("missing BOOP_BUCKET_NAME throws a clear error", async () => {
  const m = await loadBucketModule({
    ...ENV,
    BOOP_BUCKET_NAME: undefined,
  });
  delete process.env.BOOP_BUCKET_NAME;
  await assert.rejects(() => m.presignPut("k"), /BOOP_BUCKET_NAME is not set/);
});

test("missing BOOP_BUCKET_ACCESS_KEY_ID throws a clear error", async () => {
  const m = await loadBucketModule({
    ...ENV,
    BOOP_BUCKET_ACCESS_KEY_ID: undefined,
  });
  delete process.env.BOOP_BUCKET_ACCESS_KEY_ID;
  await assert.rejects(
    () => m.presignPut("k"),
    /BOOP_BUCKET_ACCESS_KEY_ID is not set/
  );
});

test("missing BOOP_BUCKET_SECRET_ACCESS_KEY throws a clear error", async () => {
  const m = await loadBucketModule({
    ...ENV,
    BOOP_BUCKET_SECRET_ACCESS_KEY: undefined,
  });
  delete process.env.BOOP_BUCKET_SECRET_ACCESS_KEY;
  await assert.rejects(
    () => m.presignPut("k"),
    /BOOP_BUCKET_SECRET_ACCESS_KEY is not set/
  );
});

test("bucketKey joins parts safely and strips slashes", async () => {
  const m = await loadBucketModule(ENV);
  assert.equal(m.bucketKey("sites", "abc", "index.html"), "sites/abc/index.html");
  assert.equal(
    m.bucketKey("/sites/", "/abc/", "index.html"),
    "sites/abc/index.html"
  );
  assert.equal(m.bucketKey("", "abc", ""), "abc");
});

test("object keys with special characters are percent-encoded", async () => {
  const m = await loadBucketModule(ENV);
  const url = await m.presignGet("sites/abc/hello world.html");
  const u = new URL(url);
  assert.equal(u.pathname, "/sites/abc/hello%20world.html");
});
