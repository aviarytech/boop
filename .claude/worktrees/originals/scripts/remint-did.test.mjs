import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/remint-did-test";

async function loadModule() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["./convex/migrations/remintUserDidDb.ts"],
    outfile: `${outdir}/remintUserDidDb.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["convex/*"],
  });
  return import(
    `${pathToFileURL(`${process.cwd()}/${outdir}/remintUserDidDb.mjs`).href}?t=${Date.now()}`
  );
}

const mod = await loadModule();
const unwrap = (fn) => fn._handler ?? fn.handler;

const OLD = "did:webvh:QmOLDSCID:trypoo.app:user-abc123";
const NEW = "did:webvh:QmNEWSCID:boop.ad:user-abc123";
const OTHER = "did:webvh:QmOTHER:boop.ad:user-zzz999";

/** In-memory ctx across multiple tables, mirroring the Convex surface used. */
function makeCtx(tables) {
  const store = new Map(Object.entries(tables).map(([t, rows]) => [t, rows.map((r) => ({ ...r }))]));
  const byId = new Map();
  for (const rows of store.values()) for (const r of rows) byId.set(r._id, r);
  return {
    store,
    db: {
      query: (table) => ({
        collect: async () => store.get(table) ?? [],
        withIndex: (_n, fn) => {
          const eqs = [];
          fn({ eq: (f, val) => (eqs.push([f, val]), { eq: () => {} }) });
          const rows = (store.get(table) ?? []).filter((r) => eqs.every(([f, val]) => r[f] === val));
          return { first: async () => rows[0] ?? null, collect: async () => rows };
        },
      }),
      get: async (id) => byId.get(id) ?? null,
      patch: async (id, fields) => Object.assign(byId.get(id), fields),
    },
  };
}

function baseTables(overrides = {}) {
  return {
    users: [{ _id: "u1", did: OLD, email: "me@example.com", turnkeySubOrgId: "sub1" }],
    lists: [
      { _id: "l1", ownerDid: OLD, name: "Mine" },
      { _id: "l2", ownerDid: OTHER, name: "Theirs" },
    ],
    items: [],
    itemAssignees: [],
    activities: [],
    publications: [],
    didLogs: [],
    agentApiKeys: [],
    categories: [],
    bookmarks: [],
    presence: [],
    tags: [],
    listTemplates: [],
    pushSubscriptions: [],
    pushTokens: [],
    sites: [],
    comments: [],
    bitcoinAnchors: [],
    ...overrides,
  };
}

test("rewrites the owner DID but leaves other users alone", async () => {
  const ctx = makeCtx(baseTables());
  const res = await unwrap(mod.applyRemint)(ctx, { userId: "u1", oldDid: OLD, newDid: NEW });

  assert.equal(res.skipped, false);
  const lists = ctx.store.get("lists");
  assert.equal(lists.find((l) => l._id === "l1").ownerDid, NEW);
  assert.equal(lists.find((l) => l._id === "l2").ownerDid, OTHER, "other users must not move");
  assert.equal(ctx.store.get("users")[0].did, NEW, "identity row must move");
});

test("publications.webvhDid is prefix-rewritten, keeping the resource path", async () => {
  const ctx = makeCtx(
    baseTables({
      publications: [
        { _id: "p1", webvhDid: `${OLD}/resources/list-l1`, publishedByDid: OLD },
        { _id: "p2", webvhDid: `${OTHER}/resources/list-l2`, publishedByDid: OTHER },
      ],
    })
  );
  await unwrap(mod.applyRemint)(ctx, { userId: "u1", oldDid: OLD, newDid: NEW });

  const pubs = ctx.store.get("publications");
  assert.equal(
    pubs.find((p) => p._id === "p1").webvhDid,
    `${NEW}/resources/list-l1`,
    "the /resources/list-* suffix must survive the prefix swap"
  );
  assert.equal(pubs.find((p) => p._id === "p1").publishedByDid, NEW);
  assert.equal(pubs.find((p) => p._id === "p2").webvhDid, `${OTHER}/resources/list-l2`);
});

test("nested list vcProof is rewritten, including the serialized proof", async () => {
  const ctx = makeCtx(
    baseTables({
      lists: [
        {
          _id: "l1",
          ownerDid: OLD,
          name: "Mine",
          vcProof: {
            type: "ListOwnershipCredential",
            issuer: OLD,
            issuanceDate: 1,
            credentialSubject: { id: "did:cel:uEiXYZ", ownerDid: OLD },
            proof: JSON.stringify({ issuer: OLD, credentialSubject: { id: OLD } }),
          },
        },
      ],
    })
  );
  await unwrap(mod.applyRemint)(ctx, { userId: "u1", oldDid: OLD, newDid: NEW });

  const vc = ctx.store.get("lists")[0].vcProof;
  assert.equal(vc.issuer, NEW);
  assert.equal(vc.credentialSubject.ownerDid, NEW);
  assert.equal(vc.credentialSubject.id, "did:cel:uEiXYZ", "asset DID must not be touched");
  assert.ok(!vc.proof.includes("trypoo.app"), "serialized proof must not retain the old DID");
});

test("nested item vcProofs and activity metadata are rewritten", async () => {
  const ctx = makeCtx(
    baseTables({
      items: [
        {
          _id: "i1",
          createdByDid: OLD,
          checkedByDid: OTHER,
          vcProofs: [{ type: "ItemCreation", issuer: OLD, issuanceDate: 1, action: "created", actorDid: OLD }],
        },
      ],
      activities: [{ _id: "a1", actorDid: OLD, metadata: { assigneeDid: OLD, status: "active" } }],
    })
  );
  await unwrap(mod.applyRemint)(ctx, { userId: "u1", oldDid: OLD, newDid: NEW });

  const item = ctx.store.get("items")[0];
  assert.equal(item.createdByDid, NEW);
  assert.equal(item.checkedByDid, OTHER, "another user's DID must survive");
  assert.equal(item.vcProofs[0].actorDid, NEW);
  assert.equal(item.vcProofs[0].issuer, NEW);

  const act = ctx.store.get("activities")[0];
  assert.equal(act.actorDid, NEW);
  assert.equal(act.metadata.assigneeDid, NEW);
  assert.equal(act.metadata.status, "active", "unrelated metadata must be preserved");
});

test("the did:cel assetDid is never rewritten", async () => {
  const ctx = makeCtx(
    baseTables({
      lists: [{ _id: "l1", ownerDid: OLD, assetDid: "did:cel:uEiKEEPME", name: "Mine" }],
    })
  );
  await unwrap(mod.applyRemint)(ctx, { userId: "u1", oldDid: OLD, newDid: NEW });
  assert.equal(ctx.store.get("lists")[0].assetDid, "did:cel:uEiKEEPME");
});

test("is idempotent — a user already on the new DID is skipped", async () => {
  const ctx = makeCtx(
    baseTables({ users: [{ _id: "u1", did: NEW, email: "me@example.com", turnkeySubOrgId: "sub1" }] })
  );
  const res = await unwrap(mod.applyRemint)(ctx, { userId: "u1", oldDid: OLD, newDid: NEW });
  assert.equal(res.skipped, true);
  assert.equal(res.rewritten, 0);
  assert.equal(ctx.store.get("lists").find((l) => l._id === "l1").ownerDid, OLD, "no partial rewrite");
});

test("previewRemint counts without mutating", async () => {
  const ctx = makeCtx(
    baseTables({
      publications: [{ _id: "p1", webvhDid: `${OLD}/resources/list-l1`, publishedByDid: OLD }],
    })
  );
  const counts = await unwrap(mod.previewRemint)(ctx, { oldDid: OLD });

  assert.equal(counts.lists, 1);
  assert.equal(counts.publications, 1);
  assert.equal(counts["publications.prefix"], 1);
  assert.equal(ctx.store.get("lists").find((l) => l._id === "l1").ownerDid, OLD, "preview must not mutate");
});

test("listUsersOnDomain matches percent-encoded domains", async () => {
  const ctx = makeCtx(
    baseTables({
      users: [
        { _id: "u1", did: OLD, email: "a@x.com" },
        { _id: "u2", did: "did:webvh:QmS:localhost%3A5173:user-b", email: "b@x.com" },
        { _id: "u3", did: NEW, email: "c@x.com" },
      ],
    })
  );

  const trypoo = await unwrap(mod.listUsersOnDomain)(ctx, { domain: "trypoo.app" });
  assert.deepEqual(trypoo.map((u) => u._id), ["u1"]);

  const local = await unwrap(mod.listUsersOnDomain)(ctx, { domain: "localhost:5173" });
  assert.deepEqual(local.map((u) => u._id), ["u2"], "must decode %3A before comparing");
});
