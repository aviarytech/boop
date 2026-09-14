import { actorMutation, actorQuery } from "./lib/authenticated";
import { v } from "convex/values";

import { canUserEditList } from "./lib/permissions";

export const { public: recordActivity, internal: recordActivityInternal } = actorMutation({
  resources: args => ({ lists: [args.listId], items: [args.itemId] }),
  scope: "items:write",
  args: {
    listId: v.id("lists"),
    itemId: v.optional(v.id("items")),
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
    const canEdit = await canUserEditList(ctx, args.listId, ctx.actor.did, ctx.actor.legacyDid);
    if (!canEdit) throw new Error("Not authorized to write activity");

    return await ctx.db.insert("activities", {
      listId: args.listId,
      itemId: args.itemId,
      actorDid: ctx.actor.did,
      type: args.type,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
  },
});

export const { public: getListActivity, internal: getListActivityInternal } = actorQuery({
  resources: args => ({ lists: [args.listId] }),
  scope: "items:read",
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
