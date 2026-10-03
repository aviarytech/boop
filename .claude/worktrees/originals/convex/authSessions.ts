/**
 * Auth session storage functions for server-side OTP authentication.
 *
 * Since Convex is serverless, we can't use in-memory session storage.
 * Instead, we store OTP sessions in the Convex database with TTL cleanup.
 *
 * Session timeout is 15 minutes to match Turnkey OTP expiration.
 */

import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";

// Session timeout (15 minutes in milliseconds)
const SESSION_TIMEOUT = 15 * 60 * 1000;

/**
 * Create a new auth session.
 */
export const createSession = mutation({
  args: {
    sessionId: v.string(),
    email: v.string(),
    subOrgId: v.optional(v.string()),
    otpId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("authSessions", {
      sessionId: args.sessionId,
      email: args.email,
      subOrgId: args.subOrgId,
      otpId: args.otpId,
      timestamp: now,
      verified: false,
      expiresAt: now + SESSION_TIMEOUT,
    });
  },
});

/**
 * Get an auth session by session ID.
 * Returns null if session doesn't exist or has expired.
 */
export const getSession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) return null;

    // Check if expired
    if (Date.now() > session.expiresAt) {
      return null;
    }

    return session;
  },
});

/**
 * Update a session after successful OTP verification.
 */
export const markSessionVerified = mutation({
  args: {
    sessionId: v.string(),
    subOrgId: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      throw new Error("Session not found");
    }

    if (Date.now() > session.expiresAt) {
      throw new Error("Session expired");
    }

    await ctx.db.patch(session._id, {
      verified: true,
      subOrgId: args.subOrgId,
    });

    return session._id;
  },
});

/**
 * Delete a session (cleanup after login or logout).
 */
export const deleteSession = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("authSessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (session) {
      await ctx.db.delete(session._id);
    }
  },
});

/**
 * Internal mutation to clean up expired sessions.
 * Called by scheduled job.
 */
export const cleanupExpiredSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expiredSessions = await ctx.db
      .query("authSessions")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
      .collect();

    let deletedCount = 0;
    for (const session of expiredSessions) {
      await ctx.db.delete(session._id);
      deletedCount++;
    }

    if (deletedCount > 0) {
      console.log(`[authSessions] Cleaned up ${deletedCount} expired sessions`);
    }

    return deletedCount;
  },
});
