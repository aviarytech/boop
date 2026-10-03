/**
 * Billing module — Stripe subscription management.
 *
 * Queries and mutations for the freemium billing model:
 * - Free: up to 5 lists, 3 collaborators per list
 * - Pro ($5/mo or $48/yr): unlimited lists/collaborators, VCs, templates, export
 * - Team ($12/user/mo): everything in Pro + team workspace, admin, API
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Plan definitions (exported for frontend use)
// ---------------------------------------------------------------------------

export const PLANS = {
  free: { name: "Free", maxLists: 5, maxCollaborators: 3, vcIssuance: false, templates: false, export: false },
  pro: { name: "Pro", maxLists: Infinity, maxCollaborators: Infinity, vcIssuance: true, templates: true, export: true },
  team: { name: "Team", maxLists: Infinity, maxCollaborators: Infinity, vcIssuance: true, templates: true, export: true },
} as const;

export type Plan = keyof typeof PLANS;

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

/**
 * Get current subscription for a user by userId. Returns null for free tier.
 */
export const getUserSubscription = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
  },
});

/**
 * Get effective plan — defaults to "free" if no active subscription.
 * Also grants "pro" when a referral Pro credit is active (referralProUntil > now).
 */
export const getUserPlan = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<Plan> => {
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!sub || sub.status === "canceled" || sub.status === "past_due") {
      // Check referral Pro credit
      const user = await ctx.db.get(userId);
      if (user?.referralProUntil && user.referralProUntil > Date.now()) return "pro";
      return "free";
    }
    return sub.plan as Plan;
  },
});

// ---------------------------------------------------------------------------
// Internal queries (used by HTTP actions and other internal actions)
// ---------------------------------------------------------------------------

export const querySubscriptionByUserId = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
  },
});

export const querySubscriptionByStripeSubId = internalQuery({
  args: { stripeSubscriptionId: v.string() },
  handler: async (ctx, { stripeSubscriptionId }) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripeSubscriptionId", stripeSubscriptionId)
      )
      .first();
  },
});

// ---------------------------------------------------------------------------
// Internal mutations
// ---------------------------------------------------------------------------

export const upsertSubscription = internalMutation({
  args: {
    userId: v.id("users"),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.optional(v.string()),
    plan: v.union(v.literal("free"), v.literal("pro"), v.literal("team")),
    status: v.union(
      v.literal("active"),
      v.literal("canceled"),
      v.literal("past_due"),
      v.literal("trialing"),
      v.literal("incomplete")
    ),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    teamSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
    } else {
      await ctx.db.insert("subscriptions", { ...args, createdAt: now, updatedAt: now });
    }
  },
});

// ---------------------------------------------------------------------------
// Plan enforcement helper (imported by other Convex modules)
// ---------------------------------------------------------------------------

type DbCtx = {
  db: {
    query(table: "subscriptions"): {
      withIndex(
        name: "by_user",
        fn: (q: { eq(field: "userId", val: Id<"users">): unknown }) => unknown
      ): { first(): Promise<{ plan: string; status: string } | null> };
    };
  };
};

const PLAN_ORDER: Plan[] = ["free", "pro", "team"];

export async function requirePlan(ctx: DbCtx, userId: Id<"users">, minPlan: Plan): Promise<void> {
  const sub = await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();

  const currentPlan: Plan =
    sub && (sub.status === "active" || sub.status === "trialing")
      ? (sub.plan as Plan)
      : "free";

  if (PLAN_ORDER.indexOf(currentPlan) < PLAN_ORDER.indexOf(minPlan)) {
    throw new Error(`This feature requires the ${PLANS[minPlan].name} plan. Please upgrade at /pricing.`);
  }
}
