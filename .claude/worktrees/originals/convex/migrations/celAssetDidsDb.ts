/**
 * Database half of the did:peer -> did:cel migration.
 *
 * Split out from celAssetDids.ts because that file is "use node" (it needs
 * @originals/sdk to mint genesis) and Convex only allows actions in Node
 * modules. The entrypoint is migrations/celAssetDids:runAll.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { createListOwnershipVC } from "../lists";
import { upsertListEnvelope } from "../lib/listEnvelope";

/** Rows still carrying a pre-2.0.0 genesis DID (real or `temp-` placeholder). */
export function needsCelMigration(assetDid: string | undefined | null): boolean {
  return typeof assetDid === "string" && assetDid.startsWith("did:peer:");
}

export const listLegacyLists = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("lists").collect();
    return all
      .filter((row) => needsCelMigration(row.assetDid))
      .map((row) => ({
        _id: row._id,
        assetDid: row.assetDid,
        name: row.name,
        ownerDid: row.ownerDid,
        createdAt: row.createdAt,
      }));
  },
});

export const setListAssetDid = internalMutation({
  args: {
    listId: v.id("lists"),
    assetDid: v.string(),
    celEnvelope: v.string(),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw new Error(`List ${args.listId} not found`);

    // Re-check under the mutation: a concurrent run may have claimed this row.
    if (!needsCelMigration(list.assetDid)) return { migrated: false };

    await ctx.db.patch(args.listId, {
      assetDid: args.assetDid,
      vcProof: createListOwnershipVC(
        args.listId,
        args.assetDid,
        list.ownerDid,
        list.name,
        list.createdAt
      ),
    });
    await upsertListEnvelope(ctx, args.listId, args.assetDid, args.celEnvelope);
    return { migrated: true };
  },
});
