import { resourceUnavailable } from "./lib/authError";
import { actorMutation } from "./lib/authenticated";
/**
 * Queries for serving list resources publicly.
 *
 * These are used by the HTTP handlers to serve lists as Originals resources
 * at /{userPath}/resources/list-{id}. They are internal: the HTTP handlers
 * project the public fields, while these return whole list documents.
 */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Get a list by its Convex ID, verifying ownership by DID.
 * Returns null if not found or owner doesn't match.
 */
export const getPublicList = internalQuery({
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

    const pub = await ctx.db.query("publications").withIndex("by_list", q => q.eq("listId", list._id)).first();
    return pub?.status === "active" ? list : null;
  },
});

/**
 * Get all items for a list (public view — no auth required).
 * Only returns non-sensitive fields.
 */
export const getPublicListItems = internalQuery({
  args: {
    listId: v.id("lists"),
  },
  handler: async (ctx, args) => {
    const pub = await ctx.db.query("publications").withIndex("by_list", q => q.eq("listId", args.listId)).first();
    if (pub?.status !== "active") return [];
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
 * Fallback for owners without a didLogs row at this path: a published list whose
 * publication DID names this path. The controller derived from that DID must be the
 * list owner's current or legacy DID, so one account's publication can never be
 * served under another account's path. Returns null for every failure.
 */
export const getPublishedListForPath = internalQuery({
  args: { listId: v.string(), userPath: v.string() },
  handler: async (ctx, args) => {
    let list;
    try {
      list = await ctx.db.get(args.listId as Id<"lists">);
    } catch {
      return null; // Invalid ID format
    }
    if (!list) return null;
    const pub = await ctx.db.query("publications").withIndex("by_list", q => q.eq("listId", list._id)).first();
    // Expected: did:webvh:{scid}:{domain}:{userPath}/resources/list-{listId}
    const suffix = `/resources/list-${list._id}`;
    if (pub?.status !== "active" || !pub.webvhDid.endsWith(`:${args.userPath}${suffix}`)) return null;
    const controllerDid = pub.webvhDid.slice(0, -suffix.length);
    if (list.ownerDid !== controllerDid) {
      const owner = await ctx.db.query("users").withIndex("by_did", q => q.eq("did", list.ownerDid)).first()
        ?? await ctx.db.query("users").withIndex("by_legacy_did", q => q.eq("legacyDid", list.ownerDid)).first();
      if (!owner || ![owner.did, owner.legacyDid].includes(controllerDid)) return null;
    }
    return { list, controllerDid };
  },
});

/**
 * Mark a shared-list item as checked (public link access).
 */
export const { public: checkSharedItem, internal: checkSharedItemInternal } = actorMutation({
  resources: args => ({ lists: [args.listId], items: [args.itemId] }),
  scope: "items:write",
  args: {
    listId: v.id("lists"),
    itemId: v.id("items"),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.listId !== args.listId) {
      throw resourceUnavailable();
    }

    await ctx.db.patch(args.itemId, {
      checked: true,
      checkedByDid: ctx.actor.did,
      checkedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

/**
 * Mark a shared-list item as unchecked (public link access).
 */
export const { public: uncheckSharedItem, internal: uncheckSharedItemInternal } = actorMutation({
  resources: args => ({ lists: [args.listId], items: [args.itemId] }),
  scope: "items:write",
  args: {
    listId: v.id("lists"),
    itemId: v.id("items"),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.listId !== args.listId) {
      throw resourceUnavailable();
    }

    await ctx.db.patch(args.itemId, {
      checked: false,
      checkedByDid: undefined,
      checkedAt: undefined,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});
