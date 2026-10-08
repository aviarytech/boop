import { actorQuery } from "./lib/authenticated";
import { withoutCredential } from "./lib/actor";
import { v } from "convex/values";

// Activity rows are written only by the server operations they describe; a public
// writer let editors fabricate assignment/reconciliation history.

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
    return sorted.slice(0, Math.max(1, Math.min(args.limit ?? 50, 200))).map(withoutCredential);
  },
});
