/**
 * Signed action records (#237): reads for provenance/verification and the
 * database half of asynchronous signing. The Turnkey half is the "use node"
 * action in actionRecordSigning.ts. See docs/action-records.md.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { actorQuery } from "./lib/authenticated";

// One initial try plus three retries, then the record is marked failed.
export const MAX_SIGNING_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 25 * 60_000];
// Longer than the largest backoff, so the sweep never races a scheduled retry.
const STALE_PENDING_MS = 60 * 60_000;
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

/** Pending records with their owner's current signing identity. Already-settled
 * or deleted records are skipped, which is what makes a repeated signer run a no-op. */
export const loadForSigning = internalQuery({
  args: { recordIds: v.array(v.id("actionRecords")) },
  handler: async (ctx, args) => {
    const owners = new Map<Id<"users">, Doc<"users"> | null>();
    const pending = [];
    for (const recordId of new Set(args.recordIds)) {
      const record = await ctx.db.get(recordId);
      if (record?.status !== "pending") continue;
      if (!owners.has(record.ownerUserId)) owners.set(record.ownerUserId, await ctx.db.get(record.ownerUserId));
      const owner = owners.get(record.ownerUserId);
      pending.push({
        recordId, payload: record.payload, digest: record.digest, ownerUserId: record.ownerUserId,
        ownerDid: owner?.did, turnkeySubOrgId: owner?.turnkeySubOrgId,
      });
    }
    return pending;
  },
});

const recordId = v.id("actionRecords");
const outcome = v.union(
  v.object({
    kind: v.literal("signed"), recordId, digest: v.string(), signature: v.string(),
    publicKeyMultibase: v.string(), verificationMethod: v.string(),
  }),
  v.object({ kind: v.literal("unsigned"), recordId }),
  // `reason` is a fixed non-secret code, never a provider error message.
  v.object({ kind: v.literal("failed"), recordId, reason: v.string(), retry: v.boolean() }),
);

/** Applies signer results. Only pending records change, so duplicate or late
 * deliveries cannot replace a stored signature. Retries are scheduled here so
 * the attempt count and its retry commit together. */
export const settle = internalMutation({
  args: { outcomes: v.array(outcome) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const retries = new Map<number, Id<"actionRecords">[]>();
    for (const result of args.outcomes) {
      const record = await ctx.db.get(result.recordId);
      if (record?.status !== "pending") continue;
      const attempts = record.attempts + 1;
      if (result.kind === "unsigned") {
        await ctx.db.patch(record._id, { status: "unsigned" });
      } else if (result.kind === "signed" && result.digest === record.digest) {
        await ctx.db.patch(record._id, {
          status: "signed", signature: result.signature, publicKeyMultibase: result.publicKeyMultibase,
          verificationMethod: result.verificationMethod, signedAt: now, attempts, lastAttemptAt: now,
        });
      } else if (result.kind === "failed" && result.retry && attempts < MAX_SIGNING_ATTEMPTS) {
        await ctx.db.patch(record._id, { attempts, lastAttemptAt: now });
        const delay = RETRY_DELAYS_MS[attempts - 1];
        retries.set(delay, [...(retries.get(delay) ?? []), record._id]);
      } else {
        await ctx.db.patch(record._id, {
          status: "failed", attempts, lastAttemptAt: now,
          error: result.kind === "failed" ? result.reason : "payload_integrity",
        });
      }
    }
    for (const [delay, recordIds] of retries) {
      await ctx.scheduler.runAfter(delay, internal.actionRecordSigning.sign, { recordIds });
    }
  },
});

/** Scheduled actions run at most once. This cron re-queues records whose signer
 * run never reported back, within the same attempt bound. */
export const sweepStalePending = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const pending = await ctx.db.query("actionRecords")
      .withIndex("by_status", q => q.eq("status", "pending")).take(200);
    const recordIds: Id<"actionRecords">[] = [];
    for (const record of pending) {
      if (now - (record.lastAttemptAt ?? record._creationTime) <= STALE_PENDING_MS) continue;
      const attempts = record.attempts + 1;
      if (attempts >= MAX_SIGNING_ATTEMPTS) {
        await ctx.db.patch(record._id, { status: "failed", error: "signer_unresponsive", attempts, lastAttemptAt: now });
      } else {
        await ctx.db.patch(record._id, { attempts, lastAttemptAt: now });
        recordIds.push(record._id);
      }
    }
    if (recordIds.length > 0) {
      await ctx.scheduler.runAfter(0, internal.actionRecordSigning.sign, { recordIds });
    }
  },
});

/** Operator recovery when an outage outlasted the retry window. */
export const requeueFailed = internalMutation({
  args: { recordIds: v.array(v.id("actionRecords")) },
  handler: async (ctx, args) => {
    const recordIds: Id<"actionRecords">[] = [];
    for (const id of new Set(args.recordIds)) {
      const record = await ctx.db.get(id);
      if (record?.status !== "failed") continue;
      await ctx.db.patch(id, { status: "pending", attempts: 0, error: undefined, lastAttemptAt: undefined });
      recordIds.push(id);
    }
    if (recordIds.length > 0) {
      await ctx.scheduler.runAfter(0, internal.actionRecordSigning.sign, { recordIds });
    }
    return recordIds.length;
  },
});
