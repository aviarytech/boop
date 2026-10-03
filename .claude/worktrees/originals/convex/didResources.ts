/**
 * Queries for serving list resources publicly.
 *
 * These are used by the HTTP handlers to serve lists as Originals resources
 * at /{userPath}/resources/list-{id}.
 */

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Get a list by its Convex ID, verifying ownership by DID.
 * Returns null if not found or owner doesn't match.
 */
export const getPublicList = query({
  args: {
    listId: v.string(),
    ownerDid: v.string(),
  },
  handler: async (ctx, args) => {
    // Try to normalize the listId to a Convex ID
    let list;
    try {
      list = await ctx.db.get(args.listId as Id<"lists">);
    } catch {
      // Invalid ID format
      return null;
    }

    if (!list || list.ownerDid !== args.ownerDid) {
      return null;
    }

    return list;
  },
});

/**
 * Get all items for a list (public view — no auth required).
 * Only returns non-sensitive fields.
 */
export const getPublicListItems = query({
  args: {
    listId: v.id("lists"),
  },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("items")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();

    // Sort by order, then createdAt
    items.sort((a, b) => {
      if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
      if (a.order !== undefined) return -1;
      if (b.order !== undefined) return 1;
      return a.createdAt - b.createdAt;
    });

    // Only return top-level items (no sub-items) for the resource view
    return items
      .filter((item) => !item.parentId)
      .map((item) => ({
        _id: item._id,
        name: item.name,
        checked: item.checked,
        createdAt: item.createdAt,
        checkedAt: item.checkedAt,
        description: item.description,
        priority: item.priority,
        dueDate: item.dueDate,
        order: item.order,
      }));
  },
});

/**
 * Get a list by ID without owner check (used as fallback for legacy users
 * who don't have didLogs rows yet).
 */
export const getListById = query({
  args: { listId: v.string() },
  handler: async (ctx, args) => {
    try {
      return await ctx.db.get(args.listId as Id<"lists">);
    } catch {
      return null;
    }
  },
});

/**
 * Get active publication for a list.
 */
export const getActivePublicationByListId = query({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const pub = await ctx.db
      .query("publications")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .first();

    if (!pub || pub.status !== "active") return null;
    return pub;
  },
});

/**
 * Mark a shared-list item as checked (public link access).
 */
export const checkSharedItem = mutation({
  args: {
    listId: v.id("lists"),
    itemId: v.id("items"),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.listId !== args.listId) {
      throw new Error("Item not found");
    }

    await ctx.db.patch(args.itemId, {
      checked: true,
      checkedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

/**
 * Mark a shared-list item as unchecked (public link access).
 */
export const uncheckSharedItem = mutation({
  args: {
    listId: v.id("lists"),
    itemId: v.id("items"),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.listId !== args.listId) {
      throw new Error("Item not found");
    }

    await ctx.db.patch(args.itemId, {
      checked: false,
      checkedAt: undefined,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});
