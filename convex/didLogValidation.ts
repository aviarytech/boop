"use node";

/**
 * Node half of DID log writes: didwebvh-ts resolves logs here, and the HTTP
 * handlers (didLogsHttp.ts, userHttp.ts) call it before storing anything.
 */
import { v } from "convex/values";
import { MultibaseEncoding, multibaseDecode, multibaseEncode } from "didwebvh-ts";
import { internalAction } from "./_generated/server";
import { checkDidLogWrite, DidLogRejectedError } from "./lib/authorDidLog";
import { ASSERTION_KEY_PATH, AUTHOR_KEY_PATH } from "../shared/authorDid";

/** A Solana-format Turnkey address is the base58 Ed25519 public key. */
function multikey(address: string): string {
  return multibaseEncode(new Uint8Array([0xed, 0x01, ...multibaseDecode(`z${address}`).bytes]), MultibaseEncoding.BASE58_BTC);
}

export const checkWrite = internalAction({
  args: {
    stored: v.union(v.string(), v.null()),
    next: v.string(),
    /** The account's Ed25519 Turnkey accounts (authInternal.listSubOrgEd25519Accounts). */
    accounts: v.array(v.object({ path: v.string(), address: v.string() })),
    domain: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<
    | { ok: true; did: string; scid: string; versionId: string; entries: number; author: boolean; authorProblems: string[] }
    | { ok: false; error: string }
  > => {
    try {
      const at = (path: string) => args.accounts.find(account => account.path === path)?.address;
      const author = at(AUTHOR_KEY_PATH);
      const assertion = at(ASSERTION_KEY_PATH);
      const checked = await checkDidLogWrite(args.stored, args.next, {
        domain: args.domain,
        keys: { authorKey: author && multikey(author), assertionKey: assertion && multikey(assertion) },
      });
      return { ok: true, ...checked, author: checked.authorProblems.length === 0 };
    } catch (error) {
      if (error instanceof DidLogRejectedError) return { ok: false, error: error.message };
      throw error;
    }
  },
});
