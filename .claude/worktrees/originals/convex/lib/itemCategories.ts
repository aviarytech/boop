/**
 * Per-list item categories.
 *
 * A list either uses the built-in grocery set (the default, and what every list
 * started as) or owns an explicit set of its own. The moment someone edits
 * categories on a list, the set is MATERIALISED onto that list — from then on it
 * is the complete truth for that list and grocery aisles are no longer offered.
 * That is what lets a packing list stop being asked about Produce and Deli.
 *
 * Keyword auto-classification is kept, but gated on the guess being reachable:
 * a guessed category is used only if the list's set still contains it. So a
 * grocery list keeps auto-filing even after adding a category of its own, while
 * a packing list that has removed the grocery aisles stops guessing rather than
 * filing "Sunglasses" into Produce.
 *
 * Pure module — no Convex, no DOM, no keyword map — so both the client and the
 * mutations share one implementation of the rules.
 */



export interface Category {
  id: string;
  name: string;
  emoji: string;
  order: number;
}

/** Every set ends with this bucket. It cannot be renamed away or deleted. */
export const OTHER_CATEGORY_ID = "other";

export const MAX_CATEGORY_NAME_LENGTH = 40;

/** The built-in grocery set, used until a list materialises its own. */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: "produce", name: "Produce", emoji: "🥬", order: 0 },
  { id: "bakery", name: "Bakery", emoji: "🍞", order: 1 },
  { id: "deli", name: "Deli", emoji: "🥪", order: 2 },
  { id: "meat", name: "Meat & Seafood", emoji: "🥩", order: 3 },
  { id: "dairy", name: "Dairy & Eggs", emoji: "🥛", order: 4 },
  { id: "frozen", name: "Frozen", emoji: "🧊", order: 5 },
  { id: "beverages", name: "Beverages", emoji: "🥤", order: 6 },
  { id: "snacks", name: "Snacks", emoji: "🍿", order: 7 },
  { id: "canned", name: "Canned & Jarred", emoji: "🥫", order: 8 },
  { id: "pasta", name: "Pasta, Rice & Grains", emoji: "🍝", order: 9 },
  { id: "condiments", name: "Condiments & Sauces", emoji: "🫙", order: 10 },
  { id: "baking", name: "Baking", emoji: "🧁", order: 11 },
  { id: "breakfast", name: "Breakfast & Cereal", emoji: "🥣", order: 12 },
  { id: "household", name: "Household", emoji: "🧹", order: 13 },
  { id: "health", name: "Health & Personal Care", emoji: "🧴", order: 14 },
  { id: "other", name: "Other", emoji: "🛒", order: 99 },
];

/**
 * True for a built-in category the user has never touched.
 *
 * Drives visibility: an untouched default is hidden while empty (so a short
 * grocery list is not buried under 15 unused aisle headers), but anything the
 * user added, renamed or re-emoji'd stays visible even with no items — you
 * cannot drag an item into a category you cannot see.
 */
export function isPristineDefault(category: Category): boolean {
  const original = DEFAULT_CATEGORIES.find((d) => d.id === category.id);
  return !!original && original.name === category.name && original.emoji === category.emoji;
}

/** True once a list owns its categories and should not be offered grocery aisles. */
export function hasOwnCategories(categories: Category[] | undefined | null): boolean {
  return Array.isArray(categories) && categories.length > 0;
}

/** The set in effect for a list, always in display order. */
export function resolveCategories(categories: Category[] | undefined | null): Category[] {
  const set = hasOwnCategories(categories) ? categories! : DEFAULT_CATEGORIES;
  return [...set].sort((a, b) => a.order - b.order);
}

/**
 * The set a list should be given the first time its categories are edited.
 * Folds any legacy per-list aisles in after the defaults, preserving what the
 * list already displayed.
 */
export function materialiseCategories(
  categories: Category[] | undefined | null,
  legacyCustomAisles?: Category[] | null
): Category[] {
  if (hasOwnCategories(categories)) return resolveCategories(categories);

  const merged = [...DEFAULT_CATEGORIES];
  for (const aisle of legacyCustomAisles ?? []) {
    if (!merged.some((c) => c.id === aisle.id)) merged.push(aisle);
  }
  return normaliseOrder(withOtherLast(merged));
}

/** Renumbers `order` to 0..n-1 so it never drifts or collides. */
export function normaliseOrder(categories: Category[]): Category[] {
  return categories.map((category, index) => ({ ...category, order: index }));
}

/** Other always sorts last, wherever it ended up. */
function withOtherLast(categories: Category[]): Category[] {
  const rest = categories.filter((c) => c.id !== OTHER_CATEGORY_ID);
  const other = categories.find((c) => c.id === OTHER_CATEGORY_ID);
  return other ? [...rest, other] : [...rest, { id: OTHER_CATEGORY_ID, name: "Other", emoji: "🛒", order: rest.length }];
}

export class CategoryError extends Error {}

function assertEditable(id: string, action: string): void {
  if (id === OTHER_CATEGORY_ID) {
    throw new CategoryError(`The Other category cannot be ${action} — items need somewhere to land.`);
  }
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new CategoryError("Category name cannot be empty");
  if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) {
    throw new CategoryError(`Category name cannot exceed ${MAX_CATEGORY_NAME_LENGTH} characters`);
  }
  return trimmed;
}

/** Slug derived from the name, kept unique within the set. */
export function categoryIdFor(name: string, existing: Category[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "category";

  let candidate = base;
  let n = 2;
  while (existing.some((c) => c.id === candidate)) candidate = `${base}-${n++}`;
  return candidate;
}

export function addCategory(categories: Category[], name: string, emoji: string): Category[] {
  const clean = cleanName(name);
  if (categories.some((c) => c.name.toLowerCase() === clean.toLowerCase())) {
    throw new CategoryError(`A category named "${clean}" already exists`);
  }
  const added: Category = {
    id: categoryIdFor(clean, categories),
    name: clean,
    emoji: emoji.trim() || "🏷️",
    order: categories.length,
  };
  return normaliseOrder(withOtherLast([...categories, added]));
}

export function renameCategory(categories: Category[], id: string, name: string): Category[] {
  assertEditable(id, "renamed");
  const clean = cleanName(name);
  if (!categories.some((c) => c.id === id)) throw new CategoryError(`No category ${id}`);
  if (categories.some((c) => c.id !== id && c.name.toLowerCase() === clean.toLowerCase())) {
    throw new CategoryError(`A category named "${clean}" already exists`);
  }
  return categories.map((c) => (c.id === id ? { ...c, name: clean } : c));
}

export function setCategoryEmoji(categories: Category[], id: string, emoji: string): Category[] {
  if (!categories.some((c) => c.id === id)) throw new CategoryError(`No category ${id}`);
  const clean = emoji.trim() || "🏷️";
  return categories.map((c) => (c.id === id ? { ...c, emoji: clean } : c));
}

/**
 * Removes a category. Callers must reassign its items to OTHER_CATEGORY_ID —
 * this module only owns the category list.
 */
export function deleteCategory(categories: Category[], id: string): Category[] {
  assertEditable(id, "deleted");
  if (!categories.some((c) => c.id === id)) throw new CategoryError(`No category ${id}`);
  return normaliseOrder(withOtherLast(categories.filter((c) => c.id !== id)));
}

/** Moves a category one slot up or down. Other stays pinned last. */
export function moveCategory(categories: Category[], id: string, direction: "up" | "down"): Category[] {
  assertEditable(id, "reordered");
  const ordered = resolveCategories(categories);
  const movable = ordered.filter((c) => c.id !== OTHER_CATEGORY_ID);
  const index = movable.findIndex((c) => c.id === id);
  if (index === -1) throw new CategoryError(`No category ${id}`);

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= movable.length) return ordered; // already at the edge

  const next = [...movable];
  [next[index], next[target]] = [next[target], next[index]];
  return normaliseOrder(withOtherLast(next));
}
