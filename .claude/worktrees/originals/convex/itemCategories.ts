/**
 * Mutations for a list's item categories.
 *
 * Every edit follows the same shape: materialise the list's set (a no-op once it
 * owns one), apply a pure operation from lib/itemCategories, and persist. The
 * rules live in that shared module so the server enforces exactly what the UI
 * shows rather than a second, drifting copy.
 */

import { v } from "convex/values";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { canUserEditList } from "./lib/permissions";
import {
  type Category,
  OTHER_CATEGORY_ID,
  addCategory,
  deleteCategory,
  materialiseCategories,
  moveCategory,
  renameCategory,
  setCategoryEmoji,
} from "./lib/itemCategories";

const editorArgs = {
  listId: v.id("lists"),
  userDid: v.string(),
};

/**
 * Loads the list, checks edit rights, and returns its materialised set. Anyone
 * who can edit the list can edit its categories — they can already add and
 * reclassify items, so restricting this to the owner would be inconsistent.
 */
async function loadEditableSet(
  ctx: MutationCtx,
  listId: Id<"lists">,
  userDid: string
): Promise<Category[]> {
  const list = await ctx.db.get(listId);
  if (!list) throw new Error("List not found");
  if (!(await canUserEditList(ctx, listId, userDid))) {
    throw new Error("You do not have permission to edit this list");
  }
  return materialiseCategories(list.itemCategories, list.customAisles);
}

async function persist(
  ctx: MutationCtx,
  listId: Id<"lists">,
  categories: Category[]
): Promise<void> {
  await ctx.db.patch(listId, { itemCategories: categories });
}

export const addListCategory = mutation({
  args: { ...editorArgs, name: v.string(), emoji: v.string() },
  handler: async (ctx, args) => {
    const set = await loadEditableSet(ctx, args.listId, args.userDid);
    await persist(ctx, args.listId, addCategory(set, args.name, args.emoji));
  },
});

export const renameListCategory = mutation({
  args: { ...editorArgs, categoryId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const set = await loadEditableSet(ctx, args.listId, args.userDid);
    await persist(ctx, args.listId, renameCategory(set, args.categoryId, args.name));
  },
});

export const setListCategoryEmoji = mutation({
  args: { ...editorArgs, categoryId: v.string(), emoji: v.string() },
  handler: async (ctx, args) => {
    const set = await loadEditableSet(ctx, args.listId, args.userDid);
    await persist(ctx, args.listId, setCategoryEmoji(set, args.categoryId, args.emoji));
  },
});

export const moveListCategory = mutation({
  args: {
    ...editorArgs,
    categoryId: v.string(),
    direction: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, args) => {
    const set = await loadEditableSet(ctx, args.listId, args.userDid);
    await persist(ctx, args.listId, moveCategory(set, args.categoryId, args.direction));
  },
});

export const deleteListCategory = mutation({
  args: { ...editorArgs, categoryId: v.string() },
  handler: async (ctx, args) => {
    const set = await loadEditableSet(ctx, args.listId, args.userDid);
    const next = deleteCategory(set, args.categoryId);

    // Items explicitly filed here would otherwise point at a category that no
    // longer exists. The client degrades those to Other on read, but leaving the
    // stale id behind would resurrect the group if the name were ever reused.
    const items = await ctx.db
      .query("items")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();
    let reassigned = 0;
    for (const item of items) {
      if (item.groceryAisle === args.categoryId) {
        await ctx.db.patch(item._id, { groceryAisle: OTHER_CATEGORY_ID });
        reassigned += 1;
      }
    }

    await persist(ctx, args.listId, next);
    return { reassigned };
  },
});
