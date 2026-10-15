"use node";

/**
 * Asynchronous signer for action records. Scheduled by recordActions (and by
 * retries); signs each pending record with its owner's Turnkey sub-org key,
 * server-initiated like didCreation. All logic lives in lib/actionRecordSigner.
 */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { signActionRecords } from "./lib/actionRecordSigner";
import { turnkeySigningKey } from "./turnkeyHelpers";

export const sign = internalAction({
  args: { recordIds: v.array(v.id("actionRecords")) },
  handler: async (ctx, args): Promise<void> => {
    await signActionRecords(ctx, args.recordIds, subOrgId => turnkeySigningKey(subOrgId));
  },
});
