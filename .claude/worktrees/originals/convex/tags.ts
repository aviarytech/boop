/**
 * Tag management for categorizing items.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Helper to check if a user can edit a list (owner or editor).
 */
async function canUserEditList(
  ctx: MutationCtx | QueryCtx,
  listId: Id<"lists">,
  userDid: string,
  legacyDid?: string
): Promise<boolean> {
  const list = await ctx.db.get(listId);
  if (!list) return false;

  const dids = [userDid];
  if (legacyDid) dids.push(legacyDid);

  if (dids.includes(list.ownerDid)) return true;

  const pub = await ctx.db
    .query("publications")
    .withIndex("by_list", (q) => q.eq("listId", listId))
    .first();

  return pub?.status === "active";
}

// Predefined tag colors
export const TAG_COLORS = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#6b7280", // gray
];

/**
 * Create a new tag for a list.
 */
export const createTag = mutation({
  args: {
    listId: v.id("lists"),
    name: v.string(),
    color: v.string(),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const canEdit = await canUserEditList(ctx, args.listId, args.userDid, args.legacyDid);
    if (!canEdit) {
      throw new Error("Not authorized to create tags for this list");
    }

    // Check if tag with same name already exists
    const existing = await ctx.db
      .query("tags")
      .withIndex("by_list_name", (q) => q.eq("listId", args.listId).eq("name", args.name))
      .first();

    if (existing) {
      throw new Error("A tag with this name already exists");
    }

    return await ctx.db.insert("tags", {
      listId: args.listId,
      name: args.name,
      color: args.color,
      createdByDid: args.userDid,
      createdAt: Date.now(),
    });
  },
});

/**
 * Update a tag's name or color.
 */
export const updateTag = mutation({
  args: {
    tagId: v.id("tags"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tag = await ctx.db.get(args.tagId);
    if (!tag) throw new Error("Tag not found");

    const canEdit = await canUserEditList(ctx, tag.listId, args.userDid, args.legacyDid);
    if (!canEdit) {
      throw new Error("Not authorized to update this tag");
    }

    const updates: Partial<Doc<"tags">> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.color !== undefined) updates.color = args.color;

    await ctx.db.patch(args.tagId, updates);
    return args.tagId;
  },
});

/**
 * Delete a tag and remove it from all items.
 */
export const deleteTag = mutation({
  args: {
    tagId: v.id("tags"),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tag = await ctx.db.get(args.tagId);
    if (!tag) throw new Error("Tag not found");

    const canEdit = await canUserEditList(ctx, tag.listId, args.userDid, args.legacyDid);
    if (!canEdit) {
      throw new Error("Not authorized to delete this tag");
    }

    // Remove tag from all items that have it
    const items = await ctx.db
      .query("items")
      .withIndex("by_list", (q) => q.eq("listId", tag.listId))
      .collect();

    for (const item of items) {
      if (item.tags?.includes(args.tagId)) {
        await ctx.db.patch(item._id, {
          tags: item.tags.filter((t) => t !== args.tagId),
        });
      }
    }

    await ctx.db.delete(args.tagId);
  },
});

/**
 * Get all tags for a list.
 */
export const getListTags = query({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tags")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();
  },
});

/**
 * Add a tag to an item.
 */
export const addTagToItem = mutation({
  args: {
    itemId: v.id("items"),
    tagId: v.id("tags"),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found");

    const canEdit = await canUserEditList(ctx, item.listId, args.userDid, args.legacyDid);
    if (!canEdit) {
      throw new Error("Not authorized to update this item");
    }

    const tag = await ctx.db.get(args.tagId);
    if (!tag || tag.listId !== item.listId) {
      throw new Error("Tag not found or belongs to different list");
    }

    const currentTags = item.tags ?? [];
    if (!currentTags.includes(args.tagId)) {
      await ctx.db.patch(args.itemId, {
        tags: [...currentTags, args.tagId],
        updatedAt: Date.now(),
      });
    }
  },
});

/**
 * Remove a tag from an item.
 */
export const removeTagFromItem = mutation({
  args: {
    itemId: v.id("items"),
    tagId: v.id("tags"),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found");

    const canEdit = await canUserEditList(ctx, item.listId, args.userDid, args.legacyDid);
    if (!canEdit) {
      throw new Error("Not authorized to update this item");
    }

    const currentTags = item.tags ?? [];
    await ctx.db.patch(args.itemId, {
      tags: currentTags.filter((t) => t !== args.tagId),
      updatedAt: Date.now(),
    });
  },
});
