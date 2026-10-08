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
 * ownership check. As a public mutation this was directly callable by anyone
 * with the deployment URL. Go through didLogsHttp.storeDidLog.
 */
export const upsertDidLog = internalMutation({
  args: {
    userDid: v.string(),
    path: v.string(),
    log: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("didLogs")
      .withIndex("by_user_did", (q) => q.eq("userDid", args.userDid))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        log: args.log,
        path: args.path,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("didLogs", {
      userDid: args.userDid,
      path: args.path,
      log: args.log,
      updatedAt: Date.now(),
    });
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
