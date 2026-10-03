/**
 * Comments API - Threaded discussions on items for shared lists.
 * Enables collaboration through item-level comments.
 */

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";

/**
 * Helper to check if a user can view a list.
 * Owner can always view. Published lists are viewable by anyone.
 */
async function canUserViewList(
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

  // Published lists are viewable by anyone
  const pub = await ctx.db
    .query("publications")
    .withIndex("by_list", (q) => q.eq("listId", listId))
    .first();

  return pub?.status === "active";
}

/**
 * Helper to check if a user can edit a list.
 * Owner can always edit. Published lists are editable by anyone.
 */
async function canUserEditList(
  ctx: MutationCtx | QueryCtx,
  listId: Id<"lists">,
  userDid: string,
  legacyDid?: string
): Promise<boolean> {
  return canUserViewList(ctx, listId, userDid, legacyDid);
}

/**
 * Get all comments for an item, ordered by creation time.
 */
export const getItemComments = query({
  args: {
    itemId: v.id("items"),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new Error("Item not found");
    }

    // Verify user can view this list
    const canView = await canUserViewList(
      ctx,
      item.listId,
      args.userDid,
      args.legacyDid
    );
    if (!canView) {
      throw new Error("Not authorized to view comments on this item");
    }

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_item", (q) => q.eq("itemId", args.itemId))
      .collect();

    // Sort by createdAt ascending (oldest first for a thread)
    return comments.sort((a, b) => a.createdAt - b.createdAt);
  },
});

/**
 * Add a comment to an item.
 * Any collaborator (owner, editor, or viewer) can comment.
 */
export const addComment = mutation({
  args: {
    itemId: v.id("items"),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.text.trim()) {
      throw new Error("Comment text cannot be empty");
    }

    const item = await ctx.db.get(args.itemId);
    if (!item) {
      throw new Error("Item not found");
    }

    // Verify user can view this list (any collaborator can comment)
    const canView = await canUserViewList(
      ctx,
      item.listId,
      args.userDid,
      args.legacyDid
    );
    if (!canView) {
      throw new Error("Not authorized to comment on this item");
    }

    return await ctx.db.insert("comments", {
      itemId: args.itemId,
      userDid: args.userDid,
      text: args.text.trim(),
      createdAt: Date.now(),
    });
  },
});

/**
 * Delete a comment.
 * Only the comment author or list owner/editor can delete.
 */
export const deleteComment = mutation({
  args: {
    commentId: v.id("comments"),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment) {
      throw new Error("Comment not found");
    }

    const item = await ctx.db.get(comment.itemId);
    if (!item) {
      throw new Error("Item not found");
    }

    const didsToCheck = [args.userDid];
    if (args.legacyDid) {
      didsToCheck.push(args.legacyDid);
    }

    // Check if user is the comment author
    const isAuthor = didsToCheck.includes(comment.userDid);

    // Check if user can edit the list (owner or editor)
    const canEdit = await canUserEditList(
      ctx,
      item.listId,
      args.userDid,
      args.legacyDid
    );

    if (!isAuthor && !canEdit) {
      throw new Error("Not authorized to delete this comment");
    }

    await ctx.db.delete(args.commentId);
  },
});

/**
 * Get comment count for an item (useful for showing badge on item).
 */
export const getCommentCount = query({
  args: { itemId: v.id("items") },
  handler: async (ctx, args) => {
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_item", (q) => q.eq("itemId", args.itemId))
      .collect();
    return comments.length;
  },
});
