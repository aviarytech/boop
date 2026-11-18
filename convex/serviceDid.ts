/**
 * Publishing the Boop service did:webvh (#286 P3, plans/002 D11).
 *
 * The log is built and signed by the owner (scripts/boop-service-did.ts) with
 * the update key in the Turnkey parent org; Convex only checks it and serves
 * it beside the account DIDs, at /boop-service/did.jsonl. Run by hand:
 *   npx convex run serviceDid:publish '{"log":"…"}'
 */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { SERVICE_DID_PATH, currentReceiptKey } from "../shared/serviceDid";

type Published = { did: string; versionId: string; verificationMethod: string; publicKeyMultibase: string; entries: number };

export const publish = internalAction({
  args: { log: v.string() },
  handler: async (ctx, args): Promise<Published> => {
    const served = await ctx.runQuery(internal.didLogs.getDidLogRecordByPath, { path: SERVICE_DID_PATH });
    // The same check an account's log gets: a valid continuation of what is
    // served (same SCID, served entries unchanged, every entry signed by the
    // update keys before it), on this deployment's domain. No account keys
    // are pinned, so it is never an author DID.
    const checked = await ctx.runAction(internal.didLogValidation.checkWrite, {
      stored: served?.log ?? null, next: args.log, accounts: [],
      ...(process.env.WEBVH_DOMAIN ? { domain: process.env.WEBVH_DOMAIN } : {}),
    });
    if (!checked.ok) throw new Error(`Not a valid service DID log: ${checked.error}`);
    const key = currentReceiptKey(args.log);
    if ("problems" in key) throw new Error(`Not a Boop service DID: ${key.problems.join("; ")}`);
    if (key.did !== checked.did || key.versionId !== checked.versionId) throw new Error("The log's latest version is not the one it resolves to");
    await ctx.runMutation(internal.didLogs.upsertDidLog, {
      userDid: checked.did, path: SERVICE_DID_PATH, log: args.log, scid: checked.scid, versionId: checked.versionId, author: false,
      expected: served ? { userDid: served.userDid, log: served.log } : null,
    });
    return { did: key.did, versionId: key.versionId, verificationMethod: key.verificationMethod, publicKeyMultibase: key.publicKeyMultibase, entries: checked.entries };
  },
});
