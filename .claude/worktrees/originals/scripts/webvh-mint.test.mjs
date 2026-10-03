import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/webvh-mint-test";

/**
 * Exercises the real mint. didwebvh-ts verifies the log it just created, so a
 * malformed `updateKeys` fails here exactly as it does in the browser.
 */
async function loadWebvh() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["src/lib/webvh.ts"],
    outfile: `${outdir}/webvh.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    define: { "import.meta.env.VITE_WEBVH_DOMAIN": '"boop.ad"' },
    plugins: [
      {
        name: "stub-capacitor",
        setup(b) {
          b.onResolve({ filter: /^@capacitor\/core$/ }, () => ({ path: "cap", namespace: "s" }));
          b.onLoad({ filter: /.*/, namespace: "s" }, () => ({
            contents: "export const Capacitor={isNativePlatform:()=>false};",
            loader: "js",
          }));
        },
      },
    ],
  });
  return import(pathToFileURL(`${process.cwd()}/${outdir}/webvh.mjs`).href);
}

/**
 * Installs browser globals for the duration of `fn`, then restores them.
 * defineProperty, not assignment: bun exposes a readonly `localStorage`.
 * Restoring matters because bun shares globals across test files.
 */
function withBrowserGlobals(fn) {
  const store = new Map();
  const saved = ["localStorage", "window"].map((name) => ({
    name,
    descriptor: Object.getOwnPropertyDescriptor(globalThis, name),
  }));

  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const set = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

  set("localStorage", localStorage);
  set("window", { location: { host: "boop.ad" }, localStorage });

  const restore = () => {
    for (const { name, descriptor } of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
  return Promise.resolve(fn()).finally(restore);
}

const webvh = await loadWebvh();

test("createUserWebVHDid mints a verifiable did:webvh", async () => {
  await withBrowserGlobals(async () => {
    // Regression: updateKeys carried the `did:key:` URI while didwebvh-ts 2.8
    // compares the parsed keyMultibase, so every mint threw
    // "Key did:key:… is not authorized to update" — no account could get a DID.
    const result = await webvh.createUserWebVHDid({
      email: "someone@example.com",
      subOrgId: "20ed9d43-2d31-44f8-9b02-2242c2749a58",
    });

    assert.match(result.did, /^did:webvh:/);
    assert.ok(result.did.includes(":boop.ad:"), "must be minted on the current domain");
    assert.equal(result.path, "user-20ed9d43-2d31-44");
    assert.ok(result.didLogJsonl.trim().length > 0, "a log must be produced for the server");
  });
});

test("the minted DID is not stale and yields an openable share URL", async () => {
  await withBrowserGlobals(async () => {
    const result = await webvh.createUserWebVHDid({
      email: "someone@example.com",
      subOrgId: "abc1234567890123456",
    });
    assert.equal(webvh.isStaleDidDomain(result.did), false, "a fresh mint must not re-trigger");
    assert.match(
      webvh.buildListResourceUrl(result.did, "l1"),
      /^https:\/\/boop\.ad\/user-abc1234567890123\/resources\/list-l1$/
    );
  });
});
