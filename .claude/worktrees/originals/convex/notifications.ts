/**
 * Push notification management — queries & mutations (non-Node.js).
 * Actions that need Node.js are in notificationActions.ts.
 */

import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";

// ─── Token registration ─────────────────────────────────────────────

export const registerPushToken = mutation({
  args: {
    userDid: v.string(),
    token: v.string(),
    platform: v.union(v.literal("ios"), v.literal("android"), v.literal("web")),
    webPushKeys: v.optional(
      v.object({ p256dh: v.string(), auth: v.string() })
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        userDid: args.userDid,
        platform: args.platform,
        webPushKeys: args.webPushKeys,
      });
      return existing._id;
    }

    return await ctx.db.insert("pushTokens", {
      userDid: args.userDid,
      token: args.token,
      platform: args.platform,
      webPushKeys: args.webPushKeys,
      createdAt: Date.now(),
    });
  },
});

export const unregisterPushToken = mutation({
  args: {
    token: v.string(),
    userDid: v.string(),
  },
  handler: async (ctx, args) => {
    const tok = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (tok && tok.userDid === args.userDid) {
      await ctx.db.delete(tok._id);
    }
  },
});

// ─── Queries ─────────────────────────────────────────────────────────

export const hasSubscription = query({
  args: { userDid: v.string() },
  handler: async (ctx, args) => {
    const legacySub = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userDid", args.userDid))
      .first();
    if (legacySub) return true;

    const token = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userDid", args.userDid))
      .first();
    return token !== null;
  },
});

export const getUserSubscriptions = query({
  args: { userDid: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userDid", args.userDid))
      .collect();
  },
});

export const getTokensForUser = internalQuery({
  args: { userDid: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userDid", args.userDid))
      .collect();
  },
});

export const getTokensForList = internalQuery({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    // Get tokens for the list owner
    const list = await ctx.db.get(args.listId);
    if (!list) return [];

    const tokens = [];
    // Owner's tokens
    const ownerTokens = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userDid", list.ownerDid))
      .collect();
    tokens.push(...ownerTokens);

    // Tokens for users who bookmarked this list
    const bookmarks = await ctx.db.query("bookmarks").collect();
    for (const bm of bookmarks) {
      if (bm.listId === args.listId && bm.userDid !== list.ownerDid) {
        const userTokens = await ctx.db
          .query("pushTokens")
          .withIndex("by_user", (q) => q.eq("userDid", bm.userDid))
          .collect();
        tokens.push(...userTokens);
      }
    }
    return tokens;
  },
});

// ─── Legacy compatibility ────────────────────────────────────────────

export const saveSubscription = mutation({
  args: {
    userDid: v.string(),
    endpoint: v.string(),
    keys: v.object({ p256dh: v.string(), auth: v.string() }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { userDid: args.userDid, keys: args.keys });
      return existing._id;
    }
    return await ctx.db.insert("pushSubscriptions", {
      userDid: args.userDid,
      endpoint: args.endpoint,
      keys: args.keys,
      createdAt: Date.now(),
    });
  },
});

export const removeSubscription = mutation({
  args: { endpoint: v.string(), userDid: v.string() },
  handler: async (ctx, args) => {
    const sub = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .first();
    if (sub && sub.userDid === args.userDid) {
      await ctx.db.delete(sub._id);
    }
  },
});
