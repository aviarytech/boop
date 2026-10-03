import { canUserViewList } from "./lib/permissions";
import { actorMutation, actorQuery } from "./lib/authenticated";
/**
 * User-related queries and mutations.
 * Provides user statistics and profile information.
 */

import { v } from "convex/values";
import { query, internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";

/**
 * Delete all data for a user (GDPR right to erasure).
 * Removes lists, items, tags, comments, activities, presence, publications,
 * categories, bookmarks, push tokens, referrals, feedback, subscriptions,
 * and the user record itself.
 */
export const { public: deleteUserData, internal: deleteUserDataInternal } = actorMutation({
  resources: () => ({}),
  scope: "*",
  allowDeletingAccount: true,
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return;
    if (user.turnkeySubOrgId !== ctx.actor.turnkeySubOrgId || ctx.actor.viaApiKey) throw new Error("Not authorized to delete this account");

    await ctx.db.patch(userId, { deletionRequestedAt: Date.now() });
    await deleteUserBatch(ctx, user);
  },
});

/** Private continuation; no session token is needed after logout. */
export const continueUserDeletion = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<void> => {
    const user = await ctx.db.get(userId);
    if (!user || user.deletionRequestedAt === undefined) return;
    await deleteUserBatch(ctx, user);
  },
});

// Bound all cleanup reads, including arbitrary-size child records. Each step
// reads at most one parent, one item, and four child documents (each <=1 MiB).
const DELETE_BATCH_SIZE = 4;
async function deleteUserBatch(ctx: MutationCtx, user: Doc<"users">): Promise<void> {
  // Snapshot once, including when resuming a deletion started by an older build.
  // Retries must never replace the identities whose records need erasure.
  if (user.deletionDids === undefined) {
    const deletionDids = [...new Set([user.did, user.legacyDid].filter(Boolean) as string[])];
    await ctx.db.patch(user._id, { deletionDids });
    user = { ...user, deletionDids };
  }
  if (!await deleteUserStep(ctx, user)) {
    await ctx.scheduler.runAfter(0, internal.users.continueUserDeletion, { userId: user._id });
  }
}

async function deleteUserStep(ctx: MutationCtx, user: Doc<"users">): Promise<boolean> {
  const userId = user._id;
  const dids = user.deletionDids!;
  const drain = async (pending: Promise<{ _id: Id<TableNames> }[]>): Promise<boolean> => {
    const rows = await pending;
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length > 0;
  };

  for (const did of dids) {
    const list = await ctx.db.query("lists")
      .withIndex("by_owner", q => q.eq("ownerDid", did)).first();
    if (!list) continue;
    const listId = list._id;
    const item = await ctx.db.query("items")
      .withIndex("by_list", q => q.eq("listId", listId)).first();
    if (item) {
      if (await drain(ctx.db.query("comments").withIndex("by_item", q => q.eq("itemId", item._id)).take(DELETE_BATCH_SIZE))) return false;
      if (await drain(ctx.db.query("itemAssignees").withIndex("by_item", q => q.eq("itemId", item._id)).take(DELETE_BATCH_SIZE))) return false;
      await ctx.db.delete(item._id);
      return false;
    }
    for (const table of ["tags", "activities", "presence", "publications", "bookmarks", "bitcoinAnchors", "noteBodies", "listEnvelopes"] as const) {
      if (await drain(ctx.db.query(table).withIndex("by_list", q => q.eq("listId", listId)).take(DELETE_BATCH_SIZE))) return false;
    }
    await ctx.db.delete(listId);
    return false;
  }

  for (const did of dids) {
    for (const table of ["categories", "listTemplates"] as const) {
      if (await drain(ctx.db.query(table).withIndex("by_owner", q => q.eq("ownerDid", did)).take(DELETE_BATCH_SIZE))) return false;
    }
    for (const table of ["bookmarks", "pushSubscriptions", "pushTokens"] as const) {
      if (await drain(ctx.db.query(table).withIndex("by_user", q => q.eq("userDid", did)).take(DELETE_BATCH_SIZE))) return false;
    }
    if (await drain(ctx.db.query("didLogs").withIndex("by_user_did", q => q.eq("userDid", did)).take(DELETE_BATCH_SIZE))) return false;
  }
  const code = await ctx.db.query("referralCodes").withIndex("by_user", q => q.eq("userId", userId)).first();
  if (code) {
    if (await drain(ctx.db.query("referrals").withIndex("by_code", q => q.eq("referralCodeId", code._id)).take(DELETE_BATCH_SIZE))) return false;
    await ctx.db.delete(code._id);
    return false;
  }
  if (await drain(ctx.db.query("referrals").withIndex("by_referee", q => q.eq("refereeId", userId)).take(DELETE_BATCH_SIZE))) return false;
  for (const table of ["feedback", "subscriptions"] as const) {
    if (await drain(ctx.db.query(table).withIndex("by_user", q => q.eq("userId", userId)).take(DELETE_BATCH_SIZE))) return false;
  }
  if (user.email && await drain(ctx.db.query("authSessions").withIndex("by_email", q => q.eq("email", user.email!)).take(DELETE_BATCH_SIZE))) return false;
  // Receipts live for the account lifetime so old lost-response retries remain safe.
  if (await drain(ctx.db.query("offlineReceipts").withIndex("by_account_operation", q => q.eq("accountId", userId)).take(DELETE_BATCH_SIZE))) return false;
  if (await drain(ctx.db.query("replaySequences").withIndex("by_account", q => q.eq("accountId", userId)).take(DELETE_BATCH_SIZE))) return false;
  await ctx.db.delete(userId);
  return true;
}

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
export const { public: getUserStats, internal: getUserStatsInternal } = actorQuery({
  resources: () => ({}),
  scope: "items:read",
  args: {},
  handler: async (ctx) => {
    const { did: userDid, legacyDid } = ctx.actor;

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
    const sharedListIds: Id<"lists">[] = [];
    for (const id of new Set(bookmarkedListIds)) {
      if (!ownedListIds.has(id) && await canUserViewList(ctx, id, userDid, legacyDid)) sharedListIds.push(id);
    }
    
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
