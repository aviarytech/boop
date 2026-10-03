import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { canUserEditList } from "./lib/permissions";

export const recordActivity = mutation({
  args: {
    listId: v.id("lists"),
    itemId: v.optional(v.id("items")),
    actorDid: v.string(),
    legacyDid: v.optional(v.string()),
    type: v.union(
      v.literal("item_assigned"),
      v.literal("item_unassigned"),
      v.literal("presence_heartbeat"),
      v.literal("presence_offline"),
      v.literal("item_updated"),
      v.literal("list_updated")
    ),
    metadata: v.optional(v.object({
      assigneeDid: v.optional(v.string()),
      status: v.optional(v.union(v.literal("active"), v.literal("idle"), v.literal("offline"))),
      note: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const canEdit = await canUserEditList(ctx, args.listId, args.actorDid, args.legacyDid);
    if (!canEdit) throw new Error("Not authorized to write activity");

    return await ctx.db.insert("activities", {
      listId: args.listId,
      itemId: args.itemId,
      actorDid: args.actorDid,
      type: args.type,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
  },
});

export const getListActivity = query({
  args: {
    listId: v.id("lists"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("activities")
      .withIndex("by_list_created", (q) => q.eq("listId", args.listId))
      .collect();

    const sorted = events.sort((a, b) => b.createdAt - a.createdAt);
    return sorted.slice(0, Math.max(1, Math.min(args.limit ?? 50, 200)));
  },
});
