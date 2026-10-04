import { assignmentRows, changeAssignments, reconcileAssignments } from "./lib/assignments";
import { internalMutation } from "./_generated/server";
import { actorMutation, actorQuery } from "./lib/authenticated";
import { v } from "convex/values";

import { canUserEditList } from "./lib/permissions";

export const { public: assignItem, internal: assignItemInternal } = actorMutation({
  resources: args => ({ items: [args.itemId] }),
  scope: "items:write",
  args: {
    itemId: v.id("items"),
    assigneeDid: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found");

    const canEdit = await canUserEditList(ctx, item.listId, ctx.actor.did, ctx.actor.legacyDid);
    if (!canEdit) throw new Error("Not authorized to assign item");

    await changeAssignments(ctx, item, ctx.actor.did, { add: args.assigneeDid });

    return { success: true };
  },
});

export const { public: unassignItem, internal: unassignItemInternal } = actorMutation({
  resources: args => ({ items: [args.itemId] }),
  scope: "items:write",
  args: {
    itemId: v.id("items"),
    assigneeDid: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found");

    const canEdit = await canUserEditList(ctx, item.listId, ctx.actor.did, ctx.actor.legacyDid);
    if (!canEdit) throw new Error("Not authorized to unassign item");

    await changeAssignments(ctx, item, ctx.actor.did, { remove: args.assigneeDid });

    return { success: true };
  },
});

export const { public: getItemAssignees, internal: getItemAssigneesInternal } = actorQuery({
  resources: args => ({ items: [args.itemId] }),
  scope: "items:read",
  args: { itemId: v.id("items") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found");
    return assignmentRows(ctx, item);
  },
});

/** Operator-selected batches only; never scheduled or called by a public client. */
export const reconcileBatch = internalMutation({
  args: { itemIds: v.array(v.id("items")) },
  handler: async (ctx, args) => {
    if (args.itemIds.length > 25) throw new Error("At most 25 items per reconciliation batch");
    const results = [];
    for (const itemId of new Set(args.itemIds)) {
      const item = await ctx.db.get(itemId);
      if (!item) { results.push({ itemId, missing: true }); continue; }
      const rows = await ctx.db.query("itemAssignees").withIndex("by_item", q => q.eq("itemId", itemId)).take(101);
      if (rows.length > 100) throw new Error("Large assignment set requires a separately reviewed migration batch");
      results.push({ itemId, ...await reconcileAssignments(ctx, item) });
    }
    return results;
  },
});

/** Explicit bounded repair for old deletion orphans. Never removes a live row. */
export const cleanupOrphanRows = internalMutation({
  args: { rowIds: v.array(v.id("itemAssignees")) },
  handler: async (ctx, args) => {
    if (args.rowIds.length > 100) throw new Error("At most 100 orphan candidates per batch");
    const deleted = [];
    for (const id of new Set(args.rowIds)) {
      const row = await ctx.db.get(id);
      if (row && !await ctx.db.get(row.itemId)) { await ctx.db.delete(id); deleted.push(id); }
    }
    return deleted;
  },
});
