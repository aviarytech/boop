import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/item-categories-mutations-test";

async function loadModule() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["./convex/itemCategories.ts"],
    outfile: `${outdir}/itemCategories.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["convex/*"],
  });
  return import(
    `${pathToFileURL(`${process.cwd()}/${outdir}/itemCategories.mjs`).href}?t=${Date.now()}`
  );
}

const mod = await loadModule();
const unwrap = (fn) => fn._handler ?? fn.handler;

const OWNER = "did:webvh:QmS:boop.ad:user-owner";
const STRANGER = "did:webvh:QmS:boop.ad:user-stranger";

function makeCtx({ list, items = [] } = {}) {
  const lists = [{ _id: "L1", ownerDid: OWNER, name: "Rachel's 40th", ...list }];
  const rows = { lists, items: items.map((i) => ({ listId: "L1", ...i })) };
  const byId = new Map();
  rows.lists.forEach((l) => byId.set(l._id, l));
  rows.items.forEach((i) => byId.set(i._id, i));

  return {
    rows,
    db: {
      get: async (id) => byId.get(id) ?? null,
      patch: async (id, fields) => Object.assign(byId.get(id), fields),
      query: (table) => {
        const result = {
          // Index filtering is irrelevant here: each fixture holds one list.
          withIndex: () => result,
          collect: async () => rows[table] ?? [],
          first: async () => (rows[table] ?? [])[0] ?? null,
        };
        return result;
      },
    },
  };
}

const call = (fn, ctx, args) => unwrap(mod[fn])(ctx, { listId: "L1", userDid: OWNER, ...args });

test("the first edit materialises the grocery set onto the list", async () => {
  const ctx = makeCtx();
  assert.equal(ctx.rows.lists[0].itemCategories, undefined);

  await call("addListCategory", ctx, { name: "Luggage", emoji: "🧳" });

  const set = ctx.rows.lists[0].itemCategories;
  assert.ok(set.some((c) => c.id === "produce"), "grocery aisles are folded in, not lost");
  assert.ok(set.some((c) => c.name === "Luggage"));
  assert.equal(set[set.length - 1].id, "other");
});

test("existing customAisles survive materialisation", async () => {
  const ctx = makeCtx({
    list: { customAisles: [{ id: "pet", name: "Pet Supplies", emoji: "🐕", order: 99 }] },
  });
  await call("addListCategory", ctx, { name: "Luggage", emoji: "🧳" });

  const set = ctx.rows.lists[0].itemCategories;
  assert.ok(set.some((c) => c.id === "pet"), "a list's existing aisles must not disappear");
});

test("rename, emoji and move persist to the list", async () => {
  const ctx = makeCtx({
    list: {
      itemCategories: [
        { id: "luggage", name: "Luggage", emoji: "🧳", order: 0 },
        { id: "clothes", name: "Clothes", emoji: "👕", order: 1 },
        { id: "other", name: "Other", emoji: "🛒", order: 2 },
      ],
    },
  });

  await call("renameListCategory", ctx, { categoryId: "clothes", name: "Outfits" });
  assert.equal(ctx.rows.lists[0].itemCategories.find((c) => c.id === "clothes").name, "Outfits");

  await call("setListCategoryEmoji", ctx, { categoryId: "clothes", emoji: "🧥" });
  assert.equal(ctx.rows.lists[0].itemCategories.find((c) => c.id === "clothes").emoji, "🧥");

  await call("moveListCategory", ctx, { categoryId: "clothes", direction: "up" });
  assert.deepEqual(
    ctx.rows.lists[0].itemCategories.map((c) => c.id),
    ["clothes", "luggage", "other"]
  );
});

test("deleting a category reassigns only its own items to Other", async () => {
  const ctx = makeCtx({
    list: {
      itemCategories: [
        { id: "luggage", name: "Luggage", emoji: "🧳", order: 0 },
        { id: "clothes", name: "Clothes", emoji: "👕", order: 1 },
        { id: "other", name: "Other", emoji: "🛒", order: 2 },
      ],
    },
    items: [
      { _id: "i1", name: "T-shirt", groceryAisle: "clothes" },
      { _id: "i2", name: "Socks", groceryAisle: "clothes" },
      { _id: "i3", name: "Passport", groceryAisle: "luggage" },
      { _id: "i4", name: "Unfiled" },
    ],
  });

  const result = await call("deleteListCategory", ctx, { categoryId: "clothes" });

  assert.equal(result.reassigned, 2);
  assert.equal(ctx.rows.items.find((i) => i._id === "i1").groceryAisle, "other");
  assert.equal(ctx.rows.items.find((i) => i._id === "i2").groceryAisle, "other");
  assert.equal(
    ctx.rows.items.find((i) => i._id === "i3").groceryAisle,
    "luggage",
    "another category's items must be untouched"
  );
  assert.equal(ctx.rows.items.find((i) => i._id === "i4").groceryAisle, undefined);
  assert.equal(ctx.rows.lists[0].itemCategories.some((c) => c.id === "clothes"), false);
});

test("the Other bucket is protected at the mutation layer too", async () => {
  const ctx = makeCtx();
  await assert.rejects(() => call("deleteListCategory", ctx, { categoryId: "other" }), /cannot be deleted/);
  await assert.rejects(
    () => call("renameListCategory", ctx, { categoryId: "other", name: "Misc" }),
    /cannot be renamed/
  );
});

test("a non-editor cannot change categories", async () => {
  const ctx = makeCtx();
  await assert.rejects(
    () => unwrap(mod.addListCategory)(ctx, { listId: "L1", userDid: STRANGER, name: "X", emoji: "🏷️" }),
    /permission/
  );
  assert.equal(ctx.rows.lists[0].itemCategories, undefined, "nothing persisted on refusal");
});

test("a rejected edit leaves the stored set untouched", async () => {
  const ctx = makeCtx({
    list: {
      itemCategories: [
        { id: "luggage", name: "Luggage", emoji: "🧳", order: 0 },
        { id: "other", name: "Other", emoji: "🛒", order: 1 },
      ],
    },
  });
  await assert.rejects(() => call("addListCategory", ctx, { name: "  ", emoji: "🏷️" }), /empty/);
  assert.deepEqual(
    ctx.rows.lists[0].itemCategories.map((c) => c.id),
    ["luggage", "other"],
    "a failed validation must not partially write"
  );
});

test("a missing list is an error, not a silent no-op", async () => {
  const ctx = makeCtx();
  await assert.rejects(
    () => unwrap(mod.addListCategory)(ctx, { listId: "nope", userDid: OWNER, name: "X", emoji: "🏷️" }),
    /List not found/
  );
});
