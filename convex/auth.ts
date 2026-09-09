import { requireSession } from "./lib/session";
/**
 * Auth-related Convex functions for Turnkey authentication.
 *
 * Handles user registration and session management for Turnkey-authenticated users.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";

/**
 * Register or update a user after Turnkey authentication.
 *
 * Called after successful OTP verification. Creates a new user if the Turnkey
 * sub-organization ID is not found, otherwise updates the existing user's
 * last login timestamp.
 *
 * Existing verified account links are preserved. New links cannot be established
 * by asserting a current or legacy DID.
 */
export const upsertUserInternal = internalMutation({
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

    // A supplied new DID must never take over another current or migrated account.
    if (args.did) {
      const claimed = await ctx.db.query("users").withIndex("by_did", q => q.eq("did", args.did)).first()
        ?? await ctx.db.query("users").withIndex("by_legacy_did", q => q.eq("legacyDid", args.did)).first();
      if (claimed && claimed._id !== existingByTurnkey?._id) throw new Error("Not authorized to claim this DID");
    }
    if (args.legacyDid) throw new Error("Identity migration requires verified account linking");
    if (existingByTurnkey) {
      if (existingByTurnkey.email !== args.email) {
        throw new Error("This identity is linked to a different email.");
      }
      // The operator may have repaired an account while its OTP was in flight.
      const account = await resolveLoginAccount(ctx, args.email);
      if (account?.turnkeySubOrgId !== args.turnkeySubOrgId) {
        throw new Error("Your account changed. Please request a new code.");
      }
      // Update last login, and upgrade DID if provided and not yet set
      const patch: Record<string, unknown> = { lastLoginAt: Date.now() };
      if (args.did && (!existingByTurnkey.did || !existingByTurnkey.did.startsWith("did:webvh:"))) {
        patch.did = args.did;
      }
      await ctx.db.patch(existingByTurnkey._id, patch);
      return existingByTurnkey._id;
    }

    // This index read and insert share a Convex transaction. If two signup
    // sessions provision different identities, only the first may create a user.
    const existingByEmail = await ctx.db.query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email)).first();
    if (existingByEmail) {
      throw new Error("An account already exists for this email. Please request a new code.");
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
export const getUserByTurnkeyIdInternal = internalQuery({
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
export const getUserByEmailInternal = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
  },
});

async function resolveLoginAccount(
  ctx: Pick<QueryCtx, "db">,
  email: string,
): Promise<{ turnkeySubOrgId: string } | null> {
  const users = await ctx.db.query("users")
    .withIndex("by_email", (q) => q.eq("email", email)).collect();
  if (users.length === 0) return null;

  const selected = users.filter((user) => user.isCanonicalLogin === true);
  const user = selected.length === 1 ? selected[0]
    : selected.length === 0 && users.length === 1 && users[0].isCanonicalLogin !== false
      ? users[0] : null;
  if (!user?.turnkeySubOrgId) {
    throw new Error("This email needs account recovery. Please contact support.");
  }
  return { turnkeySubOrgId: user.turnkeySubOrgId };
}

/** Resolve only an application-owned account; never infer one from Turnkey order. */
export const getLoginAccount = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }): Promise<{ turnkeySubOrgId: string } | null> => {
    return resolveLoginAccount(ctx, email);
  },
});

/** Operator-only repair: choose a verified existing account without moving its data. */
export const selectLoginAccount = internalMutation({
  args: { email: v.string(), userId: v.id("users") },
  handler: async (ctx, { email, userId }) => {
    const user = await ctx.db.get(userId);
    if (!user || user.email !== email) throw new Error("User does not match the email.");
    if (!user.turnkeySubOrgId) throw new Error("User has no Turnkey identity; account recovery is required.");
    const users = await ctx.db.query("users")
      .withIndex("by_email", (q) => q.eq("email", email)).collect();
    const previous = users.map((row) => ({ userId: row._id, isCanonicalLogin: row.isCanonicalLogin ?? null }));
    for (const row of users) {
      await ctx.db.patch(row._id, { isCanonicalLogin: row._id === userId });
    }
    return { userId, turnkeySubOrgId: user.turnkeySubOrgId, previous };
  },
});

// Preserve public names during rollout. Only a verified session may access its account.
export const getUserByTurnkeyId = query({
  args: { turnkeySubOrgId: v.string(), authToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.authToken);
    if (auth.turnkeySubOrgId !== args.turnkeySubOrgId) throw new Error("Not authorized");
    return ctx.db.query("users").withIndex("by_turnkey_id", q => q.eq("turnkeySubOrgId", auth.turnkeySubOrgId)).first();
  },
});
export const getUserByEmail = query({
  args: { email: v.string(), authToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.authToken);
    if (auth.email !== args.email) throw new Error("Not authorized");
    return ctx.db.query("users").withIndex("by_turnkey_id", q => q.eq("turnkeySubOrgId", auth.turnkeySubOrgId)).first();
  },
});
export const upsertUser = mutation({
  args: { turnkeySubOrgId: v.string(), email: v.string(), did: v.optional(v.string()), displayName: v.optional(v.string()), legacyDid: v.optional(v.string()), authToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.authToken);
    if (auth.turnkeySubOrgId !== args.turnkeySubOrgId || auth.email !== args.email) throw new Error("Not authorized");
    const user = await ctx.db.query("users").withIndex("by_turnkey_id", q => q.eq("turnkeySubOrgId", auth.turnkeySubOrgId)).first();
    if (!user || (args.did && args.did !== user.did) || (args.legacyDid && args.legacyDid !== user.legacyDid)) throw new Error("Not authorized to assert identity; use authenticated account setup");
    await ctx.db.patch(user._id, { lastLoginAt: Date.now() });
    return user._id;
  },
});
