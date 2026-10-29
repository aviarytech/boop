/**
 * DID log storage and retrieval for did:webvh resolution.
 *
 * Stores DID logs in Convex so they can be served at
 * https://boop.ad/{path}/did.jsonl for DID resolution.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Store or update a user's DID log.
 *
 * Internal: it writes whatever `userDid` it is handed, so the caller owns the
 * ownership and continuation checks (didLogsHttp.checkAccountDidLog). As a
 * public mutation this was directly callable by anyone with the deployment
 * URL. Go through didLogsHttp.storeDidLog.
 */
export const upsertDidLog = internalMutation({
  args: {
    userDid: v.string(),
    path: v.string(),
    log: v.string(),
    scid: v.string(),
    versionId: v.string(),
    author: v.boolean(),
    /** What the caller checked against: the row served at `path` then, or null for none. */
    expected: v.union(v.object({ userDid: v.string(), log: v.string() }), v.null()),
  },
  handler: async (ctx, { expected, ...row }) => {
    const existing = await ctx.db
      .query("didLogs")
      .withIndex("by_path", (q) => q.eq("path", row.path))
      .first();
    const unchanged = existing
      ? expected !== null && existing.userDid === expected.userDid && existing.log === expected.log
      : expected === null;
    if (!unchanged) {
      throw new Error("DID log conflict: the served log changed; fetch it and retry");
    }
    // Replacing another DID's log: only one no account holds, checked here in
    // the write's own transaction, not before the caller's slow checks (#300 review).
    if (existing && existing.userDid !== row.userDid) {
      const holder = await ctx.db.query("users").withIndex("by_did", (q) => q.eq("did", existing.userDid)).first();
      if (holder) throw new Error("DID log conflict: an account holds the served DID");
    }
    if (existing) {
      await ctx.db.patch(existing._id, { ...row, updatedAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("didLogs", { ...row, updatedAt: Date.now() });
  },
});

/**
 * Get a DID log by path (for resolution). Served publicly by the HTTP resolver;
 * the lookups themselves are internal so only that projection is exposed.
 */
export const getDidLogByPath = internalQuery({
  args: { path: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("didLogs")
      .withIndex("by_path", (q) => q.eq("path", args.path))
      .first();
    return record?.log ?? null;
  },
});

/**
 * Get the full DID log record by path (includes userDid).
 */
export const getDidLogRecordByPath = internalQuery({
  args: { path: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("didLogs")
      .withIndex("by_path", (q) => q.eq("path", args.path))
      .first();
  },
});

/**
 * Get a DID log by user DID.
 */
export const getDidLogByUserDid = internalQuery({
  args: { userDid: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("didLogs")
      .withIndex("by_user_did", (q) => q.eq("userDid", args.userDid))
      .first();
    return record ?? null;
  },
});

/**
 * A DID-less account adopts the author DID its path serves. Every condition
 * is re-checked in this one transaction, so a concurrent write can't leave
 * the account on one DID and its path serving another (#300 review).
 */
export const adoptServedAuthorDid = internalMutation({
  args: { turnkeySubOrgId: v.string(), did: v.string() },
  handler: async (ctx, args): Promise<"adopted" | "conflict"> => {
    const user = await ctx.db.query("users").withIndex("by_turnkey_id", (q) => q.eq("turnkeySubOrgId", args.turnkeySubOrgId)).first();
    if (!user || user.deletionRequestedAt !== undefined) return "conflict";
    if (user.did === args.did) return "adopted";
    if (user.did) return "conflict";
    const served = await ctx.db.query("didLogs").withIndex("by_user_did", (q) => q.eq("userDid", args.did)).first();
    if (!served?.author) return "conflict";
    const claimed = await ctx.db.query("users").withIndex("by_did", (q) => q.eq("did", args.did)).first()
      ?? await ctx.db.query("users").withIndex("by_legacy_did", (q) => q.eq("legacyDid", args.did)).first();
    if (claimed && claimed._id !== user._id) return "conflict";
    await ctx.db.patch(user._id, { did: args.did, lastLoginAt: Date.now() });
    return "adopted";
  },
});
