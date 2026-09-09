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

    const existing = await ctx.db
      .query("itemAssignees")
      .withIndex("by_item_assignee", (q) => q.eq("itemId", args.itemId).eq("assigneeDid", args.assigneeDid))
      .first();

    if (!existing) {
      const now = Date.now();
      await ctx.db.insert("itemAssignees", {
        itemId: args.itemId,
        listId: item.listId,
        assigneeDid: args.assigneeDid,
        assignedByDid: ctx.actor.did,
        assignedAt: now,
      });

      await ctx.db.insert("activities", {
        listId: item.listId,
        itemId: args.itemId,
        actorDid: ctx.actor.did,
        type: "item_assigned",
        metadata: { assigneeDid: args.assigneeDid },
        createdAt: now,
      });
    }

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

    const existing = await ctx.db
      .query("itemAssignees")
      .withIndex("by_item_assignee", (q) => q.eq("itemId", args.itemId).eq("assigneeDid", args.assigneeDid))
      .first();

    if (existing) {
      const now = Date.now();
      await ctx.db.delete(existing._id);
      await ctx.db.insert("activities", {
        listId: item.listId,
        itemId: args.itemId,
        actorDid: ctx.actor.did,
        type: "item_unassigned",
        metadata: { assigneeDid: args.assigneeDid },
        createdAt: now,
      });
    }

    return { success: true };
  },
});

export const { public: getItemAssignees, internal: getItemAssigneesInternal } = actorQuery({
  resources: args => ({ items: [args.itemId] }),
  scope: "items:read",
  args: { itemId: v.id("items") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("itemAssignees")
      .withIndex("by_item", (q) => q.eq("itemId", args.itemId))
      .collect();
  },
});
