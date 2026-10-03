/**
 * Referral growth loop — invite a friend, unlock +1 list.
 *
 * Flow:
 * 1. User calls getOrCreateReferralCode to get their unique invite link.
 * 2. Friend visits /invite/:code, stores code in localStorage, signs up.
 * 3. After signup, frontend calls redeemReferral with the stored code.
 * 4. redeemReferral validates the code, records the referral, and awards
 *    the referrer +1 bonus list slot.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  // Use crypto.getRandomValues if available, otherwise Math.random
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  for (const byte of array) {
    code += chars[byte % chars.length];
  }
  return code;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Get the referral code for a user (by userId). Returns null if none exists yet.
 */
export const getReferralCode = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("referralCodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
  },
});

/**
 * Get referral stats for a user: total successful referrals and Pro credit status.
 */
export const getReferralStats = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const referrals = await ctx.db
      .query("referrals")
      .withIndex("by_referrer", (q) => q.eq("referrerId", userId))
      .collect();
    const user = await ctx.db.get(userId);
    return {
      totalReferrals: referrals.length,
      referralProUntil: user?.referralProUntil ?? null,
    };
  },
});

/**
 * Get referral Pro credit status for the current user (as referee).
 * Returns whether they came via referral and when their Pro expires.
 */
export const getReferralProStatus = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const referral = await ctx.db
      .query("referrals")
      .withIndex("by_referee", (q) => q.eq("refereeId", userId))
      .first();
    return {
      referralProUntil: user?.referralProUntil ?? null,
      pendingProGrant: referral != null && !referral.proGrantedAt,
    };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Get or create a referral code for the current user.
 * Idempotent — always returns the same code for the same user.
 */
export const getOrCreateReferralCode = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    // Return existing code if one exists
    const existing = await ctx.db
      .query("referralCodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (existing) return existing.code;

    // Generate a unique code
    let code: string;
    let attempts = 0;
    do {
      code = generateCode();
      attempts++;
      if (attempts > 10) {
        throw new Error("Failed to generate unique referral code");
      }
      const conflict = await ctx.db
        .query("referralCodes")
        .withIndex("by_code", (q) => q.eq("code", code))
        .first();
      if (!conflict) break;
    } while (true);

    await ctx.db.insert("referralCodes", {
      userId,
      code,
      createdAt: Date.now(),
    });

    return code;
  },
});

/**
 * Redeem a referral code after a new user signs up.
 *
 * - Validates the code exists and wasn't created by the referee themselves.
 * - Ensures the referee hasn't already redeemed a referral.
 * - Records the referral and awards the referrer +1 bonus list.
 *
 * Safe to call multiple times — idempotent via the referee uniqueness check.
 */
export const redeemReferral = mutation({
  args: {
    code: v.string(),
    refereeUserId: v.id("users"),
  },
  handler: async (ctx, { code, refereeUserId }) => {
    // Look up the referral code
    const referralCode = await ctx.db
      .query("referralCodes")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();

    if (!referralCode) {
      // Invalid code — silently ignore (don't expose which codes exist)
      return { success: false, reason: "invalid_code" };
    }

    // Prevent self-referral
    if (referralCode.userId === refereeUserId) {
      return { success: false, reason: "self_referral" };
    }

    // Check if this referee has already redeemed a referral
    const alreadyRedeemed = await ctx.db
      .query("referrals")
      .withIndex("by_referee", (q) => q.eq("refereeId", refereeUserId))
      .first();

    if (alreadyRedeemed) {
      return { success: false, reason: "already_redeemed" };
    }

    // Record the referral — Pro credit is awarded when the referee creates their first list
    await ctx.db.insert("referrals", {
      referralCodeId: referralCode._id,
      referrerId: referralCode.userId,
      refereeId: refereeUserId,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});
