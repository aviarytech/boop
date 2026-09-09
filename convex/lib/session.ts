import type { QueryCtx, MutationCtx } from "../_generated/server";
import { hashApiKey } from "./apiKeyHelpers";
import { verifyAuthToken } from "./jwt";
import { AuthError } from "./auth";

/** Read the expiring DB record so logout/expiry invalidates reactive query caches. */
export async function requireSession(ctx: QueryCtx | MutationCtx, token?: string) {
  if (!token) throw new AuthError("Authentication required", "UNAUTHORIZED");
  let session;
  try { session = await verifyAuthToken(token); }
  catch { throw new AuthError("Invalid or expired token", "INVALID_TOKEN"); }
  const tokenHash = await hashApiKey(token);
  const record = await ctx.db.query("accessSessions").withIndex("by_hash", q => q.eq("tokenHash", tokenHash)).first();
  if (!record || record.revokedAt !== undefined || record.expiresAt <= Date.now() || record.subject !== session.turnkeySubOrgId) {
    throw new AuthError("Authentication required: restore your session", "UNAUTHORIZED");
  }
  return session;
}
