import { authorizeResources } from "./lib/permissions";
import { requireSession } from "./lib/session";
import { v } from "convex/values";
import { internalQuery, internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { authenticate, type ResolvedActor } from "./lib/actor";
import { verifyAuthToken } from "./lib/jwt";
import { hashApiKey } from "./lib/apiKeyHelpers";
import { AuthError } from "./lib/auth";

export const resolve = internalQuery({
  args: { authToken: v.optional(v.string()), apiKey: v.optional(v.string()) },
  handler: (ctx, args): Promise<ResolvedActor> => authenticate(ctx, args),
});

// Establishing a record proves possession of a signed session, never a DID.
const establishOperation = {
  args: { authToken: v.string() },
  handler: async (ctx: import("./_generated/server").MutationCtx, args: { authToken: string }) => {
    const session = await verifyAuthToken(args.authToken).catch(() => {
      throw new AuthError("Invalid or expired token", "INVALID_TOKEN");
    });
    const tokenHash = await hashApiKey(args.authToken);
    const existing = await ctx.db.query("accessSessions").withIndex("by_hash", q => q.eq("tokenHash", tokenHash)).first();
    if (existing) {
      if (existing.revokedAt !== undefined) throw new AuthError("Invalid or expired token", "INVALID_TOKEN");
      return;
    }
    const user = await ctx.db.query("users").withIndex("by_turnkey_id", q => q.eq("turnkeySubOrgId", session.turnkeySubOrgId)).first();
    if (!user) throw new AuthError("User not found", "UNAUTHORIZED");
    const id = await ctx.db.insert("accessSessions", { tokenHash, subject: session.turnkeySubOrgId, expiresAt: session.expiresAt });
    await ctx.scheduler.runAt(session.expiresAt, internal.actorSession.expire, { id });
  },
};
export const establish = mutation(establishOperation);
export const establishInternal = internalMutation(establishOperation);
export const expire = internalMutation({
  args: { id: v.id("accessSessions") },
  handler: async (ctx, { id }) => {
    const record = await ctx.db.get(id);
    if (record && record.expiresAt <= Date.now()) await ctx.db.delete(id);
  },
});
const revokeOperation = {
  args: { authToken: v.string() },
  handler: async (ctx: import("./_generated/server").MutationCtx, args: { authToken: string }) => {
    const tokenHash = await hashApiKey(args.authToken);
    const record = await ctx.db.query("accessSessions").withIndex("by_hash", q => q.eq("tokenHash", tokenHash)).first();
    if (record) {
      await ctx.db.patch(record._id, { revokedAt: Date.now() });
    } else {
      // A pre-rollout JWT can be logged out before its first authenticated call.
      const session = await verifyAuthToken(args.authToken);
      const id = await ctx.db.insert("accessSessions", { tokenHash, subject: session.turnkeySubOrgId, expiresAt: session.expiresAt, revokedAt: Date.now() });
      await ctx.scheduler.runAt(session.expiresAt, internal.actorSession.expire, { id });
    }
  },
};
export const revoke = mutation(revokeOperation);
export const revokeInternal = internalMutation(revokeOperation);

export const identity = internalQuery({
  args: { authToken: v.string() },
  handler: (ctx, args) => requireSession(ctx, args.authToken),
});

export const authorize = internalQuery({
  args: {
    authToken: v.optional(v.string()), apiKey: v.optional(v.string()),
    resources: v.object({
      lists: v.optional(v.array(v.union(v.id("lists"), v.null()))),
      items: v.optional(v.array(v.union(v.id("items"), v.null()))),
      anchors: v.optional(v.array(v.union(v.id("bitcoinAnchors"), v.null()))),
      accounts: v.optional(v.array(v.union(v.id("users"), v.null()))),
    }),
  },
  handler: async (ctx, args): Promise<void> => {
    const actor = await authenticate(ctx, args);
    await authorizeResources(ctx, actor, {
      lists: args.resources.lists?.filter(id => id !== null),
      items: args.resources.items?.filter(id => id !== null),
      anchors: args.resources.anchors?.filter(id => id !== null),
      accounts: args.resources.accounts?.filter(id => id !== null),
    });
  },
});
