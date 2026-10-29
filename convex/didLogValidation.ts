"use node";

/**
 * Node half of DID log writes: didwebvh-ts resolves logs here, and the HTTP
 * handlers (didLogsHttp.ts, userHttp.ts) call it before storing anything.
 */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { checkDidLogWrite, DidLogRejectedError } from "./lib/authorDidLog";

export const checkWrite = internalAction({
  args: { stored: v.union(v.string(), v.null()), next: v.string() },
  handler: async (_ctx, args): Promise<
    | { ok: true; did: string; scid: string; versionId: string; entries: number; author: boolean; authorProblems: string[] }
    | { ok: false; error: string }
  > => {
    try {
      const checked = await checkDidLogWrite(args.stored, args.next);
      return { ok: true, ...checked, author: checked.authorProblems.length === 0 };
    } catch (error) {
      if (error instanceof DidLogRejectedError) return { ok: false, error: error.message };
      throw error;
    }
  },
});
