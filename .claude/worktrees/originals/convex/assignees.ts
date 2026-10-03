import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { canUserEditList } from "./lib/permissions";

export const assignItem = mutation({
  args: {
    itemId: v.id("items"),
    assigneeDid: v.string(),
    actorDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found");

    const canEdit = await canUserEditList(ctx, item.listId, args.actorDid, args.legacyDid);
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
        assignedByDid: args.actorDid,
        assignedAt: now,
      });

      await ctx.db.insert("activities", {
        listId: item.listId,
        itemId: args.itemId,
        actorDid: args.actorDid,
        type: "item_assigned",
        metadata: { assigneeDid: args.assigneeDid },
        createdAt: now,
      });
    }

    return { success: true };
  },
});

export const unassignItem = mutation({
  args: {
    itemId: v.id("items"),
    assigneeDid: v.string(),
    actorDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found");

    const canEdit = await canUserEditList(ctx, item.listId, args.actorDid, args.legacyDid);
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
        actorDid: args.actorDid,
        type: "item_unassigned",
        metadata: { assigneeDid: args.assigneeDid },
        createdAt: now,
      });
    }

    return { success: true };
  },
});

export const getItemAssignees = query({
  args: { itemId: v.id("items") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("itemAssignees")
      .withIndex("by_item", (q) => q.eq("itemId", args.itemId))
      .collect();
  },
});
