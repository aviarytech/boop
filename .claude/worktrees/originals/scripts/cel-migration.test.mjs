import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/cel-migration-test";

async function loadModule() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["./convex/migrations/celAssetDidsDb.ts"],
    outfile: `${outdir}/celAssetDidsDb.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["convex/*"],
    // jsonld/rdf-canonize are CJS and call require() at load.
    banner: {
      js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
  });
  return import(
    `${pathToFileURL(`${process.cwd()}/${outdir}/celAssetDidsDb.mjs`).href}?t=${Date.now()}`
  );
}

const mod = await loadModule();
const unwrap = (fn) => fn._handler ?? fn.handler;

function makeCtx(lists) {
  const rows = new Map(lists.map((l) => [l._id, { ...l }]));
  const envelopes = [];
  return {
    patched: rows,
    envelopes,
    db: {
      query: (table) =>
        table === "listEnvelopes"
          ? {
              withIndex: (_n, fn) => {
                const eqs = [];
                fn({ eq: (f, v) => (eqs.push([f, v]), { eq: () => {} }) });
                const match = envelopes.filter((e) =>
                  eqs.every(([f, v]) => e[f] === v)
                );
                return { first: async () => match[0] ?? null };
              },
            }
          : { collect: async () => [...rows.values()] },
      get: async (id) => rows.get(id) ?? null,
      patch: async (id, fields) => {
        const existing = envelopes.find((e) => e._id === id);
        if (existing) Object.assign(existing, fields);
        else rows.set(id, { ...rows.get(id), ...fields });
      },
      insert: async (_table, doc) => {
        const _id = `env${envelopes.length + 1}`;
        envelopes.push({ _id, ...doc });
        return _id;
      },
    },
  };
}

const LEGACY = {
  _id: "L1",
  assetDid: "did:peer:2.Vz6Mk",
  name: "Groceries",
  ownerDid: "did:webvh:example:alice",
  createdAt: 1700000000000,
};
const PLACEHOLDER = {
  _id: "L2",
  assetDid: "did:peer:temp-1700000000001",
  name: "From Template",
  ownerDid: "did:webvh:example:alice",
  createdAt: 1700000000001,
};
const ALREADY_CEL = {
  _id: "L3",
  assetDid: "did:cel:uEiDsw2OxJw7R",
  name: "New List",
  ownerDid: "did:webvh:example:alice",
  createdAt: 1700000000002,
};

test("needsCelMigration matches both real did:peer and temp- placeholders", () => {
  assert.equal(mod.needsCelMigration("did:peer:2.Vz6Mk"), true);
  assert.equal(mod.needsCelMigration("did:peer:temp-1700000000001"), true);
  assert.equal(mod.needsCelMigration("did:cel:uEiDsw2OxJw7R"), false);
  assert.equal(mod.needsCelMigration("did:webvh:example:alice"), false);
  assert.equal(mod.needsCelMigration(""), false);
  assert.equal(mod.needsCelMigration(undefined), false);
  assert.equal(mod.needsCelMigration(null), false);
});

test("listLegacyLists selects only unmigrated rows", async () => {
  const ctx = makeCtx([LEGACY, PLACEHOLDER, ALREADY_CEL]);
  const rows = await unwrap(mod.listLegacyLists)(ctx, {});
  assert.deepEqual(
    rows.map((r) => r._id).sort(),
    ["L1", "L2"],
    "already-migrated rows must not be re-minted"
  );
});

test("setListAssetDid rewrites the DID and rebuilds the VC subject", async () => {
  const ctx = makeCtx([LEGACY]);
  const result = await unwrap(mod.setListAssetDid)(ctx, {
    listId: "L1",
    assetDid: "did:cel:uEiFRESH",
    celEnvelope: '{"format":"originals/asset","assetDid":"did:cel:uEiFRESH"}',
  });

  assert.equal(result.migrated, true);
  const row = ctx.patched.get("L1");
  assert.equal(row.assetDid, "did:cel:uEiFRESH");
  assert.equal(
    row.vcProof.credentialSubject.id,
    "did:cel:uEiFRESH",
    "credentialSubject.id must follow the new DID, not keep the did:peer one"
  );
  assert.equal(row.vcProof.credentialSubject.ownerDid, LEGACY.ownerDid);
  // The serialized proof embeds assetDid too — it must not retain the old value.
  assert.ok(!row.vcProof.proof.includes("did:peer:"), "proof must not retain did:peer");
  assert.ok(row.vcProof.proof.includes("did:cel:uEiFRESH"));

  assert.equal(ctx.envelopes.length, 1, "migration must persist the CEL envelope");
  assert.equal(ctx.envelopes[0].listId, "L1");
  assert.equal(ctx.envelopes[0].assetDid, "did:cel:uEiFRESH");
});

test("setListAssetDid is idempotent — a re-run does not touch migrated rows", async () => {
  const ctx = makeCtx([ALREADY_CEL]);
  const result = await unwrap(mod.setListAssetDid)(ctx, {
    listId: "L3",
    assetDid: "did:cel:uEiSOMETHINGELSE",
    celEnvelope: '{"format":"originals/asset"}',
  });

  assert.equal(result.migrated, false);
  assert.equal(
    ctx.patched.get("L3").assetDid,
    ALREADY_CEL.assetDid,
    "an already-migrated row must keep its DID"
  );
  assert.equal(ctx.envelopes.length, 0, "skipped rows must not write an envelope");
});

test("setListAssetDid throws on a missing list rather than silently no-oping", async () => {
  const ctx = makeCtx([]);
  await assert.rejects(
    () =>
      unwrap(mod.setListAssetDid)(ctx, {
        listId: "nope",
        assetDid: "did:cel:x",
        celEnvelope: "{}",
      }),
    /not found/
  );
});
