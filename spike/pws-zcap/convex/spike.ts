// THROWAWAY spike code (#286). Stand-in for boop's didLogs table.
import { v } from "convex/values";
import { internalQuery, mutation } from "./_generated/server";

export const seed = mutation({
  args: { did: v.string(), document: v.string() },
  handler: async (ctx, args) => {
    for (const row of await ctx.db.query("owners").collect()) await ctx.db.delete(row._id);
    await ctx.db.insert("owners", args);
  },
});

export const owner = internalQuery({ args: {}, handler: async ctx => ctx.db.query("owners").first() });
