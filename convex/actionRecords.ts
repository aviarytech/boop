/**
 * Action records (#237): reads for provenance and independent verification.
 * Records are written by lib/actionRecords.ts recordActions. No signer is wired
 * up yet; see docs/action-records.md.
 */
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { actorQuery } from "./lib/authenticated";

const MAX_RECORDS_PER_READ = 50;

/** Everything shared/actionRecord.ts verifyActionRecord needs, and nothing internal. */
function evidence(record: Doc<"actionRecords">) {
  return {
    _id: record._id,
    payload: record.payload,
    digest: record.digest,
    status: record.status,
    listId: record.listId,
    itemId: record.itemId,
    ownerUserId: record.ownerUserId,
    signature: record.signature,
    verificationMethod: record.verificationMethod,
    publicKeyMultibase: record.publicKeyMultibase,
    signedAt: record.signedAt,
    error: record.error,
  };
}

/** Newest action records for one item. Same read access as the item itself. */
export const { public: getItemActionRecords, internal: getItemActionRecordsInternal } = actorQuery({
  resources: args => ({ items: [args.itemId] }),
  scope: "items:read",
  args: { itemId: v.id("items") },
  handler: async (ctx, args) => (await ctx.db.query("actionRecords")
    .withIndex("by_item", q => q.eq("itemId", args.itemId))
    .order("desc").take(MAX_RECORDS_PER_READ)).map(evidence),
});

/** Newest list-level records (created, renamed). Item records are read per item. */
export const { public: getListActionRecords, internal: getListActionRecordsInternal } = actorQuery({
  resources: args => ({ lists: [args.listId] }),
  scope: "lists:read",
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => (await ctx.db.query("actionRecords")
    .withIndex("by_list", q => q.eq("listId", args.listId).eq("itemId", undefined))
    .order("desc").take(MAX_RECORDS_PER_READ)).map(evidence),
});
