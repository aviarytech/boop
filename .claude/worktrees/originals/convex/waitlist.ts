import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const joinWaitlist = mutation({
  args: {
    email: v.string(),
    source: v.optional(v.string()),
  },
  handler: async (ctx, { email, source }) => {
    const normalized = email.trim().toLowerCase();

    // Basic format check
    if (!normalized.includes("@") || normalized.length < 5) {
      throw new Error("Invalid email address");
    }

    // Deduplicate
    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) => q.eq("email", normalized))
      .first();

    if (existing) {
      return { alreadyJoined: true };
    }

    await ctx.db.insert("waitlist", {
      email: normalized,
      source: source ?? "landing_page",
      createdAt: Date.now(),
    });

    return { alreadyJoined: false };
  },
});
