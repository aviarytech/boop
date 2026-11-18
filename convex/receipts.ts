/**
 * Receipts for accepted action records (#286 P3, plans/002 D10/D11): the Boop
 * service DID's signed statement that it accepted a record at a given time.
 * See docs/action-records.md "Receipts" and docs/service-did.md.
 *
 * Runs in Convex's default runtime: the Turnkey client is Web Crypto and
 * fetch (convex/lib/turnkeyApi.ts), so no Node action is needed.
 */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { parseActionRecordAttested } from "../shared/actionRecord";
import { verifyReceipt, type ActionRecordReceipt } from "../shared/receipt";
import { SERVICE_DID_PATH } from "../shared/serviceDid";
import { actionRecordReceipt } from "./lib/actionRecords";
import { issueReceipt, receiptSignerCredentials, turnkeyServiceSigner } from "./lib/serviceReceipts";

/** Tries after the first, spaced 5 s, 30 s, 3 min, for a Turnkey outage or a rate limit. */
const RETRY_DELAYS_MS = [5_000, 30_000, 180_000];

/**
 * Sign a receipt for `recordHash` (a record's `digest`) at `receivedAt` with
 * the receipt key of the latest version of the served Boop service DID.
 * Internal: whoever calls it decides what Boop vouches for. Kept for the
 * owner's manual check; issueForRecords signs directly.
 */
export const signReceipt = internalAction({
  args: { recordHash: v.string(), receivedAt: v.number() },
  handler: async (ctx, args): Promise<ActionRecordReceipt> => {
    const served: string | null = await ctx.runQuery(internal.didLogs.getDidLogByPath, { path: SERVICE_DID_PATH });
    if (!served) throw new Error("No Boop service DID is published");
    return issueReceipt(served, args, turnkeyServiceSigner(receiptSignerCredentials()));
  },
});

/** What a receipt for this record states, or null when it is not owed one. */
export const awaitingReceipt = internalQuery({
  args: { recordId: v.id("actionRecords") },
  handler: async (ctx, args): Promise<{ recordHash: string; receivedAt: number } | null> => {
    const record = await ctx.db.get(args.recordId);
    // Only records verified at receipt, and one receipt each. The time is the
    // accepting mutation's own clock, not when this runs.
    if (!record || record.status !== "signed" || record.receipt) return null;
    const attested = parseActionRecordAttested(record.attested);
    return attested ? { recordHash: record.digest, receivedAt: attested.occurredAt } : null;
  },
});

/** Attach a receipt to its record, if it is the receipt that record is owed and it verifies. */
export const storeReceipt = internalMutation({
  args: { recordId: v.id("actionRecords"), receipt: actionRecordReceipt },
  handler: async (ctx, args): Promise<boolean> => {
    const record = await ctx.db.get(args.recordId);
    if (!record || record.status !== "signed" || record.receipt) return false;
    const attested = parseActionRecordAttested(record.attested);
    const service = await ctx.db.query("didLogs").withIndex("by_path", q => q.eq("path", SERVICE_DID_PATH)).first();
    if (!attested || !service || args.receipt.receivedAt !== attested.occurredAt) return false;
    const checked = verifyReceipt(args.receipt, service.log, { expected: { recordHash: record.digest, serviceDid: service.userDid } });
    if (!checked.verified) return false;
    await ctx.db.patch(record._id, { receipt: checked.receipt });
    return true;
  },
});

/**
 * Countersign newly accepted records. Scheduled by recordActions when
 * ACTION_RECEIPTS_ENABLED is "true"; never on the write's own path. A record
 * whose receipt cannot be signed is retried a few times and otherwise stays
 * without one, which a verifier treats as no receipt.
 */
export const issueForRecords = internalAction({
  args: { recordIds: v.array(v.id("actionRecords")), attempt: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ issued: number; failed: number }> => {
    const attempt = args.attempt ?? 0;
    const failed: Id<"actionRecords">[] = [];
    let issued = 0;
    // One read of the service log and one signer for the whole batch; a plain
    // call, not a nested action, since both run in the same runtime.
    let served: string | null = null;
    let signer: ReturnType<typeof turnkeyServiceSigner> | null = null;
    try {
      served = await ctx.runQuery(internal.didLogs.getDidLogByPath, { path: SERVICE_DID_PATH });
      if (!served) throw new Error("No Boop service DID is published");
      signer = turnkeyServiceSigner(receiptSignerCredentials());
    } catch (error) {
      console.error("[receipts] cannot sign receipts:", error instanceof Error ? error.message : String(error));
    }
    for (const recordId of args.recordIds) {
      const owed = await ctx.runQuery(internal.receipts.awaitingReceipt, { recordId });
      if (!owed) continue;
      if (!served || !signer) { failed.push(recordId); continue; }
      try {
        const receipt: ActionRecordReceipt = await issueReceipt(served, owed, signer);
        if (await ctx.runMutation(internal.receipts.storeReceipt, { recordId, receipt })) issued++;
      } catch (error) {
        failed.push(recordId);
        console.error("[receipts] could not sign a receipt:", error instanceof Error ? error.message : String(error));
      }
    }
    if (failed.length > 0 && attempt < RETRY_DELAYS_MS.length) {
      await ctx.scheduler.runAfter(RETRY_DELAYS_MS[attempt], internal.receipts.issueForRecords, { recordIds: failed, attempt: attempt + 1 });
    }
    return { issued, failed: failed.length };
  },
});
