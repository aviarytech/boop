import { canUserViewList } from "./lib/permissions";
import { actorMutation, actorQuery } from "./lib/authenticated";
/**
 * Push notification management — queries & mutations (non-Node.js).
 * Actions that need Node.js are in notificationActions.ts.
 */

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

// ─── Token registration ─────────────────────────────────────────────

export const { public: registerPushToken, internal: registerPushTokenInternal } = actorMutation({
  resources: () => ({}),
  scope: "*",
  args: {
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
        userDid: ctx.actor.did,
        platform: args.platform,
        webPushKeys: args.webPushKeys,
      });
      return existing._id;
    }

    return await ctx.db.insert("pushTokens", {
      userDid: ctx.actor.did,
      token: args.token,
      platform: args.platform,
      webPushKeys: args.webPushKeys,
      createdAt: Date.now(),
    });
  },
});

export const { public: unregisterPushToken, internal: unregisterPushTokenInternal } = actorMutation({
  resources: () => ({}),
  scope: "*",
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const tok = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (tok && [ctx.actor.did, ctx.actor.legacyDid].includes(tok.userDid)) {
      await ctx.db.delete(tok._id);
    }
  },
});

// ─── Queries ─────────────────────────────────────────────────────────

export const { public: hasSubscription, internal: hasSubscriptionInternal } = actorQuery({
  resources: () => ({}),
  scope: "*",
  args: {},
  handler: async (ctx) => {
    for (const did of [ctx.actor.did, ctx.actor.legacyDid].filter((did): did is string => !!did)) {
      const [subscription, token] = await Promise.all([
        ctx.db.query("pushSubscriptions").withIndex("by_user", q => q.eq("userDid", did)).first(),
        ctx.db.query("pushTokens").withIndex("by_user", q => q.eq("userDid", did)).first(),
      ]);
      if (subscription || token) return true;
    }
    return false;
  },
});

export const { public: getUserSubscriptions, internal: getUserSubscriptionsInternal } = actorQuery({
  resources: () => ({}),
  scope: "*",
  args: {},
  handler: async (ctx) => {
    const dids = [ctx.actor.did, ctx.actor.legacyDid].filter((did): did is string => !!did);
    return (await Promise.all(dids.map(did => ctx.db.query("pushTokens")
      .withIndex("by_user", q => q.eq("userDid", did)).collect()))).flat();
  },
});

export const getTokensForUser = internalQuery({
  args: { userDid: v.string(), listId: v.optional(v.id("lists")) },
  handler: async (ctx, args) => {
    if (args.listId && !await canUserViewList(ctx, args.listId, args.userDid)) return [];
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

    const recipients = new Set([list.ownerDid]);
    const grants = await ctx.db.query("listGrants")
      .withIndex("by_list_recipient", q => q.eq("listId", args.listId)).collect();
    for (const grant of grants) {
      const recipient = await ctx.db.get(grant.recipientId);
      if (recipient?.did) recipients.add(recipient.did);
    }
    const bookmarks = await ctx.db.query("bookmarks")
      .withIndex("by_list", q => q.eq("listId", args.listId)).collect();
    for (const bm of bookmarks) recipients.add(bm.userDid);
    const tokens = [];
    const seen = new Set<string>();
    for (const did of recipients) {
      // Recheck at scheduled-send lookup, not when the event was queued.
      const account = await ctx.db.query("users").withIndex("by_did", q => q.eq("did", did)).first()
        ?? await ctx.db.query("users").withIndex("by_legacy_did", q => q.eq("legacyDid", did)).first();
      if (!account?.did || account.deletionRequestedAt !== undefined
        || !await canUserViewList(ctx, args.listId, account.did, account.legacyDid)) continue;
      for (const identity of new Set([account.did, account.legacyDid].filter((id): id is string => !!id))) {
        const userTokens = await ctx.db.query("pushTokens").withIndex("by_user", q => q.eq("userDid", identity)).collect();
        for (const token of userTokens) if (!seen.has(token._id)) { seen.add(token._id); tokens.push(token); }
      }
    }
    return tokens;
  },
});

// ─── Legacy compatibility ────────────────────────────────────────────

export const { public: saveSubscription, internal: saveSubscriptionInternal } = actorMutation({
  resources: () => ({}),
  scope: "*",
  args: {
    endpoint: v.string(),
    keys: v.object({ p256dh: v.string(), auth: v.string() }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { userDid: ctx.actor.did, keys: args.keys });
      return existing._id;
    }
    return await ctx.db.insert("pushSubscriptions", {
      userDid: ctx.actor.did,
      endpoint: args.endpoint,
      keys: args.keys,
      createdAt: Date.now(),
    });
  },
});

export const { public: removeSubscription, internal: removeSubscriptionInternal } = actorMutation({
  resources: () => ({}),
  scope: "*",
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const sub = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint))
      .first();
    if (sub && [ctx.actor.did, ctx.actor.legacyDid].includes(sub.userDid)) {
      await ctx.db.delete(sub._id);
    }
  },
});
