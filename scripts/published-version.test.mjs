import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/published-version-test";

/**
 * Recording a published version signs a CEL event, which needs the genesis key
 * out of localStorage — so these run with browser globals installed, unlike the
 * rest of the originals tests.
 */
async function loadOriginals() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["src/lib/originals.ts"],
    outfile: `${outdir}/originals.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
  });
  return import(
    `${pathToFileURL(`${process.cwd()}/${outdir}/originals.mjs`).href}?t=${Date.now()}`
  );
}

/**
 * defineProperty, not assignment: bun exposes a readonly `localStorage`.
 * Restoring matters because bun shares globals across test files.
 */
function withLocalStorage(store) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    configurable: true,
    writable: true,
  });
  return () => {
    if (saved) Object.defineProperty(globalThis, "localStorage", saved);
    else delete globalThis.localStorage;
  };
}

const SNAPSHOT = {
  name: "Camping",
  items: [
    { name: "Tent", checked: false },
    { name: "Stove", checked: true },
  ],
};

test("records a published version the log still verifies", async () => {
  const store = new Map();
  const restore = withLocalStorage(store);
  try {
    const originals = await loadOriginals();
    const asset = await originals.createListAsset("Camping", "did:webvh:example:alice");

    const recorded = await originals.recordPublishedVersion(asset.envelope, SNAPSHOT);

    assert.equal(recorded.appended, true);
    // Genesis is version 1, so the first published snapshot is 2.
    assert.equal(recorded.version, 2);
    assert.ok(recorded.hash);

    const events = JSON.parse(recorded.envelope).eventLog.log.map((e) => e.event.operation.type);
    assert.deepEqual(events, ["create", "update"]);

    // An unverifiable log would be worse than no log at all.
    const check = await originals.verifyListEnvelope(recorded.envelope);
    assert.equal(check.verified, true, `must still verify, got: ${check.error ?? ""}`);
    assert.deepEqual(check.warnings, []);
  } finally {
    restore();
  }
});

test("the snapshot commits to what was published", async () => {
  const store = new Map();
  const restore = withLocalStorage(store);
  try {
    const originals = await loadOriginals();
    const asset = await originals.createListAsset("Camping", "did:webvh:example:alice");
    const recorded = await originals.recordPublishedVersion(asset.envelope, SNAPSHOT);

    const resources = JSON.parse(recorded.envelope).resources;
    const published = resources.filter((r) => r.id === "list-metadata").at(-1);
    assert.deepEqual(JSON.parse(Buffer.from(published.content.data, "base64").toString()), SNAPSHOT);
  } finally {
    restore();
  }
});

test("re-publishing unchanged content is a no-op, not a failure", async () => {
  const store = new Map();
  const restore = withLocalStorage(store);
  try {
    const originals = await loadOriginals();
    const asset = await originals.createListAsset("Camping", "did:webvh:example:alice");

    const first = await originals.recordPublishedVersion(asset.envelope, SNAPSHOT);
    const again = await originals.recordPublishedVersion(first.envelope, SNAPSHOT);

    assert.equal(again.appended, false, "an unchanged re-publish must not append");
    assert.equal(
      JSON.parse(again.envelope).eventLog.log.length,
      2,
      "the log must not grow when nothing changed"
    );
  } finally {
    restore();
  }
});

test("a changed list appends a further version", async () => {
  const store = new Map();
  const restore = withLocalStorage(store);
  try {
    const originals = await loadOriginals();
    const asset = await originals.createListAsset("Camping", "did:webvh:example:alice");

    const first = await originals.recordPublishedVersion(asset.envelope, SNAPSHOT);
    const changed = originals.buildListSnapshot("Camping", [
      { name: "Tent", checked: true },
      { name: "Stove", checked: true },
    ]);
    const second = await originals.recordPublishedVersion(first.envelope, changed);

    assert.equal(second.appended, true);
    assert.equal(second.version, 3);
    assert.equal(JSON.parse(second.envelope).eventLog.log.length, 3);

    const check = await originals.verifyListEnvelope(second.envelope);
    assert.equal(check.verified, true);
  } finally {
    restore();
  }
});

test("a list whose key is gone reports it rather than throwing a raw SDK error", async () => {
  const store = new Map();
  const restore = withLocalStorage(store);
  try {
    const originals = await loadOriginals();
    const asset = await originals.createListAsset("Camping", "did:webvh:example:alice");

    // Exactly the migrated case: the log exists, the key does not.
    store.clear();

    await assert.rejects(
      () => originals.recordPublishedVersion(asset.envelope, SNAPSHOT),
      (err) => {
        assert.equal(err.name, "ListNotAuthorableError");
        assert.match(err.message, /signing key/i);
        return true;
      }
    );
  } finally {
    restore();
  }
});

test("buildListSnapshot keeps only what a version should commit to", async () => {
  const restore = withLocalStorage(new Map());
  try {
    const originals = await loadOriginals();
    const snapshot = originals.buildListSnapshot("Camping", [
      { name: "Tent", checked: false, _id: "I1", assigneeDid: "did:webvh:someone" },
    ]);
    // Ids and assignees are local bookkeeping, not published content — including
    // them would churn the hash on changes nobody published.
    assert.deepEqual(snapshot, { name: "Camping", items: [{ name: "Tent", checked: false }] });
  } finally {
    restore();
  }
});

// Pre-CEL-3 archives keep their original identity, signatures, and device custody.
test("publishes an existing prerelease asset without replacing its history", async () => {
  const store = new Map();
  const restore = withLocalStorage(store);
  try {
    const { OriginalsSDK } = await import("@originals/sdk-legacy");
    const keyStore = {
      getPrivateKey: async id => localStorage.getItem(`lisa-cel-ed25519:${id}`),
      setPrivateKey: async (id, key) => localStorage.setItem(`lisa-cel-ed25519:${id}`, key),
    };
    const originals = await loadOriginals();
    const sdk = OriginalsSDK.create({ network: "signet", defaultKeyType: "Ed25519", keyStore });
    const old = await sdk.lifecycle.createAsset([
      await originals.buildListResource("Camping", "did:webvh:example:alice", new Date().toISOString()),
    ]);
    const envelope = JSON.stringify(old.serialize());
    const genesis = JSON.parse(envelope).eventLog.events[0];
    assert.equal(await originals.canAuthorList(old.id), true);
    const recorded = await originals.recordPublishedVersion(envelope, SNAPSHOT);
    assert.equal(recorded.appended, true);
    assert.equal(recorded.version, 2);
    assert.deepEqual(JSON.parse(recorded.envelope).eventLog.events[0], genesis);
    const verified = await originals.verifyListEnvelope(recorded.envelope);
    assert.equal(verified.verified, true);
    assert.equal(verified.assetDid, old.id);
    const again = await originals.recordPublishedVersion(recorded.envelope, SNAPSHOT);
    assert.equal(again.appended, false);
  } finally {
    restore();
  }
});
