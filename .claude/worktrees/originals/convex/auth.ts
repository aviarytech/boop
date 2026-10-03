/**
 * Auth-related Convex functions for Turnkey authentication.
 *
 * Handles user registration and session management for Turnkey-authenticated users.
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Register or update a user after Turnkey authentication.
 *
 * Called after successful OTP verification. Creates a new user if the Turnkey
 * sub-organization ID is not found, otherwise updates the existing user's
 * last login timestamp.
 *
 * Migration flow: When legacyDid is provided, it means the user is migrating
 * from localStorage identity to Turnkey. We look up by legacyDid, update their
 * primary DID to the new Turnkey DID, and store the old DID as legacyDid.
 */
export const upsertUser = mutation({
  args: {
    turnkeySubOrgId: v.string(),
    email: v.string(),
    did: v.optional(v.string()),
    displayName: v.optional(v.string()),
    // Migration: the user's old localStorage DID being migrated
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Find existing user by Turnkey ID (already migrated user returning)
    const existingByTurnkey = await ctx.db
      .query("users")
      .withIndex("by_turnkey_id", (q) => q.eq("turnkeySubOrgId", args.turnkeySubOrgId))
      .first();

    if (existingByTurnkey) {
      // Update last login, and upgrade DID if provided and not yet set
      const patch: Record<string, unknown> = { lastLoginAt: Date.now() };
      if (args.did && (!existingByTurnkey.did || !existingByTurnkey.did.startsWith("did:webvh:"))) {
        patch.did = args.did;
      }
      await ctx.db.patch(existingByTurnkey._id, patch);
      return existingByTurnkey._id;
    }

    // Migration case: If legacyDid is provided, find user by their old DID
    const legacyDid = args.legacyDid;
    if (legacyDid) {
      const existingByLegacyDid = await ctx.db
        .query("users")
        .withIndex("by_did", (q) => q.eq("did", legacyDid))
        .first();

      if (existingByLegacyDid) {
        // Migrate user: update DID to new Turnkey DID, store old DID as legacy
        await ctx.db.patch(existingByLegacyDid._id, {
          did: args.did, // New Turnkey DID
          legacyDid, // Store old DID for list lookup
          turnkeySubOrgId: args.turnkeySubOrgId,
          email: args.email,
          lastLoginAt: Date.now(),
          legacyIdentity: false,
        });
        return existingByLegacyDid._id;
      }
    }

    // Check if user exists by the new Turnkey DID (edge case: same DID)
    const existingByDid = await ctx.db
      .query("users")
      .withIndex("by_did", (q) => q.eq("did", args.did))
      .first();

    if (existingByDid) {
      // Link Turnkey to existing user
      await ctx.db.patch(existingByDid._id, {
        turnkeySubOrgId: args.turnkeySubOrgId,
        email: args.email,
        lastLoginAt: Date.now(),
        legacyIdentity: false,
      });
      return existingByDid._id;
    }

    // Create new user (DID will be set client-side via /api/user/updateDID)
    const displayName = args.displayName ?? args.email.split("@")[0];
    const newUserId = await ctx.db.insert("users", {
      turnkeySubOrgId: args.turnkeySubOrgId,
      email: args.email,
      did: args.did, // undefined on first create — client upgrades to did:webvh
      displayName,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    });

    // Send welcome email on signup (fire-and-forget, silently skips if no RESEND_API_KEY)
    await ctx.scheduler.runAfter(0, internal.feedback.sendWelcomeEmail, {
      email: args.email,
      displayName,
    });

    return newUserId;
  },
});

/**
 * Get a user by their Turnkey sub-organization ID.
 */
export const getUserByTurnkeyId = query({
  args: { turnkeySubOrgId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_turnkey_id", (q) => q.eq("turnkeySubOrgId", args.turnkeySubOrgId))
      .first();
  },
});

/**
 * Get a user by their email address.
 */
export const getUserByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
  },
});
