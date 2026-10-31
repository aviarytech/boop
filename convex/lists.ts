import { withAssignmentsBatch } from "./lib/assignments";
import { resourceUnavailable } from "./lib/authError";
import { actorMutation, actorQuery } from "./lib/authenticated";
import { v } from "convex/values";

import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { withMutationObservability } from "./lib/observability";
import { hasScope } from "./lib/apiKeyHelpers";
import { canUserEditList, canUserViewList } from "./lib/permissions";
import { isNote } from "./lib/noteBody";
import { deleteActionRecords, listCreated, listRenamed, recordActions } from "./lib/actionRecords";

/**
 * Create a new list.
 */
/**
 * Free-plan list cap, shared by every path that inserts a list.
 *
 * Extracted rather than inlined so no creation path (lists, templates) can
 * become a way around the limit.
 */
export async function assertListQuota(
  ctx: MutationCtx,
  ownerDid: string
): Promise<{ owner: Doc<"users"> | null; isFirstList: boolean }> {
  const owner = await ctx.db
    .query("users")
    .withIndex("by_did", (q) => q.eq("did", ownerDid))
    .first();

  if (!owner) return { owner: null, isFirstList: false };

  const sub = await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (q) => q.eq("userId", owner._id))
    .first();
  const hasPaidSub = sub && (sub.status === "active" || sub.status === "trialing");
  const hasReferralPro = !hasPaidSub && owner.referralProUntil != null && owner.referralProUntil > Date.now();
  const plan = hasPaidSub ? sub.plan : (hasReferralPro ? "pro" : "free");

  // Notes never consume the free-plan cap.
  const existingLists = (await ctx.db
    .query("lists")
    .withIndex("by_owner", (q) => q.eq("ownerDid", ownerDid))
    .collect()).filter((list) => !isNote(list));

  if (plan === "free") {
    const bonusLists = owner.bonusLists ?? 0;
    const maxLists = 5 + bonusLists;
    if (existingLists.length >= maxLists) {
      throw new Error("PLAN_LIMIT: You've reached the free plan limit of 5 lists. Upgrade at /pricing to create unlimited lists.");
    }
  }

  return { owner, isFirstList: existingLists.length === 0 };
}

/** Lists may only be filed in the actor's own categories; another account's
 * category ID would let that account's later category writes touch this list.
 * Returns the category to store: on create, a category deleted meanwhile (e.g. on
 * another device) leaves the new list uncategorized instead of failing. */
async function ownCategory(ctx: MutationCtx, actor: { did: string; legacyDid?: string }, categoryId: Id<"categories"> | undefined, { dropMissing = false } = {}) {
  if (!categoryId) return undefined;
  const category = await ctx.db.get(categoryId);
  if (!category && dropMissing) return undefined;
  if (!category || ![actor.did, actor.legacyDid].includes(category.ownerDid)) throw resourceUnavailable();
  return categoryId;
}

/** Shared transaction-local first-list benefit for every template/list entry point. */
export async function grantFirstListReferral(ctx: MutationCtx, owner: Doc<"users"> | null, isFirstList: boolean) {
  // Award 30-day referral Pro to both referee and referrer on first list creation
  if (owner && isFirstList) {
    const referral = await ctx.db
      .query("referrals")
      .withIndex("by_referee", (q) => q.eq("refereeId", owner._id))
      .first();
    if (referral && !referral.proGrantedAt) {
      const proUntil = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
      await ctx.db.patch(owner._id, { referralProUntil: proUntil });
      await ctx.db.patch(referral.referrerId, { referralProUntil: proUntil });
      await ctx.db.patch(referral._id, { proGrantedAt: Date.now() });
    }
  }

}

export const { public: createList, internal: createListInternal, replay: createListReplay } = actorMutation({
  offlineOperation: "createList",
  resources: () => ({}),
  scope: "items:write",
  args: {
    name: v.string(),
    categoryId: v.optional(v.id("categories")),
    createdAt: v.number(),
    // Sent by clients from before Originals 5, whose creates may still sit in
    // an offline queue. Ignored: the owner's device mints the list's Original
    // when the list is opened (originalsHost.ts).
    assetDid: v.optional(v.string()),
    celEnvelope: v.optional(v.string()),
    kind: v.optional(v.literal("note")),
  },
  handler: async (ctx, args) => withMutationObservability("lists.createList", async () => {
    // Input validation
    if (args.name.trim().length === 0) throw new Error("List name cannot be empty");
    if (args.name.length > 200) throw new Error("List name cannot exceed 200 characters");

    const categoryId = await ownCategory(ctx, ctx.actor, args.categoryId, { dropMissing: true });

    // Notes are uncapped and are not a "first list" for the referral grant.
    const { owner, isFirstList } = args.kind === "note"
      ? { owner: null, isFirstList: false }
      : await assertListQuota(ctx, ctx.actor.did);

    const listId = await ctx.db.insert("lists", {
      name: args.name,
      ownerDid: ctx.actor.did,
      categoryId,
      createdAt: args.createdAt,
      kind: args.kind,
      noteSummary: args.kind === "note"
        ? { excerpt: "", wordCount: 0, updatedAt: args.createdAt }
        : undefined,
    });

    if (args.kind === "note") {
      await ctx.db.insert("noteBodies", { listId, body: "", updatedAt: args.createdAt });
    }

    await recordActions(ctx, [listCreated({ _id: listId, name: args.name, kind: args.kind })]);

    await grantFirstListReferral(ctx, owner, isFirstList);

    return listId;
  }),
});

/**
 * Rename a list. Only the owner can rename.
 */
export const { public: renameList, internal: renameListInternal, replay: renameListReplay } = actorMutation({
  authority: "owner",
  offlineOperation: "renameList",
  resources: args => ({ lists: [args.listId] }),
  scope: "items:write",
  args: {
    listId: v.id("lists"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error("List not found");

    const dids = [ctx.actor.did];
    if (ctx.actor.legacyDid) dids.push(ctx.actor.legacyDid);

    if (!dids.includes(list.ownerDid)) {
      throw resourceUnavailable();
    }

    // The historical vcProof is left as issued; the rename is its own record.
    await ctx.db.patch(args.listId, { name: args.name });
    await recordActions(ctx, [listRenamed(list, args.name)]);
  },
});

/**
 * Update the category of a list. Only owner can change.
 */
export const { public: updateListCategory, internal: updateListCategoryInternal } = actorMutation({
  authority: "owner",
  resources: args => ({ lists: [args.listId] }),
  scope: "items:write",
  args: {
    listId: v.id("lists"),
    categoryId: v.optional(v.id("categories")),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error("List not found");

    const dids = [ctx.actor.did];
    if (ctx.actor.legacyDid) dids.push(ctx.actor.legacyDid);

    if (!dids.includes(list.ownerDid)) {
      throw resourceUnavailable();
    }

    await ownCategory(ctx, ctx.actor, args.categoryId);

    await ctx.db.patch(args.listId, { categoryId: args.categoryId });
  },
});

/**
 * Get a list by its ID.
 */
export const { public: getList, internal: getListInternal } = actorQuery({
  resources: () => ({}),
  scope: "lists:read",
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list || !await canUserViewList(ctx, args.listId, ctx.actor.did, ctx.actor.legacyDid)) return null;
    return { ...list, canEdit: hasScope(ctx.actor.scopes, "items:write") && await canUserEditList(ctx, args.listId, ctx.actor.did, ctx.actor.legacyDid) };
  },
});

/**
 * Get a list plus its items, but only if the viewer may access it (list owner
 * by current or legacy DID, accepted recipient, or public reader). Returns null when
 * the list is missing OR access is denied — callers should surface null as a
 * 404 so a caller can't probe which list IDs exist. Used by the agent read API.
 * Internal: only the server-side agent read handler may call it, so the viewer
 * DID it trusts always comes from an authenticated actor, never a raw client.
 */
const listWithItemsOperation = actorQuery({
  // This read returns null for both missing and inaccessible lists (HTTP 404).
  resources: () => ({}),
  scope: "items:read",
  args: {
    listId: v.id("lists"),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) return null;

    const canView = await canUserViewList(
      ctx,
      args.listId,
      ctx.actor.did,
      ctx.actor.legacyDid
    );
    if (!canView) return null;

    const items = await ctx.db
      .query("items")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();
    items.sort(
      (a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt)
    );

    return { list, items: await withAssignmentsBatch(ctx, items) };
  },
});

/**
 * Discover owned lists, accepted shares, and currently readable bookmarks.
 */
export const { public: getUserLists, internal: getUserListsInternal } = actorQuery({
  resources: () => ({}),
  scope: "lists:read",
  args: {},
  handler: async (ctx) => {
    const didsToCheck = [ctx.actor.did];
    if (ctx.actor.legacyDid) didsToCheck.push(ctx.actor.legacyDid);

    const listMap = new Map<string, Doc<"lists">>();

    // Get lists where user is owner
    for (const did of didsToCheck) {
      const ownedLists = await ctx.db
        .query("lists")
        .withIndex("by_owner", (q) => q.eq("ownerDid", did))
        .collect();

      for (const list of ownedLists) {
        if (!listMap.has(list._id.toString())) {
          listMap.set(list._id.toString(), list);
        }
      }
    }

    const grants = await ctx.db.query("listGrants")
      .withIndex("by_recipient", q => q.eq("recipientId", ctx.actor.userId)).collect();
    for (const grant of grants) {
      const list = await ctx.db.get(grant.listId);
      if (list && await canUserViewList(ctx, list._id, ctx.actor.did, ctx.actor.legacyDid)) {
        listMap.set(list._id.toString(), list);
      }
    }

    // Get bookmarked lists
    for (const did of didsToCheck) {
      const bookmarks = await ctx.db
        .query("bookmarks")
        .withIndex("by_user", (q) => q.eq("userDid", did))
        .collect();

      for (const bookmark of bookmarks) {
        if (!listMap.has(bookmark.listId.toString())) {
          const list = await ctx.db.get(bookmark.listId);
          if (list && await canUserViewList(ctx, list._id, ctx.actor.did, ctx.actor.legacyDid)) {
            listMap.set(bookmark.listId.toString(), list);
          }
        }
      }
    }

    return Array.from(listMap.values()).sort(
      (a, b) => b.createdAt - a.createdAt
    );
  },
});

/**
 * Delete a list and all its items.
 * Only the owner can delete a list.
 */
export const { public: deleteList, internal: deleteListInternal, replay: deleteListReplay } = actorMutation({
  authority: "owner",
  offlineOperation: "deleteList",
  resources: args => ({ lists: [args.listId] }),
  scope: "items:write",
  args: {
    listId: v.id("lists"),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error("List not found");

    const dids = [ctx.actor.did];
    if (ctx.actor.legacyDid) dids.push(ctx.actor.legacyDid);

    if (!dids.includes(list.ownerDid)) {
      throw resourceUnavailable();
    }

    // Delete all items
    const items = await ctx.db
      .query("items")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }
    await deleteActionRecords(ctx, { listId: args.listId });

    // Includes historical orphan membership rows whose items were already removed.
    for (const row of await ctx.db.query("itemAssignees").withIndex("by_list", q => q.eq("listId", args.listId)).collect()) await ctx.db.delete(row._id);

    // Delete publications
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();
    for (const pub of pubs) {
      await ctx.db.delete(pub._id);
    }

    const noteBody = await ctx.db
      .query("noteBodies")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .first();
    if (noteBody) await ctx.db.delete(noteBody._id);

    for (const original of await ctx.db.query("originalLogs").withIndex("by_list", q => q.eq("listId", args.listId)).collect()) {
      for (const r of await ctx.db.query("originalResources").withIndex("by_did_digest", q => q.eq("did", original.did)).collect()) await ctx.db.delete(r._id);
      await ctx.db.delete(original._id);
    }
    for (const row of await ctx.db.query("listEnvelopes").withIndex("by_list", q => q.eq("listId", args.listId)).collect()) await ctx.db.delete(row._id);

    // Delete bookmarks referencing this list
    const bookmarks = await ctx.db.query("bookmarks").collect();
    for (const bm of bookmarks) {
      if (bm.listId === args.listId) {
        await ctx.db.delete(bm._id);
      }
    }

    const grants = await ctx.db.query("listGrants")
      .withIndex("by_list_recipient", q => q.eq("listId", args.listId)).collect();
    for (const grant of grants) await ctx.db.delete(grant._id);
    const revocations = await ctx.db.query("listGrantRevocations")
      .withIndex("by_list_recipient", q => q.eq("listId", args.listId)).collect();
    for (const revocation of revocations) await ctx.db.delete(revocation._id);
    const invitations = await ctx.db.query("listInvitations")
      .withIndex("by_list_email", q => q.eq("listId", args.listId)).collect();
    for (const invitation of invitations) await ctx.db.delete(invitation._id);
    await ctx.db.delete(args.listId);
  },
});

/**
 * Add a custom grocery aisle to a list.
 * Only the list owner can add custom aisles.
 */
export const { public: addCustomAisle, internal: addCustomAisleInternal } = actorMutation({
  authority: "owner",
  resources: args => ({ lists: [args.listId] }),
  scope: "items:write",
  args: {
    listId: v.id("lists"),
    name: v.string(),
    emoji: v.string(),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error("List not found");

    const dids = [ctx.actor.did];
    if (ctx.actor.legacyDid) dids.push(ctx.actor.legacyDid);
    if (!dids.includes(list.ownerDid)) {
      throw resourceUnavailable();
    }

    const existing = list.customAisles ?? [];
    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const maxOrder = existing.length > 0 ? Math.max(...existing.map(a => a.order)) : 49;

    await ctx.db.patch(args.listId, {
      customAisles: [...existing, { id, name: args.name, emoji: args.emoji, order: maxOrder + 1 }],
    });

    return id;
  },
});

/**
 * Update the item view mode for a list.
 * Only the list owner can change view mode.
 */
export const { public: updateItemViewMode, internal: updateItemViewModeInternal } = actorMutation({
  authority: "owner",
  resources: args => ({ lists: [args.listId] }),
  scope: "items:write",
  args: {
    listId: v.id("lists"),
    itemViewMode: v.union(v.literal("alphabetical"), v.literal("categorized")),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error("List not found");

    const dids = [ctx.actor.did];
    if (ctx.actor.legacyDid) dids.push(ctx.actor.legacyDid);
    if (!dids.includes(list.ownerDid)) {
      throw resourceUnavailable();
    }

    await ctx.db.patch(args.listId, { itemViewMode: args.itemViewMode });
  },
});

/**
 * Remove a custom grocery aisle from a list.
 * Only the list owner can remove custom aisles.
 */
export const { public: removeCustomAisle, internal: removeCustomAisleInternal } = actorMutation({
  authority: "owner",
  resources: args => ({ lists: [args.listId] }),
  scope: "items:write",
  args: {
    listId: v.id("lists"),
    aisleId: v.string(),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error("List not found");

    const dids = [ctx.actor.did];
    if (ctx.actor.legacyDid) dids.push(ctx.actor.legacyDid);
    if (!dids.includes(list.ownerDid)) {
      throw resourceUnavailable();
    }

    const existing = list.customAisles ?? [];
    await ctx.db.patch(args.listId, {
      customAisles: existing.filter(a => a.id !== args.aisleId),
    });
  },
});

export const getListWithItemsForViewer = listWithItemsOperation.internal;
