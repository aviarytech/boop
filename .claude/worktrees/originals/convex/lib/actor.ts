/**
 * Shared actor resolver for HTTP handlers.
 *
 * Accepts either an API key (X-API-Key header) or the existing JWT session,
 * and resolves both to a single current DID plus a scope set. This is the only
 * new auth surface: the JWT path is unchanged and always resolves to scopes ["*"].
 */

import type { ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { requireAuth, AuthError } from "./auth";
import { hasScope, hashApiKey } from "./apiKeyHelpers";

export type ResolvedActor = {
  // Authorization identity. Everything downstream (ownership, canUserEditList)
  // keys off this. For an API key it's the key owner's DID, not the agent's —
  // so a key always acts *as its owner*. Distinct agent attribution is Step 5
  // and requires splitting authz-vs-attribution in the mutations first.
  did: string;
  // Legacy DID of a migrated Turnkey user, forwarded so the existing
  // canUserEditList/ownerDid checks still match lists owned under the old DID.
  // Only ever set on the JWT path; API keys are a clean, legacy-free surface.
  legacyDid?: string;
  scopes: string[]; // ["*"] for JWT sessions; the key's scopes otherwise
  viaApiKey: boolean;
};

type UserInfo = { did?: string; legacyDid?: string } | null;

/**
 * Resolve the actor behind a request. Prefers an API key; falls back to JWT.
 * @throws AuthError if neither credential is valid.
 */
export async function resolveActor(
  ctx: ActionCtx,
  request: Request
): Promise<ResolvedActor> {
  const apiKey = request.headers.get("X-API-Key");
  if (apiKey) {
    const keyHash = await hashApiKey(apiKey);
    const rec = await ctx.runQuery(internal.apiKeys.getByHash, { keyHash });
    if (!rec || rec.revokedAt) {
      throw new AuthError("Invalid API key", "INVALID_TOKEN");
    }
    return {
      did: rec.ownerDid,
      scopes: rec.scopes,
      viaApiKey: true,
    };
  }

  const auth = await requireAuth(request);
  const user = (await ctx.runQuery(api.auth.getUserByTurnkeyId, {
    turnkeySubOrgId: auth.turnkeySubOrgId,
  })) as UserInfo;
  if (!user?.did) {
    throw new AuthError("User not found", "UNAUTHORIZED");
  }
  return {
    did: user.did,
    legacyDid: user.legacyDid,
    scopes: ["*"],
    viaApiKey: false,
  };
}

/** Throw AuthError if the actor lacks the required scope. */
export function requireScope(actor: ResolvedActor, scope: string): void {
  if (!hasScope(actor.scopes, scope)) {
    throw new AuthError(`Missing scope: ${scope}`, "UNAUTHORIZED");
  }
}
