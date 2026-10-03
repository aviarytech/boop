/**
 * Bitcoin Anchoring for List State
 *
 * Phase 5: Anchor list state to Bitcoin signet for immutable timestamping.
 * Uses @originals/sdk for Bitcoin integration when available.
 *
 * The anchoring process:
 * 1. Compute SHA-256 hash of list state (items, VCs, etc.)
 * 2. Inscribe hash on Bitcoin signet via Ordinals
 * 3. Store anchor proof with the list
 *
 * This provides cryptographic proof that a list existed in a specific state
 * at a specific point in time, anchored to the Bitcoin blockchain.
 */

import { v } from "convex/values";
import { query, mutation, action } from "./_generated/server";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Network configuration for Bitcoin anchoring
 */
const BITCOIN_NETWORK = "signet" as const;

/**
 * Compute SHA-256 hash of a string
 * Uses Web Crypto API available in Convex runtime
 */
async function computeSha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Build a canonical representation of list state for hashing.
 * Ensures consistent ordering for deterministic hashes.
 */
function buildCanonicalState(
  list: Doc<"lists">,
  items: Doc<"items">[]
): string {
  // Sort items by ID for deterministic ordering
  const sortedItems = [...items].sort((a, b) =>
    a._id.toString().localeCompare(b._id.toString())
  );

  const state = {
    version: 2, // State schema version - v2 removes collaborators
    list: {
      id: list._id.toString(),
      assetDid: list.assetDid,
      name: list.name,
      ownerDid: list.ownerDid,
      createdAt: list.createdAt,
    },
    items: sortedItems.map((item) => ({
      id: item._id.toString(),
      name: item.name,
      checked: item.checked,
      createdByDid: item.createdByDid,
      checkedByDid: item.checkedByDid,
      createdAt: item.createdAt,
      checkedAt: item.checkedAt,
      order: item.order,
      description: item.description,
      dueDate: item.dueDate,
      priority: item.priority,
    })),
    anchoredAt: Date.now(),
  };

  // Use JSON.stringify with sorted keys for deterministic output
  return JSON.stringify(state, Object.keys(state).sort());
}

/**
 * Internal mutation to create an anchor record.
 * Called by the action after computing the hash.
 */
export const createAnchorRecord = mutation({
  args: {
    listId: v.id("lists"),
    stateHash: v.string(),
    stateSnapshot: v.string(),
    anchoredByDid: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("bitcoinAnchors", {
      listId: args.listId,
      contentHash: args.stateHash,
      network: BITCOIN_NETWORK,
      status: "pending",
      requestedByDid: args.anchoredByDid,
      createdAt: Date.now(),
      stateSnapshot: args.stateSnapshot,
    });
  },
});

/**
 * Update anchor status after Bitcoin inscription.
 */
export const updateAnchorStatus = mutation({
  args: {
    anchorId: v.id("bitcoinAnchors"),
    status: v.union(
      v.literal("pending"),
      v.literal("inscribed"),
      v.literal("confirmed"),
      v.literal("failed")
    ),
    txid: v.optional(v.string()),
    inscriptionId: v.optional(v.string()),
    blockHeight: v.optional(v.number()),
    confirmations: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { anchorId, status, ...updates } = args;
    const now = Date.now();
    await ctx.db.patch(anchorId, {
      status,
      ...updates,
      updatedAt: now,
      ...(status === "inscribed" ? { inscribedAt: now } : {}),
      ...(status === "confirmed" ? { confirmedAt: now } : {}),
    });
  },
});

/**
 * Get list data for anchoring (internal helper query).
 */
export const getListDataForAnchor = query({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) return null;

    const items = await ctx.db
      .query("items")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .collect();

    return { list, items };
  },
});

/**
 * Anchor list state to Bitcoin signet.
 *
 * This action:
 * 1. Fetches current list state (items)
 * 2. Computes SHA-256 hash of canonical state
 * 3. Creates anchor record with "pending" status
 * 4. Attempts Bitcoin inscription (when configured)
 * 5. Updates anchor status based on result
 *
 * @param listId - The list to anchor
 * @param userDid - DID of user requesting the anchor
 * @returns The anchor record ID
 */
export const anchorListState = action({
  args: {
    listId: v.id("lists"),
    userDid: v.string(),
  },
  handler: async (ctx, args): Promise<{ anchorId: Id<"bitcoinAnchors">; stateHash: string; status: string }> => {
    // 1. Fetch list data
    const data = await ctx.runQuery(api.bitcoinAnchors.getListDataForAnchor, {
      listId: args.listId,
    });

    if (!data) {
      throw new Error("List not found");
    }

    const { list, items } = data;

    // 2. Verify user has access (owner)
    if (list.ownerDid !== args.userDid) {
      throw new Error("Only the owner can anchor list state");
    }

    // 3. Build canonical state and compute hash
    const canonicalState = buildCanonicalState(list, items);
    const stateHash = await computeSha256(canonicalState);

    // 4. Create anchor record
    const anchorId = await ctx.runMutation(api.bitcoinAnchors.createAnchorRecord, {
      listId: args.listId,
      stateHash,
      stateSnapshot: canonicalState,
      anchoredByDid: args.userDid,
    });

    // 5. Attempt Bitcoin inscription
    // NOTE: Full Bitcoin integration requires:
    // - Configured BitcoinManager with RPC endpoint
    // - Funded wallet for transaction fees
    // - Network access to Bitcoin signet
    //
    // For now, we create the anchor record in "pending" status.
    // A background process or manual trigger can complete the inscription.
    //
    // When @originals/sdk Bitcoin integration is configured:
    // ```
    // import { OriginalsSDK } from '@originals/sdk';
    // const sdk = new OriginalsSDK({
    //   network: 'signet',
    //   bitcoinRpcUrl: process.env.BITCOIN_RPC_URL,
    // });
    // const inscription = await sdk.bitcoin.inscribeData(
    //   { type: 'anchor', hash: stateHash, listDid: list.assetDid },
    //   'application/json',
    //   feeRate
    // );
    // await ctx.runMutation(api.bitcoinAnchors.updateAnchorStatus, {
    //   anchorId,
    //   status: 'inscribed',
    //   txid: inscription.txid,
    //   inscriptionId: inscription.inscriptionId,
    // });
    // ```

    // For development/demo: simulate successful inscription
    // In production, this would be replaced with actual Bitcoin RPC calls
    if (process.env.SIMULATE_BITCOIN_ANCHOR === "true") {
      const simulatedTxid = `signet:${stateHash.substring(0, 16)}:${Date.now()}`;
      const simulatedInscriptionId = `${simulatedTxid}i0`;

      await ctx.runMutation(api.bitcoinAnchors.updateAnchorStatus, {
        anchorId,
        status: "inscribed",
        txid: simulatedTxid,
        inscriptionId: simulatedInscriptionId,
      });

      return { anchorId, stateHash, status: "inscribed" };
    }

    return { anchorId, stateHash, status: "pending" };
  },
});

/**
 * Get all anchors for a list.
 */
export const getListAnchors = query({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("bitcoinAnchors")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .order("desc")
      .collect();
  },
});

/**
 * Get all Bitcoin anchors for a specific item
 */
export const getItemAnchors = query({
  args: { itemId: v.id("items") },
  handler: async (ctx, { itemId }) => {
    const anchors = await ctx.db
      .query("bitcoinAnchors")
      .withIndex("by_item", (q) => q.eq("itemId", itemId))
      .collect();
    
    return anchors;
  },
});

/**
 * Get anchor by transaction ID
 */
export const getAnchorByTxid = query({
  args: { txid: v.string() },
  handler: async (ctx, { txid }) => {
    const anchor = await ctx.db
      .query("bitcoinAnchors")
      .withIndex("by_txid", (q) => q.eq("txid", txid))
      .first();
    
    return anchor;
  },
});

/**
 * Get the latest anchor for a list.
 */
export const getLatestAnchor = query({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("bitcoinAnchors")
      .withIndex("by_list", (q) => q.eq("listId", args.listId))
      .order("desc")
      .first();
  },
});

/**
 * Get all pending anchors (for background processing)
 */
export const getPendingAnchors = query({
  args: {},
  handler: async (ctx) => {
    const anchors = await ctx.db
      .query("bitcoinAnchors")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    
    return anchors;
  },
});

/**
 * Get anchor by ID.
 */
export const getAnchor = query({
  args: { anchorId: v.id("bitcoinAnchors") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.anchorId);
  },
});

/**
 * Verify anchor against current list state.
 */
export const verifyAnchorState = action({
  args: {
    anchorId: v.id("bitcoinAnchors"),
  },
  handler: async (ctx, args): Promise<{ valid: boolean; currentHash: string; anchoredHash: string; stateChanged: boolean }> => {
    // Get the anchor
    const anchor = await ctx.runQuery(api.bitcoinAnchors.getAnchor, {
      anchorId: args.anchorId,
    });

    if (!anchor) {
      throw new Error("Anchor not found");
    }

    if (!anchor.listId) {
      throw new Error("Anchor has no associated list");
    }

    // Get current list state
    const data = await ctx.runQuery(api.bitcoinAnchors.getListDataForAnchor, {
      listId: anchor.listId,
    });

    if (!data) {
      throw new Error("List not found");
    }

    // Compute current state hash
    const { list, items } = data;
    const canonicalState = buildCanonicalState(list, items);
    const currentHash = await computeSha256(canonicalState);

    return {
      valid: anchor.status === "inscribed" || anchor.status === "confirmed",
      currentHash,
      anchoredHash: anchor.contentHash,
      stateChanged: currentHash !== anchor.contentHash,
    };
  },
});
