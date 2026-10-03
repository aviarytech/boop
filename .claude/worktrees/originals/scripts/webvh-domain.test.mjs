import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/webvh-domain-test";
let scenario = 0;

/**
 * Builds each scenario to its OWN file: the `define` values differ per scenario,
 * and a shared outfile plus a same-millisecond cache-buster let bun reuse a
 * stale module.
 */
async function loadModule({ native, envDomain, host }) {
  const id = ++scenario;
  if (id === 1) {
    await rm(outdir, { recursive: true, force: true });
    await mkdir(outdir, { recursive: true });
  }
  await build({
    entryPoints: ["src/lib/webvh.ts"],
    outfile: `${outdir}/webvh-${id}.mjs`,
    bundle: true,
    // node, not neutral: didwebvh-ts's esm build imports node:module. The
    // functions under test are pure string handling, so the platform is moot.
    platform: "node",
    format: "esm",
    target: "es2022",
    define: {
      // JSON.stringify(undefined) is not a string; esbuild needs the literal.
      "import.meta.env.VITE_WEBVH_DOMAIN":
        envDomain === undefined ? "undefined" : JSON.stringify(envDomain),
    },
    // Capacitor's platform check is the thing under test; stub it per scenario.
    plugins: [
      {
        name: "stub-capacitor",
        setup(b) {
          b.onResolve({ filter: /^@capacitor\/core$/ }, () => ({
            path: "capacitor-stub",
            namespace: "stub",
          }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents: `export const Capacitor = { isNativePlatform: () => ${native} };`,
            loader: "js",
          }));
        },
      },
    ],
  });
  const mod = await import(pathToFileURL(`${process.cwd()}/${outdir}/webvh-${id}.mjs`).href);
  // `window` is read at call time, so hand back a wrapper that installs it only
  // for the duration of the call. bun shares globals across test files, and a
  // leaked `window` makes unrelated modules believe they are in a browser.
  return new Proxy(mod, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== "function") return value;
      return (...fnArgs) => {
        const had = "window" in globalThis;
        const previous = globalThis.window;
        globalThis.window = { location: { host } };
        try {
          return value(...fnArgs);
        } finally {
          if (had) globalThis.window = previous;
          else delete globalThis.window;
        }
      };
    },
  });
}

test("native builds ignore a baked-in dev VITE_WEBVH_DOMAIN", async () => {
  // The regression: `bun run cap:build` reads .env.local, so a dev host used to
  // get stamped into real native DIDs.
  const mod = await loadModule({
    native: true,
    envDomain: "localhost:5173",
    host: "localhost",
  });
  assert.equal(mod.currentWebvhDomain(), "boop.ad");
});

test("web builds still honour VITE_WEBVH_DOMAIN, then fall back to the host", async () => {
  const withEnv = await loadModule({
    native: false,
    envDomain: "localhost:5173",
    host: "boop.ad",
  });
  assert.equal(withEnv.currentWebvhDomain(), "localhost:5173");

  const withoutEnv = await loadModule({ native: false, envDomain: undefined, host: "boop.ad" });
  assert.equal(withoutEnv.currentWebvhDomain(), "boop.ad");
});

test("domainFromDid decodes a percent-encoded host", async () => {
  const mod = await loadModule({ native: false, envDomain: undefined, host: "boop.ad" });
  assert.equal(mod.domainFromDid("did:webvh:QmS:localhost%3A5173:user-a"), "localhost:5173");
  assert.equal(mod.domainFromDid("did:webvh:QmS:boop.ad:user-a"), "boop.ad");
});

test("buildListResourceUrl produces an openable URL for both hosts", async () => {
  const mod = await loadModule({ native: false, envDomain: undefined, host: "boop.ad" });

  assert.equal(
    mod.buildListResourceUrl("did:webvh:QmS:boop.ad:user-a", "l1"),
    "https://boop.ad/user-a/resources/list-l1"
  );
  // Was `https://localhost%3A5173/...` — an invalid host and an unusable scheme.
  assert.equal(
    mod.buildListResourceUrl("did:webvh:QmS:localhost%3A5173:user-a", "l1"),
    "http://localhost:5173/user-a/resources/list-l1"
  );
});

test("isStaleDidDomain flags only DIDs off the current domain", async () => {
  const mod = await loadModule({ native: false, envDomain: undefined, host: "boop.ad" });

  assert.equal(mod.isStaleDidDomain("did:webvh:QmS:trypoo.app:user-a"), true);
  assert.equal(mod.isStaleDidDomain("did:webvh:QmS:boop.ad:user-a"), false);
  assert.equal(
    mod.isStaleDidDomain("did:temp:20ed9d43"),
    false,
    "a non-webvh DID must not trigger a re-mint"
  );
});
