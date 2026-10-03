import type { ActionCtx } from "../_generated/server";
import { api } from "../_generated/api";
import { AuthError, requireAuth } from "./auth";

export type AuthenticatedUser = {
  did: string;
  legacyDid?: string;
  turnkeySubOrgId?: string;
};

/**
 * Resolve authenticated user from JWT and users table.
 */
export async function requireAuthenticatedUser(
  ctx: ActionCtx,
  request: Request
): Promise<AuthenticatedUser> {
  const auth = await requireAuth(request);
  const user = await ctx.runQuery(api.auth.getUserByTurnkeyId, {
    turnkeySubOrgId: auth.turnkeySubOrgId,
  }) as { did: string; legacyDid?: string } | null;

  if (!user) {
    throw new AuthError("User not found", "UNAUTHORIZED");
  }

  return {
    did: user.did,
    legacyDid: user.legacyDid,
    turnkeySubOrgId: auth.turnkeySubOrgId,
  };
}
