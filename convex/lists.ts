import { actorMutation, actorQuery } from "./lib/authenticated";
import { v } from "convex/values";

import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { withMutationObservability } from "./lib/observability";
import { canUserViewList } from "./lib/permissions";
import { upsertListEnvelope } from "./lib/listEnvelope";
import { isLegacyGenesis } from "./lib/legacyList";

/**
 * Creates a placeholder Verifiable Credential for list ownership.
 *
 * Exported for migrations/celAssetDids — the credential embeds assetDid in both
 * credentialSubject.id and the serialized proof, so rewriting a list's DID has
 * to rebuild the VC or the subject points at a DID that no longer names it.
 */
export function createListOwnershipVC(
  listId: Id<"lists">,
  assetDid: string,
  ownerDid: string,
  listName: string,
  createdAt: number
): {
  type: string;
  issuer: string;
  issuanceDate: number;
  credentialSubject: { id: string; ownerDid: string };
  proof?: string;
} {
  const fullVc = {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://originals.tech/credentials/v1"
    ],
    type: ["VerifiableCredential", "ListOwnershipCredential"],
    id: `urn:uuid:${crypto.randomUUID()}`,
    issuer: ownerDid,
    issuanceDate: new Date(createdAt).toISOString(),
    credentialSubject: {
      id: ownerDid,
      listId: listId.toString(),
      assetDid,
      listName,
      role: "owner",
    },
  };

  return {
    type: "ListOwnershipCredential",
    issuer: ownerDid,
    issuanceDate: createdAt,
    credentialSubject: {
      id: assetDid,
      ownerDid,
    },
    proof: JSON.stringify(fullVc),
  };
}

/**
 * Create a new list.
 */
/**
 * Free-plan list cap, shared by every path that inserts a list.
 *
 * Extracted rather than inlined so copyList cannot become a way around the
 * limit — a copy is a new list and counts like one.
 */
async function assertListQuota(
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

  const existingLists = await ctx.db
    .query("lists")
    .withIndex("by_owner", (q) => q.eq("ownerDid", ownerDid))
    .collect();

  if (plan === "free") {
    const bonusLists = owner.bonusLists ?? 0;
    const maxLists = 5 + bonusLists;
    if (existingLists.length >= maxLists) {
      throw new Error("PLAN_LIMIT: You've reached the free plan limit of 5 lists. Upgrade at /pricing to create unlimited lists.");
    }
  }

  return { owner, isFirstList: existingLists.length === 0 };
}

export const { public: createList, internal: createListInternal } = actorMutation({
  resources: () => ({}),
  scope: "items:write",
  args: {
    assetDid: v.string(),
    name: v.string(),
    categoryId: v.optional(v.id("categories")),
    createdAt: v.number(),
    // Serialized AssetEnvelope from createListAsset. Optional so older clients
    // (and the HTTP agent API) can still create lists; those get an identifier
    // with no verifiable log until re-genesis.
    celEnvelope: v.optional(v.string()),
  },
  handler: async (ctx, args) => withMutationObservability("lists.createList", async () => {
    // Input validation
    if (args.name.trim().length === 0) throw new Error("List name cannot be empty");
    if (args.name.length > 200) throw new Error("List name cannot exceed 200 characters");

    const { owner, isFirstList } = await assertListQuota(ctx, ctx.actor.did);

    const listId = await ctx.db.insert("lists", {
      assetDid: args.assetDid,
      name: args.name,
      ownerDid: ctx.actor.did,
      categoryId: args.categoryId,
      createdAt: args.createdAt,
    });

    const vcProof = createListOwnershipVC(
      listId,
      args.assetDid,
      ctx.actor.did,
      args.name,
      args.createdAt
    );

    await ctx.db.patch(listId, { vcProof });

    if (args.celEnvelope) {
      await upsertListEnvelope(ctx, listId, args.assetDid, args.celEnvelope);
    }

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

    return listId;
  }),
});

/**
 * Copy a list's contents into a brand-new list.
 *
 * This exists for provenance, not convenience. Lists re-minted by the
 * celAssetDids migration were given their genesis server-side with an ephemeral
 * controller, so no one holds their signing key and they can never record
 * another CEL event — verifiable, but not authorable. A copy is minted in the
 * owner's browser, so its key lands in their keyStore and the new list can
 * author events for the rest of its life.
 *
 * The copy is honestly new: it gets today's genesis and its own DID, and makes
 * no claim to the original's history. The source list is left untouched.
 */
export const { public: copyList, internal: copyListInternal } = actorMutation({
  resources: args => ({ lists: [args.sourceListId] }),
  scope: "items:write",
  args: {
    sourceListId: v.id("lists"),
    // Minted client-side by createListAsset — that is the whole point, so both
    // are required here rather than optional as they are on createList.
    assetDid: v.string(),
    celEnvelope: v.string(),
    name: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => withMutationObservability("lists.copyList", async () => {
    if (args.name.trim().length === 0) throw new Error("List name cannot be empty");
    if (args.name.length > 200) throw new Error("List name cannot exceed 200 characters");

    const source = await ctx.db.get(args.sourceListId);
    if (!source) throw new Error("List not found");
    // Copying mints a new identity naming this owner, so viewers who can merely
    // read a shared list must not be able to do it.
    if (![ctx.actor.did, ctx.actor.legacyDid].includes(source.ownerDid)) {
      throw new Error("Only the list's owner can copy it");
    }

    const { owner, isFirstList } = await assertListQuota(ctx, ctx.actor.did);

    const listId = await ctx.db.insert("lists", {
      assetDid: args.assetDid,
      name: args.name,
      ownerDid: ctx.actor.did,
      categoryId: source.categoryId,
      createdAt: args.createdAt,
      // Presentation settings belong to the list, so the copy should look like
      // the original rather than reverting to the built-in defaults.
      customAisles: source.customAisles,
      itemCategories: source.itemCategories,
      itemViewMode: source.itemViewMode,
    });

    await ctx.db.patch(listId, {
      vcProof: createListOwnershipVC(listId, args.assetDid, ctx.actor.did, args.name, args.createdAt),
    });

    await upsertListEnvelope(ctx, listId, args.assetDid, args.celEnvelope);

    const items = await ctx.db
      .query("items")
      .withIndex("by_list", (q) => q.eq("listId", args.sourceListId))
      .collect();

    // Two passes: parentId points at a sibling item, so every row needs an id
    // before any parent link can be rewritten.
    const idMap = new Map<Id<"items">, Id<"items">>();

    // Rest-spread rather than an explicit field list, so a column added to items
    // later is carried by a copy without anyone remembering to update this.
    // Only these four must not cross: two are system-owned, parentId is rewritten
    // in the second pass below, and vcProofs attest actions taken against the
    // SOURCE asset's DID — carrying them would attribute one asset's provenance
    // to another, the exact claim this copy exists to avoid making.
    const DROP = ["_id", "_creationTime", "parentId", "vcProofs"] as const;

    for (const item of items) {
      const payload: Record<string, unknown> = { ...item };
      for (const field of DROP) delete payload[field];
      const newId = await ctx.db.insert(
        "items",
        { ...payload, listId } as Omit<Doc<"items">, "_id" | "_creationTime">
      );
      idMap.set(item._id, newId);
    }

    for (const item of items) {
      if (!item.parentId) continue;
      const newParent = idMap.get(item.parentId);
      // A parent outside this list would be corrupt data; drop the link rather
      // than point the copy back into the original list.
      if (newParent) await ctx.db.patch(idMap.get(item._id)!, { parentId: newParent });
    }

    if (owner && isFirstList) {
      const referral = await ctx.db
        .query("referrals")
        .withIndex("by_referee", (q) => q.eq("refereeId", owner._id))
        .first();
      if (referral && !referral.proGrantedAt) {
        const proUntil = Date.now() + 30 * 24 * 60 * 60 * 1000;
        await ctx.db.patch(owner._id, { referralProUntil: proUntil });
        await ctx.db.patch(referral.referrerId, { referralProUntil: proUntil });
        await ctx.db.patch(referral._id, { proGrantedAt: Date.now() });
      }
    }

    return { listId, itemsCopied: items.length };
  }),
});

/**
 * Rename a list. Only the owner can rename.
 */
export const { public: renameList, internal: renameListInternal } = actorMutation({
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
      throw new Error("Only the list owner can rename this list");
    }

    const vcProof = createListOwnershipVC(
      args.listId,
      list.assetDid ?? "",
      list.ownerDid,
      args.name,
      list.createdAt
    );

    await ctx.db.patch(args.listId, { name: args.name, vcProof });
  },
});

/**
 * Update the category of a list. Only owner can change.
 */
export const { public: updateListCategory, internal: updateListCategoryInternal } = actorMutation({
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
      throw new Error("Only the list owner can change the category");
    }

    if (args.categoryId) {
      const category = await ctx.db.get(args.categoryId);
      if (!category) throw new Error("Category not found");
    }

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
    if (list && !await canUserViewList(ctx, args.listId, ctx.actor.did, ctx.actor.legacyDid)) throw new Error("Not authorized to access this list");
    return list;
  },
});

/**
 * The list's serialized AssetEnvelope, for client-side verification. Kept out of
 * getList so the hot list subscriptions don't carry it. Returns null when the
 * list predates envelope persistence.
 *
 * Protected by the same authenticated list access check as getList.
 */
export const { public: getListEnvelope, internal: getListEnvelopeInternal } = actorQuery({
  resources: args => ({ lists: [args.listId] }),
  scope: "lists:read",
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("listEnvelopes")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .first();
    return row ? { assetDid: row.assetDid, envelope: row.envelope } : null;
  },
});

/**
 * Get a list plus its items, but only if the viewer may access it (list owner
 * by current or legacy DID, or an actively published list). Returns null when
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

    return { list, items };
  },
});

/**
 * Get all lists where user is the owner, plus any bookmarked published lists.
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
 * Which of these lists carry legacy provenance — a log sealed by the migration
 * rather than by their owner, so they can never record another event.
 *
 * Separate from getUserLists, and returning only ids, so the list index can
 * badge them without pulling every envelope into a hot subscription. Reads one
 * indexed row per list and compares two numbers; the parsing happened once, at
 * write time.
 */
export const { public: getLegacyListIds, internal: getLegacyListIdsInternal } = actorQuery({
  resources: args => ({ lists: [...args.listIds] }),
  scope: "lists:read",
  args: { listIds: v.array(v.id("lists")) },
  handler: async (ctx, args) => {
    const legacy: Id<"lists">[] = [];

    for (const listId of args.listIds) {
      const list = await ctx.db.get(listId);
      if (!list) continue;

      const row = await ctx.db
        .query("listEnvelopes")
        .withIndex("by_list", (q) => q.eq("listId", listId))
        .first();

      // No envelope, or one we could not read, is "unknown" rather than legacy:
      // claiming a list cannot record history when we simply do not know would
      // push the owner into a copy they may not need.
      if (!row || row.genesisSealedAt === undefined) continue;

      if (isLegacyGenesis(row.genesisSealedAt, list.createdAt)) legacy.push(listId);
    }

    return legacy;
  },
});

/**
 * Delete a list and all its items.
 * Only the owner can delete a list.
 */
export const { public: deleteList, internal: deleteListInternal } = actorMutation({
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
      throw new Error("Only the list owner can delete this list");
    }

    // Delete all items
    const items = await ctx.db
      .query("items")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();
    for (const item of items) {
      await ctx.db.delete(item._id);
    }

    // Delete publications
    const pubs = await ctx.db
      .query("publications")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();
    for (const pub of pubs) {
      await ctx.db.delete(pub._id);
    }

    // Delete bookmarks referencing this list
    const bookmarks = await ctx.db.query("bookmarks").collect();
    for (const bm of bookmarks) {
      if (bm.listId === args.listId) {
        await ctx.db.delete(bm._id);
      }
    }

    await ctx.db.delete(args.listId);
  },
});

/**
 * Add a custom grocery aisle to a list.
 * Only the list owner can add custom aisles.
 */
export const { public: addCustomAisle, internal: addCustomAisleInternal } = actorMutation({
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
      throw new Error("Only the list owner can add custom aisles");
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
      throw new Error("Only the list owner can change view mode");
    }

    await ctx.db.patch(args.listId, { itemViewMode: args.itemViewMode });
  },
});

/**
 * Remove a custom grocery aisle from a list.
 * Only the list owner can remove custom aisles.
 */
export const { public: removeCustomAisle, internal: removeCustomAisleInternal } = actorMutation({
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
      throw new Error("Only the list owner can remove custom aisles");
    }

    const existing = list.customAisles ?? [];
    await ctx.db.patch(args.listId, {
      customAisles: existing.filter(a => a.id !== args.aisleId),
    });
  },
});

export const getListWithItemsForViewer = listWithItemsOperation.internal;
