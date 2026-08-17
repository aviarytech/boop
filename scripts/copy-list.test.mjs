import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/copy-list-test";

async function loadModule() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["./convex/lists.ts"],
    outfile: `${outdir}/lists.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["convex/*"],
  });
  return import(
    `${pathToFileURL(`${process.cwd()}/${outdir}/lists.mjs`).href}?t=${Date.now()}`
  );
}

const mod = await loadModule();
const unwrap = (fn) => fn._handler ?? fn.handler;

const OWNER = "did:webvh:QmS:boop.ad:user-owner";
const STRANGER = "did:webvh:QmS:boop.ad:user-stranger";

/**
 * The source list is a migrated one: its envelope exists but nobody holds the
 * key, which is the situation copyList is for.
 */
function makeCtx({ items = [], lists: extraLists = [], user = null, subscription = null } = {}) {
  const rows = {
    lists: [
      { _id: "L1", ownerDid: OWNER, name: "Camping", createdAt: 1000, assetDid: "did:cel:old", itemViewMode: "categorized", itemCategories: [{ id: "c1", name: "Gear", emoji: "🎒", order: 0 }] },
      ...extraLists,
    ],
    items: items.map((i, n) => ({ _id: `I${n}`, listId: "L1", ...i })),
    users: user ? [user] : [],
    subscriptions: subscription ? [subscription] : [],
    referrals: [],
    listEnvelopes: [],
  };

  const byId = new Map();
  for (const table of Object.values(rows)) for (const r of table) byId.set(r._id, r);

  let seq = 0;
  return {
    rows,
    db: {
      get: async (id) => byId.get(id) ?? null,
      patch: async (id, fields) => Object.assign(byId.get(id), fields),
      insert: async (table, doc) => {
        const _id = `${table}-${++seq}`;
        const row = { _id, _creationTime: Date.now(), ...doc };
        (rows[table] ??= []).push(row);
        byId.set(_id, row);
        return _id;
      },
      query: (table) => {
        let rowsFor = () => rows[table] ?? [];
        const result = {
          withIndex: (_name, fn) => {
            // Emulate just enough index filtering for by_list / by_owner.
            const captured = {};
            if (fn) fn({ eq: (field, value) => { captured[field] = value; return captured; } });
            const base = rowsFor;
            rowsFor = () =>
              base().filter((r) => Object.entries(captured).every(([k, v]) => r[k] === v));
            return result;
          },
          collect: async () => rowsFor(),
          first: async () => rowsFor()[0] ?? null,
        };
        return result;
      },
    },
  };
}

const MINTED = {
  assetDid: "did:cel:fresh",
  celEnvelope: '{"format":"originals/asset"}',
  name: "Camping (copy)",
  ownerDid: OWNER,
  createdAt: 5000,
};

test("copies items into a new list and leaves the source alone", async () => {
  const ctx = makeCtx({
    items: [
      { name: "Tent", checked: true, createdByDid: OWNER, createdAt: 1 },
      { name: "Stove", checked: false, createdByDid: OWNER, createdAt: 2 },
    ],
  });

  const { listId, itemsCopied } = await unwrap(mod.copyList)(ctx, {
    sourceListId: "L1",
    ...MINTED,
  });

  assert.equal(itemsCopied, 2);

  const copied = ctx.rows.items.filter((i) => i.listId === listId);
  assert.deepEqual(copied.map((i) => i.name).sort(), ["Stove", "Tent"]);
  // Checked state is content, so a faithful copy keeps it.
  assert.equal(copied.find((i) => i.name === "Tent").checked, true);

  // The source keeps its own items and its own identity.
  assert.equal(ctx.rows.items.filter((i) => i.listId === "L1").length, 2);
  assert.equal((await ctx.db.get("L1")).assetDid, "did:cel:old");

  const fresh = await ctx.db.get(listId);
  assert.equal(fresh.assetDid, "did:cel:fresh");
  // Presentation settings belong to the list and should survive the copy.
  assert.equal(fresh.itemViewMode, "categorized");
  assert.equal(fresh.itemCategories[0].name, "Gear");
});

test("writes the new list's envelope so the copy is verifiable", async () => {
  const ctx = makeCtx({ items: [{ name: "Tent", checked: false, createdByDid: OWNER, createdAt: 1 }] });
  const { listId } = await unwrap(mod.copyList)(ctx, { sourceListId: "L1", ...MINTED });

  const env = ctx.rows.listEnvelopes.find((e) => e.listId === listId);
  assert.ok(env, "a copy with no stored envelope would show as unverifiable");
  assert.equal(env.assetDid, "did:cel:fresh");
});

test("sub-item links point inside the copy, never back at the source", async () => {
  const ctx = makeCtx({
    items: [
      { name: "Shelter", checked: false, createdByDid: OWNER, createdAt: 1 },
      { name: "Pegs", checked: false, createdByDid: OWNER, createdAt: 2, parentId: "I0" },
    ],
  });

  const { listId } = await unwrap(mod.copyList)(ctx, { sourceListId: "L1", ...MINTED });

  const copied = ctx.rows.items.filter((i) => i.listId === listId);
  const shelter = copied.find((i) => i.name === "Shelter");
  const pegs = copied.find((i) => i.name === "Pegs");

  assert.equal(pegs.parentId, shelter._id, "parentId must be remapped to the copied parent");
  assert.notEqual(pegs.parentId, "I0", "a copy pointing at the source list's item is corrupt");
});

test("drops vcProofs — they attest actions against the source asset", async () => {
  const ctx = makeCtx({
    items: [
      {
        name: "Tent",
        checked: false,
        createdByDid: OWNER,
        createdAt: 1,
        vcProofs: [{ type: "ItemCreation", issuer: "did:cel:old", issuanceDate: 1, action: "created", actorDid: OWNER }],
      },
    ],
  });

  const { listId } = await unwrap(mod.copyList)(ctx, { sourceListId: "L1", ...MINTED });

  const copied = ctx.rows.items.find((i) => i.listId === listId);
  assert.equal(copied.vcProofs, undefined, "carrying these would claim another asset's provenance");
});

test("only the owner can copy a list", async () => {
  const ctx = makeCtx({ items: [] });
  await assert.rejects(
    () => unwrap(mod.copyList)(ctx, { sourceListId: "L1", ...MINTED, ownerDid: STRANGER }),
    /owner/i
  );
});

test("copying respects the free-plan list cap", async () => {
  // Five lists already, free plan: a copy is a new list and must count.
  const extra = Array.from({ length: 4 }, (_, n) => ({
    _id: `X${n}`,
    ownerDid: OWNER,
    name: `Other ${n}`,
    createdAt: 1,
    assetDid: "did:cel:x",
  }));

  const ctx = makeCtx({
    items: [],
    lists: extra,
    user: { _id: "U1", did: OWNER },
  });

  await assert.rejects(
    () => unwrap(mod.copyList)(ctx, { sourceListId: "L1", ...MINTED }),
    /PLAN_LIMIT/
  );
});
