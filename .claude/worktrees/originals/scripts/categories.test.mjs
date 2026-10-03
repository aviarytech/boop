import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const outdir = "tmp/categories-test";

async function loadModule() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["src/lib/categories.ts"],
    outfile: `${outdir}/categories.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
  });
  return import(pathToFileURL(`${process.cwd()}/${outdir}/categories.mjs`).href);
}

const c = await loadModule();

/** A materialised packing-list set, as a list gets after its first edit. */
function packingSet() {
  return c.normaliseOrder([
    { id: "luggage", name: "Luggage", emoji: "🧳", order: 0 },
    { id: "clothes", name: "Clothes", emoji: "👕", order: 1 },
    { id: "electronics", name: "Electronics", emoji: "🔌", order: 2 },
    { id: "other", name: "Other", emoji: "🛒", order: 3 },
  ]);
}

test("a list with no categories falls back to the grocery defaults", () => {
  assert.equal(c.hasOwnCategories(undefined), false);
  assert.equal(c.hasOwnCategories([]), false, "an empty array is not an owned set");

  const resolved = c.resolveCategories(undefined);
  assert.ok(resolved.length > 1);
  assert.equal(resolved[0].id, "produce", "defaults keep store-walk order");
  assert.ok(resolved.some((x) => x.id === "other"));
});

test("materialising folds legacy custom aisles in after the defaults", () => {
  const materialised = c.materialiseCategories(undefined, [
    { id: "pet", name: "Pet Supplies", emoji: "🐕", order: 99 },
  ]);

  assert.ok(materialised.some((x) => x.id === "produce"), "defaults are preserved");
  assert.ok(materialised.some((x) => x.id === "pet"), "existing custom aisles survive");
  assert.equal(
    materialised[materialised.length - 1].id,
    "other",
    "Other is pinned last so items always have a home"
  );
  assert.deepEqual(
    materialised.map((x) => x.order),
    materialised.map((_, i) => i),
    "order is renumbered contiguously"
  );
});

test("materialising an already-owned set is a no-op", () => {
  const set = packingSet();
  assert.deepEqual(c.materialiseCategories(set, []), set);
});

test("an owned set no longer offers grocery aisles", () => {
  const resolved = c.resolveCategories(packingSet());
  assert.deepEqual(resolved.map((x) => x.id), ["luggage", "clothes", "electronics", "other"]);
  assert.equal(resolved.some((x) => x.id === "produce"), false, "this is the whole point");
});

test("addCategory appends, slugs the id, and keeps Other last", () => {
  const next = c.addCategory(packingSet(), "Toiletries", "🧴");
  const added = next.find((x) => x.name === "Toiletries");

  assert.equal(added.id, "toiletries");
  assert.equal(added.emoji, "🧴");
  assert.equal(next[next.length - 1].id, "other");
  assert.equal(next.find((x) => x.id === "other").order, next.length - 1);
});

test("addCategory rejects blank, overlong, and duplicate names", () => {
  const set = packingSet();
  assert.throws(() => c.addCategory(set, "   ", "🧴"), /cannot be empty/);
  assert.throws(() => c.addCategory(set, "x".repeat(41), "🧴"), /exceed/);
  assert.throws(() => c.addCategory(set, "clothes", "👕"), /already exists/, "match is case-insensitive");
});

test("addCategory disambiguates ids when names slug identically", () => {
  const once = c.addCategory(packingSet(), "Carry On", "🎒");
  const twice = c.addCategory(once, "Carry-On", "🎒");
  const ids = twice.filter((x) => x.id.startsWith("carry-on")).map((x) => x.id);
  assert.deepEqual(ids, ["carry-on", "carry-on-2"], "ids must stay unique within the set");
});

test("addCategory falls back to a default emoji", () => {
  const next = c.addCategory(packingSet(), "Snacks", "  ");
  assert.equal(next.find((x) => x.name === "Snacks").emoji, "🏷️");
});

test("renameCategory renames in place without reordering", () => {
  const next = c.renameCategory(packingSet(), "clothes", "Outfits");
  assert.equal(next.find((x) => x.id === "clothes").name, "Outfits");
  assert.deepEqual(next.map((x) => x.id), ["luggage", "clothes", "electronics", "other"]);
});

test("renameCategory rejects a name another category already uses", () => {
  assert.throws(() => c.renameCategory(packingSet(), "clothes", "Luggage"), /already exists/);
  // Renaming to its own name differing only in case is fine.
  assert.doesNotThrow(() => c.renameCategory(packingSet(), "clothes", "CLOTHES"));
});

test("deleteCategory removes it and renumbers", () => {
  const next = c.deleteCategory(packingSet(), "clothes");
  assert.deepEqual(next.map((x) => x.id), ["luggage", "electronics", "other"]);
  assert.deepEqual(next.map((x) => x.order), [0, 1, 2]);
});

test("the Other bucket cannot be renamed, deleted, or reordered", () => {
  const set = packingSet();
  assert.throws(() => c.deleteCategory(set, "other"), /cannot be deleted/);
  assert.throws(() => c.renameCategory(set, "other", "Misc"), /cannot be renamed/);
  assert.throws(() => c.moveCategory(set, "other", "up"), /cannot be reordered/);
});

test("moveCategory swaps neighbours and is a no-op at the edges", () => {
  const set = packingSet();

  const down = c.moveCategory(set, "luggage", "down");
  assert.deepEqual(down.map((x) => x.id), ["clothes", "luggage", "electronics", "other"]);

  const up = c.moveCategory(down, "luggage", "up");
  assert.deepEqual(up.map((x) => x.id), ["luggage", "clothes", "electronics", "other"]);

  assert.deepEqual(
    c.moveCategory(set, "luggage", "up").map((x) => x.id),
    set.map((x) => x.id),
    "already first"
  );
  assert.deepEqual(
    c.moveCategory(set, "electronics", "down").map((x) => x.id),
    set.map((x) => x.id),
    "last movable category cannot displace Other"
  );
});

test("moveCategory never lets a category slip past Other", () => {
  const next = c.moveCategory(packingSet(), "electronics", "down");
  assert.equal(next[next.length - 1].id, "other");
});

test("setCategoryEmoji changes only the emoji, including on Other", () => {
  const next = c.setCategoryEmoji(packingSet(), "other", "📦");
  assert.equal(next.find((x) => x.id === "other").emoji, "📦");
  assert.equal(next.find((x) => x.id === "other").name, "Other", "name is untouched");
});

test("editing an unknown category is an error, not a silent no-op", () => {
  const set = packingSet();
  assert.throws(() => c.renameCategory(set, "nope", "X"), /No category/);
  assert.throws(() => c.deleteCategory(set, "nope"), /No category/);
  assert.throws(() => c.moveCategory(set, "nope", "up"), /No category/);
  assert.throws(() => c.setCategoryEmoji(set, "nope", "X"), /No category/);
});

// --- classification against the list's own set ---

test("a grocery list still auto-classifies", () => {
  const set = c.resolveCategories(undefined);
  assert.equal(c.resolveItemCategory({ name: "bananas" }, set), "produce");
  assert.equal(c.resolveItemCategory({ name: "milk" }, set), "dairy");
});

test("a grocery list that added a category KEEPS auto-classifying", () => {
  // The regression this guards: materialising on first edit must not silently
  // switch grocery auto-filing off.
  const set = c.addCategory(c.materialiseCategories(undefined, []), "Pet Supplies", "🐕");
  assert.equal(c.resolveItemCategory({ name: "bananas" }, set), "produce");
  assert.equal(c.resolveItemCategory({ name: "chicken breast" }, set), "meat");
});

test("a packing list that dropped the grocery aisles stops guessing", () => {
  const set = packingSet();
  // Would classify as "produce" against the grocery set; that category is gone.
  assert.equal(c.resolveItemCategory({ name: "bananas" }, set), "other");
  assert.equal(c.resolveItemCategory({ name: "Sunglasses" }, set), "other");
});

test("an explicit assignment beats the keyword guess", () => {
  const set = c.resolveCategories(undefined);
  assert.equal(c.resolveItemCategory({ name: "bananas", groceryAisle: "snacks" }, set), "snacks");
});

test("an assignment to a deleted category degrades to Other", () => {
  const set = c.deleteCategory(packingSet(), "clothes");
  assert.equal(
    c.resolveItemCategory({ name: "T-shirt", groceryAisle: "clothes" }, set),
    "other",
    "the item must stay visible, not vanish into a group nothing renders"
  );
});

test("groupByCategory returns non-empty groups in display order", () => {
  const groups = c.groupByCategory(
    [
      { name: "Passport", groceryAisle: "luggage" },
      { name: "Laptop", groceryAisle: "electronics" },
      { name: "Socks", groceryAisle: "clothes" },
      { name: "Charger", groceryAisle: "electronics" },
      { name: "Mystery thing" },
    ],
    packingSet()
  );

  assert.deepEqual(groups.map((g) => g.category.id), ["luggage", "clothes", "electronics", "other"]);
  assert.deepEqual(groups.find((g) => g.category.id === "electronics").items.map((i) => i.name), [
    "Laptop",
    "Charger",
  ]);
  assert.deepEqual(groups.find((g) => g.category.id === "other").items.map((i) => i.name), [
    "Mystery thing",
  ]);
});

test("groupByCategory hides untouched built-ins that are empty", () => {
  // A short grocery list should not be buried under 15 unused aisle headers.
  const groups = c.groupByCategory([{ name: "bananas" }], c.resolveCategories(undefined));
  assert.deepEqual(groups.map((g) => g.category.id), ["produce"]);
});

test("a user-created category stays visible while empty", () => {
  // The bug this guards: an added category rendered nowhere, so it looked like
  // it had failed to save — and there was no target to drag items into.
  const set = c.addCategory(c.materialiseCategories(undefined, []), "Luggage", "\u{1F9F3}");
  const groups = c.groupByCategory([{ name: "bananas" }], set);

  const ids = groups.map((g) => g.category.id);
  assert.ok(ids.includes("luggage"), "a category you just made must appear");
  assert.deepEqual(groups.find((g) => g.category.id === "luggage").items, []);
  assert.equal(ids.includes("bakery"), false, "untouched empty built-ins stay hidden");
});

test("a renamed or re-emoji'd built-in stays visible while empty", () => {
  const renamed = c.renameCategory(c.materialiseCategories(undefined, []), "produce", "Fruit");
  assert.ok(
    c.groupByCategory([], renamed).some((g) => g.category.id === "produce"),
    "renaming signals intent to use it"
  );

  const re_emoji = c.setCategoryEmoji(c.materialiseCategories(undefined, []), "bakery", "\u{1F950}");
  assert.ok(c.groupByCategory([], re_emoji).some((g) => g.category.id === "bakery"));
});

test("every user-made category is visible before anything is filed; empty Other is not", () => {
  const groups = c.groupByCategory([], packingSet());
  assert.deepEqual(
    groups.map((g) => g.category.id),
    ["luggage", "clothes", "electronics"],
    "an empty Other bucket is noise — it appears only once something lands in it"
  );
});

test("groupByCategory keeps every item exactly once", () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ name: `item-${i}` }));
  const groups = c.groupByCategory(items, c.resolveCategories(undefined));
  const seen = groups.flatMap((g) => g.items.map((i) => i.name));
  assert.equal(seen.length, items.length);
  assert.equal(new Set(seen).size, items.length);
});
