// User DIDs resolve from their did:webvh location on the app domain:
// server.ts proxies /user-*/did.jsonl to Convex's /d/ routes (didProxy.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/did-proxy-test";
await mkdir(outdir, { recursive: true });
await build({ entryPoints: ["didProxy.ts"], outfile: `${outdir}/didProxy.mjs`, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
const { didProxyTarget, serveDidPath } = await import(`${pathToFileURL(`${process.cwd()}/${outdir}/didProxy.mjs`).href}?t=${Date.now()}`);

const CONVEX = "https://example.convex.site";
const req = (path, init = {}) => new Request(`https://boop.ad${path}`, init);

test("a DID log is proxied to Convex's /d/ route", () => {
  assert.equal(didProxyTarget(req("/user-20ed9d43-2d31-44/did.jsonl"), CONVEX), `${CONVEX}/d/user-20ed9d43-2d31-44/did.jsonl`);
  assert.equal(didProxyTarget(req("/user-abc/did.jsonl"), `${CONVEX}/`), `${CONVEX}/d/user-abc/did.jsonl`);
});

test("a browser opening a shared list still gets the app page", () => {
  const browser = req("/user-abc/resources/list-k123", { headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" } });
  assert.equal(didProxyTarget(browser, CONVEX), null);
  const resolver = req("/user-abc/resources/list-k123", { headers: { accept: "application/json" } });
  assert.equal(didProxyTarget(resolver, CONVEX), `${CONVEX}/d/user-abc/resources/list-k123`);
});

test("only DID reads are proxied", () => {
  assert.equal(didProxyTarget(req("/user-abc/did.jsonl", { method: "POST" }), CONVEX), null);
  for (const path of ["/", "/d", "/list/abc", "/user-abc", "/user-abc/did.json", "/user-abc/../did.jsonl", "/other/did.jsonl", "/user-abc/resources/list-1/items/2/check"]) {
    assert.equal(didProxyTarget(req(path, { headers: { accept: "*/*" } }), CONVEX), null, path);
  }
});

test("the proxied log keeps its content type, and resolvers on any origin can read it", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, method: init.method });
    return new Response('{"versionId":"1-x"}\n', { status: 200, headers: { "content-type": "application/jsonl+json" } });
  };
  const response = await serveDidPath(req("/user-abc/did.jsonl"), CONVEX, fetchImpl);
  assert.deepEqual(seen, [{ url: `${CONVEX}/d/user-abc/did.jsonl`, method: "GET" }]);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/jsonl+json");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(await response.text(), '{"versionId":"1-x"}\n');
});

test("an unknown user is a 404, not the app page, and nothing is cached", async () => {
  const fetchImpl = async () => new Response("Not found", { status: 404 });
  const response = await serveDidPath(req("/user-missing/did.jsonl"), CONVEX, fetchImpl);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), null);
});

test("without a Convex URL the app is served as before", async () => {
  assert.equal(await serveDidPath(req("/user-abc/did.jsonl"), undefined), null);
});
