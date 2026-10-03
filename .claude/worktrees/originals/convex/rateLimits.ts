/**
 * Rate limit mutations and queries for auth endpoint protection.
 *
 * Phase 9.2: Rate limiting for /auth/initiate and /auth/verify endpoints.
 *
 * Uses a sliding window approach with Convex database storage (serverless-compatible).
 */

import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Rate limit configuration
export const RATE_LIMITS = {
  initiate: {
    maxAttempts: 10, // 10 attempts per window
    windowMs: 60 * 1000, // 1 minute window
  },
  verify: {
    maxAttempts: 5, // 5 attempts per window
    windowMs: 60 * 1000, // 1 minute window
  },
} as const;

export type RateLimitEndpoint = keyof typeof RATE_LIMITS;

/**
 * Check if a rate limit has been exceeded and increment the counter.
 *
 * Returns { allowed: true } if within limits, or { allowed: false, retryAfterMs }
 * if rate limited.
 */
export const checkAndIncrement = mutation({
  args: {
    key: v.string(),
    endpoint: v.union(v.literal("initiate"), v.literal("verify")),
  },
  returns: v.object({
    allowed: v.boolean(),
    retryAfterMs: v.optional(v.number()),
    currentAttempts: v.number(),
  }),
  handler: async (ctx, { key, endpoint }) => {
    const now = Date.now();
    const config = RATE_LIMITS[endpoint];

    // Find existing rate limit record
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key_endpoint", (q) => q.eq("key", key).eq("endpoint", endpoint))
      .first();

    if (existing) {
      // Check if window has expired
      const windowExpired = now - existing.windowStart >= config.windowMs;

      if (windowExpired) {
        // Reset window
        await ctx.db.patch(existing._id, {
          attempts: 1,
          windowStart: now,
          expiresAt: now + config.windowMs * 2, // Keep for 2x window for cleanup buffer
        });
        return { allowed: true, currentAttempts: 1 };
      }

      // Window still active - check if over limit
      if (existing.attempts >= config.maxAttempts) {
        const retryAfterMs = config.windowMs - (now - existing.windowStart);
        return {
          allowed: false,
          retryAfterMs: Math.max(0, retryAfterMs),
          currentAttempts: existing.attempts,
        };
      }

      // Increment counter
      const newAttempts = existing.attempts + 1;
      await ctx.db.patch(existing._id, { attempts: newAttempts });

      // Check if this increment puts us at the limit
      if (newAttempts >= config.maxAttempts) {
        const retryAfterMs = config.windowMs - (now - existing.windowStart);
        return {
          allowed: true, // Still allowed for this request
          retryAfterMs: Math.max(0, retryAfterMs), // But next one will be blocked
          currentAttempts: newAttempts,
        };
      }

      return { allowed: true, currentAttempts: newAttempts };
    }

    // No existing record - create new one
    await ctx.db.insert("rateLimits", {
      key,
      endpoint,
      attempts: 1,
      windowStart: now,
      expiresAt: now + config.windowMs * 2,
    });

    return { allowed: true, currentAttempts: 1 };
  },
});

/**
 * Check rate limit status without incrementing.
 *
 * Useful for checking limits before expensive operations.
 */
export const checkStatus = query({
  args: {
    key: v.string(),
    endpoint: v.union(v.literal("initiate"), v.literal("verify")),
  },
  returns: v.object({
    allowed: v.boolean(),
    retryAfterMs: v.optional(v.number()),
    currentAttempts: v.number(),
    remainingAttempts: v.number(),
  }),
  handler: async (ctx, { key, endpoint }) => {
    const now = Date.now();
    const config = RATE_LIMITS[endpoint];

    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key_endpoint", (q) => q.eq("key", key).eq("endpoint", endpoint))
      .first();

    if (!existing) {
      return {
        allowed: true,
        currentAttempts: 0,
        remainingAttempts: config.maxAttempts,
      };
    }

    // Check if window has expired
    const windowExpired = now - existing.windowStart >= config.windowMs;
    if (windowExpired) {
      return {
        allowed: true,
        currentAttempts: 0,
        remainingAttempts: config.maxAttempts,
      };
    }

    const remaining = Math.max(0, config.maxAttempts - existing.attempts);
    const retryAfterMs = config.windowMs - (now - existing.windowStart);

    return {
      allowed: remaining > 0,
      retryAfterMs: remaining > 0 ? undefined : Math.max(0, retryAfterMs),
      currentAttempts: existing.attempts,
      remainingAttempts: remaining,
    };
  },
});

/**
 * Clear all rate limits (internal use only - never expose to clients).
 */
export const clearAll = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const all = await ctx.db.query("rateLimits").collect();
    for (const record of all) {
      await ctx.db.delete(record._id);
    }
    return all.length;
  },
});

/**
 * Clean up expired rate limit records.
 *
 * Run periodically to prevent table bloat.
 */
export const cleanupExpired = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    let deleted = 0;

    // Find and delete expired records (batch of 100 at a time)
    const expired = await ctx.db
      .query("rateLimits")
      .withIndex("by_expires_at", (q) => q.lt("expiresAt", now))
      .take(100);

    for (const record of expired) {
      await ctx.db.delete(record._id);
      deleted++;
    }

    return deleted;
  },
});
