/**
 * Dev-only helpers — run via `npx convex run` to patch state from the CLI.
 * Not exposed as `api.*`; only callable via the dashboard / `convex run`.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const grantSubscription = internalMutation({
  args: {
    email: v.optional(v.string()),
    did: v.optional(v.string()),
    plan: v.optional(v.union(v.literal("pro"), v.literal("team"))),
    durationDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!args.email && !args.did) {
      throw new Error("Provide either `email` or `did`.");
    }

    const user = args.email
      ? await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", args.email!))
          .first()
      : await ctx.db
          .query("users")
          .withIndex("by_did", (q) => q.eq("did", args.did!))
          .first();

    if (!user) {
      throw new Error(
        `User not found for ${args.email ? `email=${args.email}` : `did=${args.did}`}`
      );
    }

    const now = Date.now();
    const plan = args.plan ?? "pro";
    const periodEnd = now + (args.durationDays ?? 365) * ONE_DAY_MS;

    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        plan,
        status: "active",
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        updatedAt: now,
      });
      return {
        action: "updated" as const,
        subscriptionId: existing._id,
        userId: user._id,
        plan,
        periodEnd,
      };
    }

    const subscriptionId = await ctx.db.insert("subscriptions", {
      userId: user._id,
      stripeCustomerId: `dev_${user._id}`,
      plan,
      status: "active",
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    });
    return {
      action: "created" as const,
      subscriptionId,
      userId: user._id,
      plan,
      periodEnd,
    };
  },
});

export const revokeSubscription = internalMutation({
  args: {
    email: v.optional(v.string()),
    did: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.email && !args.did) {
      throw new Error("Provide either `email` or `did`.");
    }

    const user = args.email
      ? await ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", args.email!))
          .first()
      : await ctx.db
          .query("users")
          .withIndex("by_did", (q) => q.eq("did", args.did!))
          .first();

    if (!user) throw new Error("User not found");

    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!sub) return { action: "noop" as const };

    await ctx.db.patch(sub._id, { status: "canceled", updatedAt: Date.now() });
    return { action: "canceled" as const, subscriptionId: sub._id };
  },
});

export const inspectSites = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sites = await ctx.db.query("sites").collect();
    return await Promise.all(
      sites.map(async (site) => {
        const file = await ctx.db.get(site.fileId);
        const primaryHostname = site.primaryHostnameId
          ? await ctx.db.get(site.primaryHostnameId)
          : null;
        return {
          siteId: site._id,
          hostname: primaryHostname?.hostname ?? null,
          fileId: site.fileId,
          fileBucketKey: file?.bucketKey ?? null,
          fileLegacyStorageId: file?.storageId ?? null,
          fileSha256: file?.sha256 ?? null,
        };
      })
    );
  },
});

