import { canUserEditList, canUserViewList } from "./lib/permissions";
import { actorQuery, actorMutation } from "./lib/authenticated";
import { resourceUnavailable } from "./lib/authError";
/**
 * Comments API - Threaded discussions on items for shared lists.
 * Enables collaboration through item-level comments.
 */

import { v } from "convex/values";

/**
 * Helper to check if a user can view a list.
 * Owner can always view. Published lists are viewable by anyone.
 */

/**
 * Helper to check if a user can edit a list.
 * Owner can always edit. Published lists are editable by anyone.
 */

/**
 * Get all comments for an item, ordered by creation time.
 */
export const { public: getItemComments, internal: getItemCommentsInternal } = actorQuery({
  resources: args => ({ items: [args.itemId] }),
  scope: "items:read",
  args: {
    itemId: v.id("items"),
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
      ctx.actor.did,
      ctx.actor.legacyDid
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
export const { public: addComment, internal: addCommentInternal } = actorMutation({
  resources: args => ({ items: [args.itemId] }),
  scope: "items:write",
  args: {
    itemId: v.id("items"),
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
      ctx.actor.did,
      ctx.actor.legacyDid
    );
    if (!canView) {
      throw new Error("Not authorized to comment on this item");
    }

    return await ctx.db.insert("comments", {
      itemId: args.itemId,
      userDid: ctx.actor.did,
      text: args.text.trim(),
      createdAt: Date.now(),
    });
  },
});

/**
 * Delete a comment.
 * Only the comment author or list owner/editor can delete.
 */
export const { public: deleteComment, internal: deleteCommentInternal } = actorMutation({
  resources: () => ({}),
  scope: "items:write",
  args: {
    commentId: v.id("comments"),
  },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment) {
      throw resourceUnavailable();
    }

    const item = await ctx.db.get(comment.itemId);
    if (!item) {
      throw resourceUnavailable();
    }

    const didsToCheck = [ctx.actor.did];
    if (ctx.actor.legacyDid) {
      didsToCheck.push(ctx.actor.legacyDid);
    }

    // Check if user is the comment author
    const isAuthor = didsToCheck.includes(comment.userDid);

    // Check if user can edit the list (owner or editor)
    const canEdit = await canUserEditList(
      ctx,
      item.listId,
      ctx.actor.did,
      ctx.actor.legacyDid
    );

    if (!isAuthor && !canEdit) {
      throw resourceUnavailable();
    }

    await ctx.db.delete(args.commentId);
  },
});

/**
 * Get comment count for an item (useful for showing badge on item).
 */
export const { public: getCommentCount, internal: getCommentCountInternal } = actorQuery({
  resources: args => ({ items: [args.itemId] }),
  scope: "items:read",
  args: { itemId: v.id("items") },
  handler: async (ctx, args) => {
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_item", (q) => q.eq("itemId", args.itemId))
      .collect();
    return comments.length;
  },
});
