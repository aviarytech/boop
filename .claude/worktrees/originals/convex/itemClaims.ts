/**
 * Signed claims awaiting fold-in.
 *
 * When a collaborator acts on a list they do not control, they cannot append to
 * its event log — CEL is single-writer. They sign an ItemClaimCredential and
 * park it here; the list's controller folds it into the log on its next sync.
 *
 * Until then the claim IS the proof. It must not be deleted on fold-in, only
 * marked, or the log's embedded copy would be the sole record of an action the
 * claimant could no longer independently evidence.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { canUserEditList } from "./lib/permissions";

/** Mirrors ITEM_ACTIONS in src/lib/credentials.ts. Kept closed on purpose. */
const ITEM_ACTIONS = ["added", "checked", "unchecked", "renamed", "removed"];

export const submitClaim = mutation({
  args: {
    listId: v.id("lists"),
    itemId: v.string(),
    action: v.string(),
    issuerDid: v.string(),
    credential: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!ITEM_ACTIONS.includes(args.action)) {
      throw new Error(`Unknown item action: ${args.action}`);
    }

    // The signature proves who signed, not that they may touch this list.
    const canEdit = await canUserEditList(ctx, args.listId, args.issuerDid, args.legacyDid);
    if (!canEdit) {
      throw new Error("Not authorized to submit claims for this list");
    }

    // Oversized credentials are a cheap way to bloat a list someone else owns.
    if (args.credential.length > 20_000) {
      throw new Error("Claim credential is too large");
    }

    return ctx.db.insert("itemClaims", {
      listId: args.listId,
      itemId: args.itemId,
      action: args.action,
      issuerDid: args.issuerDid,
      credential: args.credential,
      createdAt: Date.now(),
    });
  },
});

/** Claims not yet in the log, oldest first — fold-in order matters. */
export const pendingClaims = query({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const claims = await ctx.db
      .query("itemClaims")
      .withIndex("by_list_folded", (q) => q.eq("listId", args.listId).eq("foldedAt", undefined))
      .collect();

    return claims.sort((a, b) => a.createdAt - b.createdAt);
  },
});

/**
 * Mark claims as folded into the log. Only the list owner does this, because
 * only they could have appended them.
 */
export const markClaimsFolded = mutation({
  args: {
    claimIds: v.array(v.id("itemClaims")),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    for (const claimId of args.claimIds) {
      const claim = await ctx.db.get(claimId);
      if (!claim) continue;

      const list = await ctx.db.get(claim.listId);
      if (!list) continue;

      const dids = [args.userDid];
      if (args.legacyDid) dids.push(args.legacyDid);
      if (!dids.includes(list.ownerDid)) {
        throw new Error("Only the list owner can mark claims folded");
      }

      if (!claim.foldedAt) {
        await ctx.db.patch(claimId, { foldedAt: now });
      }
    }
  },
});
