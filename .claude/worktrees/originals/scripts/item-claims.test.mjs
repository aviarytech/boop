import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/item-claims-test";

async function loadModules() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  for (const name of ["itemClaims", "lists"]) {
    await build({
      entryPoints: [`./convex/${name}.ts`],
      outfile: `${outdir}/${name}.mjs`,
      bundle: true, platform: "node", format: "esm", target: "node20",
      external: ["convex/*"],
    });
  }
  return {
    claims: await import(`${pathToFileURL(`${process.cwd()}/${outdir}/itemClaims.mjs`).href}?t=${Date.now()}`),
    lists: await import(`${pathToFileURL(`${process.cwd()}/${outdir}/lists.mjs`).href}?t=${Date.now()}`),
  };
}

const { claims, lists } = await loadModules();
const unwrap = (fn) => fn._handler ?? fn.handler;

const OWNER = "did:webvh:QmS:boop.ad:user-owner";
const COLLABORATOR = "did:webvh:QmS:boop.ad:user-collab";
const STRANGER = "did:webvh:QmS:boop.ad:user-stranger";

function makeCtx({ list = {}, itemClaims = [], envelopes = [], publications = [] } = {}) {
  const rows = {
    lists: [{ _id: "L1", ownerDid: OWNER, assetDid: "did:cel:zList", name: "Groceries", ...list }],
    itemClaims: itemClaims.map((c, i) => ({ _id: `C${i + 1}`, listId: "L1", ...c })),
    listEnvelopes: envelopes,
    publications,
    bookmarks: [],
  };
  const byId = new Map();
  for (const table of Object.values(rows)) for (const row of table) byId.set(row._id, row);

  const chain = (table) => {
    let results = [...(rows[table] ?? [])];
    const api = {
      withIndex: (_name, fn) => {
        const captured = {};
        fn({
          eq: (field, value) => {
            captured[field] = value;
            return { eq: (f2, v2) => { captured[f2] = v2; return captured; } };
          },
        });
        results = results.filter((row) =>
          Object.entries(captured).every(([k, v]) => row[k] === v)
        );
        return api;
      },
      filter: () => api,
      order: () => api,
      collect: async () => results,
      first: async () => results[0] ?? null,
    };
    return api;
  };

  return {
    rows,
    db: {
      get: async (id) => byId.get(id) ?? null,
      query: (table) => chain(table),
      insert: async (table, doc) => {
        const _id = `${table}-${(rows[table]?.length ?? 0) + 1}`;
        const row = { _id, ...doc };
        rows[table] = [...(rows[table] ?? []), row];
        byId.set(_id, row);
        return _id;
      },
      patch: async (id, patch) => {
        const row = byId.get(id);
        Object.assign(row, patch);
      },
    },
  };
}

const validClaim = {
  listId: "L1",
  itemId: "item-1",
  action: "checked",
  issuerDid: OWNER,
  credential: JSON.stringify({ id: "urn:uuid:1", proof: {} }),
};

test("submitClaim refuses an action outside the closed vocabulary", async () => {
  const ctx = makeCtx();
  await assert.rejects(
    () => unwrap(claims.submitClaim)(ctx, { ...validClaim, action: "promoted" }),
    /unknown item action/i
  );
});

test("submitClaim refuses someone with no access to the list", async () => {
  const ctx = makeCtx();
  await assert.rejects(
    () => unwrap(claims.submitClaim)(ctx, { ...validClaim, issuerDid: STRANGER }),
    /not authorized/i
  );
});

test("submitClaim refuses an oversized credential", async () => {
  const ctx = makeCtx();
  await assert.rejects(
    () => unwrap(claims.submitClaim)(ctx, { ...validClaim, credential: "x".repeat(20_001) }),
    /too large/i
  );
});

test("submitClaim stores a claim from an authorized issuer", async () => {
  const ctx = makeCtx();
  await unwrap(claims.submitClaim)(ctx, validClaim);

  assert.equal(ctx.rows.itemClaims.length, 1);
  assert.equal(ctx.rows.itemClaims[0].itemId, "item-1");
  assert.equal(ctx.rows.itemClaims[0].foldedAt, undefined, "a new claim is unfolded");
});

test("pendingClaims returns unfolded claims oldest first", async () => {
  const ctx = makeCtx({
    itemClaims: [
      { itemId: "b", createdAt: 200, foldedAt: undefined },
      { itemId: "a", createdAt: 100, foldedAt: undefined },
    ],
  });

  const pending = await unwrap(claims.pendingClaims)(ctx, { listId: "L1" });
  assert.deepEqual(pending.map((c) => c.itemId), ["a", "b"], "fold-in order matters");
});

test("markClaimsFolded is owner-only", async () => {
  const ctx = makeCtx({ itemClaims: [{ itemId: "a", createdAt: 1 }] });

  await assert.rejects(
    () => unwrap(claims.markClaimsFolded)(ctx, { claimIds: ["C1"], userDid: COLLABORATOR }),
    /only the list owner/i
  );
});

test("markClaimsFolded marks and is idempotent", async () => {
  const ctx = makeCtx({ itemClaims: [{ itemId: "a", createdAt: 1 }] });

  await unwrap(claims.markClaimsFolded)(ctx, { claimIds: ["C1"], userDid: OWNER });
  const first = ctx.rows.itemClaims[0].foldedAt;
  assert.ok(first, "folding must be recorded");

  await unwrap(claims.markClaimsFolded)(ctx, { claimIds: ["C1"], userDid: OWNER });
  assert.equal(ctx.rows.itemClaims[0].foldedAt, first, "re-marking must not move the timestamp");
});

test("countEvents reads both the EventLog and legacy envelope shapes", () => {
  assert.equal(lists.countEvents(JSON.stringify({ events: [1, 2, 3] })), 3);
  assert.equal(lists.countEvents(JSON.stringify({ eventLog: { events: [1, 2] } })), 2);
  assert.equal(lists.countEvents("not json"), 0, "garbage must never block a real write");
  assert.equal(lists.countEvents(JSON.stringify({})), 0);
});

test("saveListLog is owner-only", async () => {
  const ctx = makeCtx();
  await assert.rejects(
    () => unwrap(lists.saveListLog)(ctx, {
      listId: "L1",
      eventLog: JSON.stringify({ events: [1] }),
      userDid: COLLABORATOR,
    }),
    /only the list owner/i
  );
});

test("saveListLog refuses to shorten an existing log", async () => {
  const ctx = makeCtx({
    envelopes: [{
      _id: "E1", listId: "L1", assetDid: "did:cel:zList",
      envelope: JSON.stringify({ events: [1, 2, 3] }), updatedAt: 1,
    }],
  });

  await assert.rejects(
    () => unwrap(lists.saveListLog)(ctx, {
      listId: "L1",
      eventLog: JSON.stringify({ events: [1] }),
      userDid: OWNER,
    }),
    /shorter/i,
    "a stale client must not overwrite events it never saw"
  );
});

test("saveListLog accepts a log that grew", async () => {
  const ctx = makeCtx({
    envelopes: [{
      _id: "E1", listId: "L1", assetDid: "did:cel:zList",
      envelope: JSON.stringify({ events: [1, 2] }), updatedAt: 1,
    }],
  });

  await unwrap(lists.saveListLog)(ctx, {
    listId: "L1",
    eventLog: JSON.stringify({ events: [1, 2, 3] }),
    userDid: OWNER,
  });

  assert.equal(lists.countEvents(ctx.rows.listEnvelopes[0].envelope), 3);
});
