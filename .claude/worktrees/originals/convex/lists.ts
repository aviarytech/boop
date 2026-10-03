import { v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { withMutationObservability } from "./lib/observability";
import { canUserViewList } from "./lib/permissions";
import { upsertListEnvelope } from "./lib/listEnvelope";

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
export const createList = mutation({
  args: {
    assetDid: v.string(),
    name: v.string(),
    ownerDid: v.string(),
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

    // Plan enforcement: free tier allows up to 5 lists
    const owner = await ctx.db
      .query("users")
      .withIndex("by_did", (q) => q.eq("did", args.ownerDid))
      .first();

    let isFirstList = false;

    if (owner) {
      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_user", (q) => q.eq("userId", owner._id))
        .first();
      const hasPaidSub = sub && (sub.status === "active" || sub.status === "trialing");
      const hasReferralPro = !hasPaidSub && owner.referralProUntil != null && owner.referralProUntil > Date.now();
      const plan = hasPaidSub ? sub.plan : (hasReferralPro ? "pro" : "free");

      const existingLists = await ctx.db
        .query("lists")
        .withIndex("by_owner", (q) => q.eq("ownerDid", args.ownerDid))
        .collect();

      isFirstList = existingLists.length === 0;

      if (plan === "free") {
        const bonusLists = owner.bonusLists ?? 0;
        const maxLists = 5 + bonusLists;
        if (existingLists.length >= maxLists) {
          throw new Error("PLAN_LIMIT: You've reached the free plan limit of 5 lists. Upgrade at /pricing to create unlimited lists.");
        }
      }
    }

    const listId = await ctx.db.insert("lists", {
      assetDid: args.assetDid,
      name: args.name,
      ownerDid: args.ownerDid,
      categoryId: args.categoryId,
      createdAt: args.createdAt,
    });

    const vcProof = createListOwnershipVC(
      listId,
      args.assetDid,
      args.ownerDid,
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
 * Rename a list. Only the owner can rename.
 */
export const renameList = mutation({
  args: {
    listId: v.id("lists"),
    name: v.string(),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error("List not found");

    const dids = [args.userDid];
    if (args.legacyDid) dids.push(args.legacyDid);

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
export const updateListCategory = mutation({
  args: {
    listId: v.id("lists"),
    categoryId: v.optional(v.id("categories")),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error("List not found");

    const dids = [args.userDid];
    if (args.legacyDid) dids.push(args.legacyDid);

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
 * Number of events in a stored log. Reads both the current EventLog shape and
 * the AssetEnvelope written before Turnkey custody, which embeds one.
 * Unparseable input counts as zero so it can never block a real write.
 */
export function countEvents(stored: string): number {
  try {
    const parsed = JSON.parse(stored) as {
      events?: unknown[];
      eventLog?: { events?: unknown[] };
    };
    const events = parsed.events ?? parsed.eventLog?.events;
    return Array.isArray(events) ? events.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Persist a list's event log after the client appended signed events to it.
 *
 * Owner-only, and deliberately not a merge: CEL is single-writer, so only the
 * controller can produce a valid append and any log they hand us either
 * verifies or does not. The server cannot check the signatures itself (no
 * signer, no jsonld here), which is exactly why writing is restricted to the
 * one party who could have signed. Readers verify.
 */
export const saveListLog = mutation({
  args: {
    listId: v.id("lists"),
    eventLog: v.string(),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error("List not found");

    const dids = [args.userDid];
    if (args.legacyDid) dids.push(args.legacyDid);
    if (!dids.includes(list.ownerDid)) {
      throw new Error("Only the list owner can write its event log");
    }

    const existing = await ctx.db
      .query("listEnvelopes")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .first();

    // Logs only grow. A shorter one means a stale client is about to overwrite
    // events it never saw, silently destroying provenance — refuse instead.
    if (existing && countEvents(args.eventLog) < countEvents(existing.envelope)) {
      throw new Error("Refusing to replace an event log with a shorter one");
    }

    await upsertListEnvelope(ctx, args.listId, list.assetDid, args.eventLog);
  },
});

/**
 * Get a list by its ID.
 */
export const getList = query({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.listId);
  },
});

/**
 * The list's serialized AssetEnvelope, for client-side verification. Kept out of
 * getList so the hot list subscriptions don't carry it. Returns null when the
 * list predates envelope persistence.
 *
 * Unauthenticated, matching getList above: the envelope holds the DID document,
 * the signed CEL log and the list's own name/owner — the same surface getList
 * already returns to any caller with the id.
 */
export const getListEnvelope = query({
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
export const getListWithItemsForViewer = internalQuery({
  args: {
    listId: v.id("lists"),
    viewerDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) return null;

    const canView = await canUserViewList(
      ctx,
      args.listId,
      args.viewerDid,
      args.legacyDid
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
export const getUserLists = query({
  args: {
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
    walletDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const didsToCheck = [args.userDid];
    if (args.legacyDid) didsToCheck.push(args.legacyDid);
    if (args.walletDid) didsToCheck.push(args.walletDid);

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
          if (list) {
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
export const deleteList = mutation({
  args: {
    listId: v.id("lists"),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error("List not found");

    const dids = [args.userDid];
    if (args.legacyDid) dids.push(args.legacyDid);

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
export const addCustomAisle = mutation({
  args: {
    listId: v.id("lists"),
    name: v.string(),
    emoji: v.string(),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error("List not found");

    const dids = [args.userDid];
    if (args.legacyDid) dids.push(args.legacyDid);
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
export const updateItemViewMode = mutation({
  args: {
    listId: v.id("lists"),
    itemViewMode: v.union(v.literal("alphabetical"), v.literal("categorized")),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error("List not found");

    const dids = [args.userDid];
    if (args.legacyDid) dids.push(args.legacyDid);
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
export const removeCustomAisle = mutation({
  args: {
    listId: v.id("lists"),
    aisleId: v.string(),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error("List not found");

    const dids = [args.userDid];
    if (args.legacyDid) dids.push(args.legacyDid);
    if (!dids.includes(list.ownerDid)) {
      throw new Error("Only the list owner can remove custom aisles");
    }

    const existing = list.customAisles ?? [];
    await ctx.db.patch(args.listId, {
      customAisles: existing.filter(a => a.id !== args.aisleId),
    });
  },
});
