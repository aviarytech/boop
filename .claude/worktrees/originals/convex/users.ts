/**
 * User-related queries and mutations.
 * Provides user statistics and profile information.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Delete all data for a user (GDPR right to erasure).
 * Removes lists, items, tags, comments, activities, presence, publications,
 * categories, bookmarks, push tokens, referrals, feedback, subscriptions,
 * and the user record itself.
 */
export const deleteUserData = mutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return;

    const dids = [user.did, user.legacyDid].filter(Boolean) as string[];

    // Helper: delete all docs from a query result
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deleteAll = async (docs: { _id: any }[]) => {
      for (const doc of docs) {
        await ctx.db.delete(doc._id);
      }
    };

    // Lists owned by user — cascade into list-level tables
    for (const did of dids) {
      const lists = await ctx.db
        .query("lists")
        .withIndex("by_owner", (q) => q.eq("ownerDid", did))
        .collect();

      for (const list of lists) {
        const listId = list._id;

        // Items
        const items = await ctx.db
          .query("items")
          .withIndex("by_list", (q) => q.eq("listId", listId))
          .collect();

        for (const item of items) {
          // Comments on items
          await deleteAll(
            await ctx.db.query("comments").withIndex("by_item", (q) => q.eq("itemId", item._id)).collect()
          );
          // Item assignees
          await deleteAll(
            await ctx.db.query("itemAssignees").withIndex("by_item", (q) => q.eq("itemId", item._id)).collect()
          );
          await ctx.db.delete(item._id);
        }

        // Tags
        await deleteAll(
          await ctx.db.query("tags").withIndex("by_list", (q) => q.eq("listId", listId)).collect()
        );
        // Activities
        await deleteAll(
          await ctx.db.query("activities").withIndex("by_list", (q) => q.eq("listId", listId)).collect()
        );
        // Presence
        await deleteAll(
          await ctx.db.query("presence").withIndex("by_list", (q) => q.eq("listId", listId)).collect()
        );
        // Publications
        await deleteAll(
          await ctx.db.query("publications").withIndex("by_list", (q) => q.eq("listId", listId)).collect()
        );
        // Bookmarks for this list (from any user)
        await deleteAll(
          await ctx.db.query("bookmarks").withIndex("by_list", (q) => q.eq("listId", listId)).collect()
        );
        // Bitcoin anchors
        await deleteAll(
          await ctx.db.query("bitcoinAnchors").withIndex("by_list", (q) => q.eq("listId", listId)).collect()
        );

        await ctx.db.delete(listId);
      }

      // Categories
      await deleteAll(
        await ctx.db.query("categories").withIndex("by_owner", (q) => q.eq("ownerDid", did)).collect()
      );
      // Bookmarks this user has saved
      await deleteAll(
        await ctx.db.query("bookmarks").withIndex("by_user", (q) => q.eq("userDid", did)).collect()
      );
      // Push subscriptions
      await deleteAll(
        await ctx.db.query("pushSubscriptions").withIndex("by_user", (q) => q.eq("userDid", did)).collect()
      );
      // Push tokens
      await deleteAll(
        await ctx.db.query("pushTokens").withIndex("by_user", (q) => q.eq("userDid", did)).collect()
      );
      // DID logs
      await deleteAll(
        await ctx.db.query("didLogs").withIndex("by_user_did", (q) => q.eq("userDid", did)).collect()
      );
      // List templates
      await deleteAll(
        await ctx.db.query("listTemplates").withIndex("by_owner", (q) => q.eq("ownerDid", did)).collect()
      );
    }

    // Referral codes and referrals
    const referralCodes = await ctx.db
      .query("referralCodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const code of referralCodes) {
      // Referrals that used this code
      await deleteAll(
        await ctx.db.query("referrals").filter((q) => q.eq(q.field("referralCodeId"), code._id)).collect()
      );
      await ctx.db.delete(code._id);
    }
    // Referrals where user was the referee
    await deleteAll(
      await ctx.db.query("referrals").withIndex("by_referee", (q) => q.eq("refereeId", userId)).collect()
    );

    // Feedback
    await deleteAll(
      await ctx.db.query("feedback").withIndex("by_user", (q) => q.eq("userId", userId)).collect()
    );

    // Subscriptions
    await deleteAll(
      await ctx.db.query("subscriptions").withIndex("by_user", (q) => q.eq("userId", userId)).collect()
    );

    // Auth sessions by email
    if (user.email) {
      await deleteAll(
        await ctx.db.query("authSessions").filter((q) => q.eq(q.field("email"), user.email)).collect()
      );
    }

    // Finally, delete the user record
    await ctx.db.delete(userId);
  },
});

/**
 * Look up display names for a list of DIDs.
 * Returns a map of DID -> { displayName, email }.
 */
export const getUsersByDids = query({
  args: {
    dids: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const result: Record<string, { displayName: string | null; email: string | null }> = {};

    for (const did of args.dids) {
      // Look up user by their DID
      const user = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("did"), did))
        .first();

      if (user) {
        result[did] = {
          displayName: user.displayName ?? user.email?.split('@')[0] ?? null,
          email: user.email ?? null,
        };
      } else {
        // Extract a short name from DID for display
        const shortName = did.includes(':') 
          ? did.split(':').pop()?.slice(0, 8) ?? 'Unknown'
          : did.slice(0, 8);
        result[did] = {
          displayName: shortName,
          email: null,
        };
      }
    }

    return result;
  },
});

/**
 * Get aggregate statistics for a user across all their lists.
 */
export const getUserStats = query({
  args: {
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userDid, legacyDid } = args;

    // Get all lists where user is owner
    const ownedLists = await ctx.db
      .query("lists")
      .filter((q) =>
        q.or(
          q.eq(q.field("ownerDid"), userDid),
          legacyDid ? q.eq(q.field("ownerDid"), legacyDid) : q.eq(1, 0)
        )
      )
      .collect();

    // Get bookmarked lists
    const didsToCheck = [userDid];
    if (legacyDid) didsToCheck.push(legacyDid);

    const bookmarkedListIds: Id<"lists">[] = [];
    for (const did of didsToCheck) {
      const bookmarks = await ctx.db
        .query("bookmarks")
        .withIndex("by_user", (q) => q.eq("userDid", did))
        .collect();
      bookmarkedListIds.push(...bookmarks.map((b) => b.listId));
    }

    const ownedListIds = new Set(ownedLists.map((l) => l._id));
    const sharedListIds = bookmarkedListIds.filter((id) => !ownedListIds.has(id));
    
    const allListIds = [...ownedListIds, ...sharedListIds];

    // Count items across all lists
    let totalItems = 0;
    let completedItems = 0;

    for (const listId of allListIds) {
      const items = await ctx.db
        .query("items")
        .withIndex("by_list", (q) => q.eq("listId", listId))
        .collect();

      totalItems += items.length;
      completedItems += items.filter((item) => item.checked).length;
    }

    return {
      totalLists: allListIds.length,
      ownedLists: ownedLists.length,
      sharedLists: sharedListIds.length,
      totalItems,
      completedItems,
      pendingItems: totalItems - completedItems,
    };
  },
});
