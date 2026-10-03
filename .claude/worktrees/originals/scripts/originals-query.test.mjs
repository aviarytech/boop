import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/originals-query-test";

async function loadModule() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["./convex/originals.ts"],
    outfile: `${outdir}/originals.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["convex/*"],
  });
  return import(
    `${pathToFileURL(`${process.cwd()}/${outdir}/originals.mjs`).href}?t=${Date.now()}`
  );
}

const mod = await loadModule();
const handler = mod.listOwnedOriginals._handler ?? mod.listOwnedOriginals.handler;

// In-memory ctx.db mock matching Convex's surface.
function makeDb(tables) {
  const all = new Map();
  for (const [name, rows] of Object.entries(tables)) {
    for (const row of rows) all.set(row._id, row);
  }
  return {
    query(tableName) {
      return makeQuery(tables[tableName] ?? []);
    },
    async get(id) {
      return all.get(id) ?? null;
    },
  };
}

function makeQuery(rows) {
  let working = rows.slice();
  let order = "asc";
  return {
    withIndex(_name, fn) {
      const ops = [];
      const builder = {
        eq(field, value) { ops.push(["eq", field, value]); return builder; },
      };
      fn(builder);
      working = working.filter((r) =>
        ops.every(([op, field, value]) => op === "eq" && r[field] === value)
      );
      return this;
    },
    order(dir) { order = dir; return this; },
    async collect() {
      const sorted = working.slice().sort((a, b) => a._creationTime - b._creationTime);
      return order === "desc" ? sorted.reverse() : sorted;
    },
    async first() {
      const all = await this.collect();
      return all[0] ?? null;
    },
  };
}

test("ownerDid filter applied", async () => {
  const ctx = {
    db: makeDb({
      lists: [
        { _id: "L1", _creationTime: 1, name: "Mine", ownerDid: "me", assetDid: "did:cel:L1" },
        { _id: "L2", _creationTime: 1, name: "Theirs", ownerDid: "other", assetDid: "did:cel:L2" },
      ],
      sites: [],
      siteHostnames: [],
      publications: [],
      bitcoinAnchors: [],
      activities: [],
      itemAssignees: [],
    }),
  };
  const rows = await handler(ctx, { ownerDid: "me" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "Mine");
});

test("joins all source tables and produces rows in updatedAt desc order", async () => {
  const ctx = {
    db: makeDb({
      lists: [{ _id: "L1", _creationTime: 100, name: "A list", ownerDid: "me", assetDid: "did:cel:L1" }],
      sites: [{ _id: "S1", _creationTime: 50, ownerDid: "me", scid: "scid", did: "did:webvh:s1", primaryHostnameId: "H1", fileId: "F1", createdAt: 50, updatedAt: 9999 }],
      siteHostnames: [{ _id: "H1", siteId: "S1", hostname: "brisk-paper-07.boop.ad", kind: "boop_sub", status: "active", isPrimary: true, createdAt: 50, updatedAt: 50 }],
      publications: [{ _id: "P1", listId: "L1", webvhDid: "did:webvh:L1", status: "active", publishedAt: 200, publishedByDid: "me" }],
      bitcoinAnchors: [{ _id: "A1", listId: "L1", status: "confirmed", confirmedAt: 300, txid: "tx-abc", contentHash: "h", requestedByDid: "me", createdAt: 300 }],
      activities: [{ _id: "ACT1", listId: "L1", actorDid: "me", type: "list_updated", createdAt: 500 }],
      itemAssignees: [
        { _id: "IA1", itemId: "I1", listId: "L1", assigneeDid: "u1", assignedByDid: "me", assignedAt: 1 },
        { _id: "IA2", itemId: "I2", listId: "L1", assigneeDid: "u1", assignedByDid: "me", assignedAt: 1 },
        { _id: "IA3", itemId: "I3", listId: "L1", assigneeDid: "u2", assignedByDid: "me", assignedAt: 1 },
      ],
    }),
  };
  const rows = await handler(ctx, { ownerDid: "me" });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, "site");
  assert.equal(rows[1].source, "list");
  assert.equal(rows[1].layer, "did:webvh");
  assert.equal(rows[1].verification, "anchored");
  assert.equal(rows[1].anchorTxId, "tx-abc");
  assert.equal(rows[1].collaborators, 2);
  assert.equal(rows[1].updatedAt, 500);
});

test("missing optional joins do not crash", async () => {
  const ctx = {
    db: makeDb({
      lists: [{ _id: "L1", _creationTime: 100, name: "Bare", ownerDid: "me", assetDid: "did:cel:L1" }],
      sites: [],
      siteHostnames: [],
      publications: [],
      bitcoinAnchors: [],
      activities: [],
      itemAssignees: [],
    }),
  };
  const rows = await handler(ctx, { ownerDid: "me" });
  assert.equal(rows[0].layer, "did:cel");
  assert.equal(rows[0].verification, "none");
  assert.equal(rows[0].collaborators, undefined);
});

test("a site never reports anchored", async () => {
  const ctx = {
    db: makeDb({
      lists: [],
      sites: [{ _id: "S1", _creationTime: 50, ownerDid: "me", scid: "scid", did: "did:webvh:s1", primaryHostnameId: "H1", fileId: "F1", createdAt: 50, updatedAt: 50 }],
      siteHostnames: [{ _id: "H1", siteId: "S1", hostname: "brisk-paper-07.boop.ad", kind: "boop_sub", status: "active", isPrimary: true, createdAt: 50, updatedAt: 50 }],
      publications: [],
      bitcoinAnchors: [],
      activities: [],
      itemAssignees: [],
    }),
  };
  const rows = await handler(ctx, { ownerDid: "me" });
  assert.notEqual(rows[0].verification, "anchored");
});

test("multiple confirmed anchors → most recent confirmedAt wins", async () => {
  const ctx = {
    db: makeDb({
      lists: [{ _id: "L1", _creationTime: 100, name: "Anchored", ownerDid: "me", assetDid: "did:cel:L1" }],
      sites: [],
      siteHostnames: [],
      publications: [],
      bitcoinAnchors: [
        { _id: "A1", listId: "L1", status: "confirmed", confirmedAt: 100, txid: "older", contentHash: "h", requestedByDid: "me", createdAt: 1 },
        { _id: "A2", listId: "L1", status: "confirmed", confirmedAt: 500, txid: "newer", contentHash: "h", requestedByDid: "me", createdAt: 2 },
      ],
      activities: [],
      itemAssignees: [],
    }),
  };
  const rows = await handler(ctx, { ownerDid: "me" });
  assert.equal(rows[0].anchorTxId, "newer");
});

await rm(outdir, { recursive: true, force: true });
