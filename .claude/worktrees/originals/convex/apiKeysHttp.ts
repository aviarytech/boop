/**
 * HTTP action handlers for API-key management.
 *
 * These endpoints are JWT-only: you cannot mint or revoke keys with a key.
 * They use the existing requireAuth + getUserByTurnkeyId pattern (not resolveActor).
 *
 * The raw key is returned exactly once, on creation. Only its hash is stored.
 */

import { httpAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  requireAuth,
  AuthError,
  unauthorizedResponseWithCors,
} from "./lib/auth";
import { jsonResponse, errorResponse, handlerErrorResponse } from "./lib/httpResponses";
import {
  generateApiKey,
  hashApiKey,
  formatKeyPrefix,
  sanitizeScopes,
  AGENT_SCOPES,
} from "./lib/apiKeyHelpers";

type UserInfo = { did?: string } | null;

/**
 * Resolve the JWT-authenticated user's DID, or null if unauthenticated/not found.
 * Throws AuthError on missing/invalid token (handled by callers' catch).
 */
async function requireUserDid(
  ctx: ActionCtx,
  request: Request
): Promise<string | null> {
  const auth = await requireAuth(request);
  const user = (await ctx.runQuery(api.auth.getUserByTurnkeyId, {
    turnkeySubOrgId: auth.turnkeySubOrgId,
  })) as UserInfo;
  return user?.did ?? null;
}

/**
 * POST /api/v1/keys
 *
 * Create a new API key. Requires JWT auth.
 * Request: { "label": "...", "scopes"?: ["..."] }
 * Response: { "id": "...", "key": "<RAW KEY - shown once>", "prefix": "..." }
 */
export const createApiKey = httpAction(async (ctx, request) => {
  try {
    const ownerDid = await requireUserDid(ctx, request);
    if (!ownerDid) {
      return errorResponse(request, "User not found", 404);
    }

    const body = (await request.json()) as {
      label?: string;
      scopes?: string[];
    };
    const label = body.label?.trim();
    if (!label) {
      return errorResponse(request, "label is required");
    }
    // Never trust caller-supplied scopes: strip "*"/unknown so a key can't be
    // minted with more authority than the agent surface grants.
    const scopes =
      Array.isArray(body.scopes) && body.scopes.length > 0
        ? sanitizeScopes(body.scopes)
        : [...AGENT_SCOPES];
    if (scopes.length === 0) {
      return errorResponse(
        request,
        `scopes must be a non-empty subset of: ${AGENT_SCOPES.join(", ")}`
      );
    }

    const rawKey = generateApiKey();
    const keyHash = await hashApiKey(rawKey);
    const prefix = formatKeyPrefix(rawKey);

    const id = await ctx.runMutation(internal.apiKeys.createKey, {
      ownerDid,
      keyHash,
      prefix,
      label,
      scopes,
    });

    // Raw key is returned exactly once and never stored.
    return jsonResponse(request, { id, key: rawKey, prefix });
  } catch (error) {
    if (error instanceof AuthError) {
      return unauthorizedResponseWithCors(request, error.message);
    }
    console.error("[apiKeysHttp] createApiKey error:", error);
    return handlerErrorResponse(
      request,
      error,
      "Failed to create API key"
    );
  }
});

/**
 * GET /api/v1/keys
 *
 * List the caller's active keys (no hashes, no raw keys). Requires JWT auth.
 * Response: { "keys": [{ id, prefix, label, scopes, createdAt }] }
 */
export const listApiKeys = httpAction(async (ctx, request) => {
  try {
    const ownerDid = await requireUserDid(ctx, request);
    if (!ownerDid) {
      return errorResponse(request, "User not found", 404);
    }

    const keys = await ctx.runQuery(internal.apiKeys.listForOwner, { ownerDid });
    return jsonResponse(request, { keys });
  } catch (error) {
    if (error instanceof AuthError) {
      return unauthorizedResponseWithCors(request, error.message);
    }
    console.error("[apiKeysHttp] listApiKeys error:", error);
    return handlerErrorResponse(
      request,
      error,
      "Failed to list API keys"
    );
  }
});

/**
 * DELETE /api/v1/keys?keyId=<id>
 *
 * Revoke a key the caller owns. Requires JWT auth.
 * The Convex router has no :param path segments, so keyId is a query param.
 * Response: { "success": true }
 */
export const revokeApiKey = httpAction(async (ctx, request) => {
  try {
    const ownerDid = await requireUserDid(ctx, request);
    if (!ownerDid) {
      return errorResponse(request, "User not found", 404);
    }

    const keyId = new URL(request.url).searchParams.get("keyId");
    if (!keyId) {
      return errorResponse(request, "keyId query parameter is required");
    }

    const revoked = await ctx.runMutation(internal.apiKeys.revokeKey, {
      keyId: keyId as Id<"agentApiKeys">,
      ownerDid,
    });
    if (!revoked) {
      return errorResponse(request, "API key not found", 404);
    }

    return jsonResponse(request, { success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return unauthorizedResponseWithCors(request, error.message);
    }
    console.error("[apiKeysHttp] revokeApiKey error:", error);
    return handlerErrorResponse(
      request,
      error,
      "Failed to revoke API key"
    );
  }
});
