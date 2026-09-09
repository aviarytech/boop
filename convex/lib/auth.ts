import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
/**
 * Authentication helper for protecting Convex HTTP actions.
 *
 * Extracts and validates JWT from HTTP requests.
 */

import {
  extractTokenFromRequest,
  type AuthTokenPayload,
} from "./jwt";
import { getCorsHeaders } from "./httpResponses";

export type { AuthTokenPayload };

import { AuthError } from "./authError";
export { AuthError } from "./authError";

/**
 * Require authentication for an HTTP action.
 *
 * Extracts JWT from the request's Authorization header or auth_token cookie,
 * validates it, and returns the authenticated user's payload.
 *
 * @param request - HTTP request object from the action handler
 * @returns Authenticated user payload with turnkeySubOrgId and email
 * @throws AuthError if no token is present, token is invalid, or token is expired
 *
 * @example
 * ```typescript
 * export const protectedAction = httpAction(async (ctx, request) => {
 *   const auth = await requireAuth(ctx, request);
 *   // auth.turnkeySubOrgId and auth.email are now available
 * });
 * ```
 */
export async function requireAuth(ctx: ActionCtx, request: Request): Promise<AuthTokenPayload> {
  // Extract token from request
  const token = extractTokenFromRequest(request);

  if (!token) {
    throw new AuthError(
      "Authentication required",
      "UNAUTHORIZED"
    );
  }

  try {
    await ctx.runMutation(internal.actorSession.establishInternal, { authToken: token });
    return await ctx.runQuery(internal.actorSession.identity, { authToken: token });
  } catch (error) {
    // Map specific error messages to error codes
    const message = error instanceof Error ? error.message : "Invalid token";

    if (message.includes("expired")) {
      throw new AuthError("Token has expired", "EXPIRED_TOKEN");
    }

    throw new AuthError(message, "INVALID_TOKEN");
  }
}

/**
 * Try to get authentication from a request without throwing.
 *
 * Useful for endpoints that support both authenticated and anonymous access.
 *
 * @param request - HTTP request object
 * @returns Authenticated user payload or null if not authenticated
 */
export async function tryAuth(ctx: ActionCtx, request: Request): Promise<AuthTokenPayload | null> {
  try {
    return await requireAuth(ctx, request);
  } catch {
    return null;
  }
}

/**
 * Create an unauthorized error response.
 */
export function unauthorizedResponse(message = "Unauthorized"): Response {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * Create a forbidden error response.
 */
export function forbiddenResponse(message = "Forbidden"): Response {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status: 403,
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * CORS-aware unauthorized response for HTTP actions.
 *
 * Prefer this when returning responses to browser clients.
 */
export function unauthorizedResponseWithCors(
  request: Request,
  message = "Unauthorized"
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(request),
    },
  });
}

/**
 * CORS-aware forbidden response for HTTP actions.
 */
export function forbiddenResponseWithCors(
  request: Request,
  message = "Forbidden"
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(request),
    },
  });
}
