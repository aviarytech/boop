import { extractTokenFromRequest } from "./lib/jwt";
/**
 * Convex HTTP router for server-side endpoints.
 *
 * Phase 8: Server-side authentication endpoints and protected mutations.
 */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { createList, deleteList } from "./listsHttp";
import {
  createCategory,
  renameCategory,
  deleteCategory,
  setListCategory,
} from "./categoriesHttp";
import {
  addItem,
  checkItem,
  uncheckItem,
  removeItem,
  reorderItems,
} from "./itemsHttp";
import { updateUserDID, remintUserDID } from "./userHttp";
import { storeDidLog, getDidLog } from "./didLogsHttp";
import { didResourceHandler } from "./didResourcesHttp";
import { assignItem as assignItemHttp, unassignItem as unassignItemHttp, getItemAssignees as getItemAssigneesHttp } from "./assigneesHttp";
import { heartbeat as presenceHeartbeatHttp, listPresence as listPresenceHttp } from "./presenceHttp";
import { getListActivity as getListActivityHttp } from "./activityHttp";
import { stripeWebhook, createCheckout, createPortal, getSubscription } from "./billingHttp";
import { resolveSiteHost, resolveSiteAsset } from "./sitesHttp";
import { createApiKey, listApiKeys, revokeApiKey } from "./apiKeysHttp";
import { getLists, getListWithItems } from "./agentReadHttp";
const RATE_LIMITS = {
  initiate: { windowMs: 60000, maxAttempts: 5 },
  verify: { windowMs: 60000, maxAttempts: 5 },
};

// Skip rate limiting in development
const SKIP_RATE_LIMIT = process.env.NODE_ENV !== "production";

/**
 * Helper to extract client IP from request headers.
 */
function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp.trim();
  }
  return "unknown-ip";
}

/**
 * Get CORS headers for a request.
 * When credentials are included, we must echo the specific origin (not "*").
 */
function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    // GET/DELETE + X-API-Key added for the agent v1 routes (keys, lists).
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
    "Access-Control-Allow-Credentials": "true",
  };
}

/**
 * Create a JSON response with CORS headers.
 */
function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
  request?: Request
): Response {
  const corsHeaders = request ? getCorsHeaders(request) : {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  };
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

/**
 * Create a 429 Too Many Requests response.
 */
function createRateLimitResponse(retryAfterMs: number, request: Request): Response {
  const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
  return jsonResponse(
    { error: "Too many requests. Please try again later.", retryAfterSeconds },
    429,
    { "Retry-After": String(retryAfterSeconds) },
    request
  );
}

// ============================================================================
// Auth HTTP Actions (call Node.js internal actions)
// ============================================================================

/**
 * POST /auth/initiate - Send OTP to user's email
 */
const initiate = httpAction(async (ctx, request) => {
  try {
    const clientIp = getClientIp(request);

    if (!SKIP_RATE_LIMIT) {
      const rateLimitResult = await ctx.runMutation(api.rateLimits.checkAndIncrement, {
        key: clientIp,
        endpoint: "initiate",
      });

      if (!rateLimitResult.allowed) {
        console.log(`[authHttp] Rate limit exceeded for IP: ${clientIp}`);
        return createRateLimitResponse(rateLimitResult.retryAfterMs ?? RATE_LIMITS.initiate.windowMs, request);
      }
    }

    const body = await request.json();
    const email = body.email as string;

    if (!email) {
      return jsonResponse({ error: "Email is required" }, 400, {}, request);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return jsonResponse({ error: "Invalid email format" }, 400, {}, request);
    }

    console.log(`[authHttp] Initiating auth for: ${email} (IP: ${clientIp})`);

    // Call internal Node.js action
    const result = await ctx.runAction(internal.authInternal.initiateAuth, { email });

    // Persist session to Convex database
    await ctx.runMutation(internal.authSessions.createSessionInternal, {
      sessionId: result.sessionId,
      email: result.session.email,
      subOrgId: result.session.subOrgId,
      otpId: result.session.otpId,
    });

    console.log(`[authHttp] Session created: ${result.sessionId}`);

    return jsonResponse({
      sessionId: result.sessionId,
      message: result.message,
    }, 200, {}, request);
  } catch (error) {
    console.error("[authHttp] Initiate error:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Failed to initiate auth" },
      500,
      {},
      request
    );
  }
});

/**
 * POST /auth/verify - Verify OTP and issue JWT
 */
const verify = httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    const sessionId = body.sessionId as string;
    const code = body.code as string;

    if (!sessionId || !code) {
      return jsonResponse({ error: "Session ID and code are required" }, 400, {}, request);
    }

    if (!SKIP_RATE_LIMIT) {
      const rateLimitResult = await ctx.runMutation(api.rateLimits.checkAndIncrement, {
        key: sessionId,
        endpoint: "verify",
      });

      if (!rateLimitResult.allowed) {
        console.log(`[authHttp] Rate limit exceeded for session: ${sessionId}`);
        return createRateLimitResponse(rateLimitResult.retryAfterMs ?? RATE_LIMITS.verify.windowMs, request);
      }
    }

    console.log(`[authHttp] Verifying OTP for session: ${sessionId}`);

    // Get session from database
    const dbSession = await ctx.runQuery(internal.authSessions.getSessionInternal, { sessionId });
    if (!dbSession) {
      return jsonResponse({ error: "Invalid or expired session" }, 400, {}, request);
    }

    // Validate required session fields
    if (!dbSession.subOrgId || !dbSession.otpId) {
      return jsonResponse({ error: "Invalid session state" }, 400, {}, request);
    }

    // Call internal Node.js action
    const result = await ctx.runAction(internal.authInternal.verifyAuth, {
      sessionId,
      code,
      session: {
        email: dbSession.email,
        subOrgId: dbSession.subOrgId,
        otpId: dbSession.otpId,
        timestamp: dbSession.timestamp,
        verified: dbSession.verified,
      },
    });

    if (!result.verified || !result.email || !result.subOrgId) {
      return jsonResponse({ error: "Verification failed" }, 400, {}, request);
    }

    console.log(`[authHttp] OTP verified for: ${result.email}`);

    // Mark session as verified
    await ctx.runMutation(internal.authSessions.markSessionVerifiedInternal, {
      sessionId,
      subOrgId: result.subOrgId,
    });

    // DID creation happens client-side after auth completes: for a NEW account
    // the client mints a did:webvh with BrowserWebVHSigner and posts it to
    // /api/user/updateDID.
    await ctx.runMutation(internal.auth.upsertUserInternal, {
      turnkeySubOrgId: result.subOrgId,
      email: result.email,
      did: undefined,
      displayName: result.email.split("@")[0],
    });

    // Return the DID we actually hold. This used to be hardcoded null, so every
    // login looked like a first login: the client minted a fresh did:webvh and
    // posted it, upsertUser silently refused to overwrite an existing one, and
    // the client then treated the discarded DID as its identity. That burned a
    // keypair per login and, worse, left the client's DID disagreeing with the
    // database — which is why the stale-domain re-mint never fired.
    const storedUser = await ctx.runQuery(internal.auth.getUserByTurnkeyIdInternal, {
      turnkeySubOrgId: result.subOrgId,
    });

    // Get JWT token via internal action
    const authResult = await ctx.runAction(internal.authInternal.createAuthToken, {
      subOrgId: result.subOrgId,
      email: result.email,
    });

    await ctx.runMutation(internal.actorSession.establishInternal, { authToken: authResult.token });

    // Clean up session
    await ctx.runMutation(internal.authSessions.deleteSessionInternal, { sessionId });

    console.log(`[authHttp] Auth complete, JWT issued for: ${result.email}`);

    return jsonResponse(
      {
        token: authResult.token,
        user: {
          turnkeySubOrgId: result.subOrgId,
          email: result.email,
          did: storedUser?.did ?? null,
          displayName: storedUser?.displayName ?? result.email.split("@")[0],
        },
      },
      200,
      { "Set-Cookie": authResult.cookieValue },
      request
    );
  } catch (error) {
    console.error("[authHttp] Verify error:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Verification failed" },
      500,
      {},
      request
    );
  }
});

/**
 * POST /auth/logout - Clear auth cookie
 */
const logout = httpAction(async (ctx, request) => {
  console.log("[authHttp] Logging out");

  const token = extractTokenFromRequest(request);
  if (token) await ctx.runMutation(internal.actorSession.revokeInternal, { authToken: token });
  const result = await ctx.runAction(internal.authInternal.getLogoutCookie, {});

  return jsonResponse({ success: true }, 200, { "Set-Cookie": result.cookieValue }, request);
});

const http = httpRouter();

// Auth endpoints
http.route({
  path: "/auth/initiate",
  method: "POST",
  handler: initiate,
});

http.route({
  path: "/auth/verify",
  method: "POST",
  handler: verify,
});

http.route({
  path: "/auth/logout",
  method: "POST",
  handler: logout,
});

// CORS preflight handler. Reuses getCorsHeaders so the allowed methods/headers
// (incl. GET/DELETE + X-API-Key for the agent v1 routes) stay in one place.
const corsHandler = httpAction(async (_ctx, request) => {
  return new Response(null, {
    status: 204,
    headers: {
      ...getCorsHeaders(request),
      "Access-Control-Max-Age": "86400",
    },
  });
});

// CORS preflight handling for all auth routes
http.route({ path: "/auth/initiate", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/auth/verify", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/auth/logout", method: "OPTIONS", handler: corsHandler });

// ============================================================================
// Protected API endpoints (Phase 8.3)
// All endpoints below require JWT authentication via Authorization header.
// ============================================================================

// --- List endpoints ---
http.route({ path: "/api/lists/create", method: "POST", handler: createList });
http.route({ path: "/api/lists/create", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/api/lists/delete", method: "POST", handler: deleteList });
http.route({ path: "/api/lists/delete", method: "OPTIONS", handler: corsHandler });

// --- Category endpoints ---
http.route({ path: "/api/categories/create", method: "POST", handler: createCategory });
http.route({ path: "/api/categories/create", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/api/categories/rename", method: "POST", handler: renameCategory });
http.route({ path: "/api/categories/rename", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/api/categories/delete", method: "POST", handler: deleteCategory });
http.route({ path: "/api/categories/delete", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/api/categories/setListCategory", method: "POST", handler: setListCategory });
http.route({ path: "/api/categories/setListCategory", method: "OPTIONS", handler: corsHandler });

// --- Item endpoints ---
http.route({ path: "/api/items/add", method: "POST", handler: addItem });
http.route({ path: "/api/items/add", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/api/items/check", method: "POST", handler: checkItem });
http.route({ path: "/api/items/check", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/api/items/uncheck", method: "POST", handler: uncheckItem });
http.route({ path: "/api/items/uncheck", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/api/items/remove", method: "POST", handler: removeItem });
http.route({ path: "/api/items/remove", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/api/items/reorder", method: "POST", handler: reorderItems });
http.route({ path: "/api/items/reorder", method: "OPTIONS", handler: corsHandler });

// --- User endpoints ---
http.route({ path: "/api/user/updateDID", method: "POST", handler: updateUserDID });
http.route({ path: "/api/user/remintDid", method: "POST", handler: remintUserDID });
http.route({ path: "/api/user/remintDid", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/api/user/updateDID", method: "OPTIONS", handler: corsHandler });

// --- DID log endpoints ---
http.route({ path: "/api/did/log", method: "POST", handler: storeDidLog });
http.route({ path: "/api/did/log", method: "GET", handler: getDidLog });
http.route({ path: "/api/did/log", method: "OPTIONS", handler: corsHandler });

// --- Assignee endpoints ---
http.route({ path: "/api/assignees/assign", method: "POST", handler: assignItemHttp });
http.route({ path: "/api/assignees/assign", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/api/assignees/unassign", method: "POST", handler: unassignItemHttp });
http.route({ path: "/api/assignees/unassign", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/api/assignees/list", method: "POST", handler: getItemAssigneesHttp });
http.route({ path: "/api/assignees/list", method: "OPTIONS", handler: corsHandler });

// --- Presence endpoints ---
http.route({ path: "/api/presence/heartbeat", method: "POST", handler: presenceHeartbeatHttp });
http.route({ path: "/api/presence/heartbeat", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/api/presence/list", method: "POST", handler: listPresenceHttp });
http.route({ path: "/api/presence/list", method: "OPTIONS", handler: corsHandler });

// --- Activity endpoints ---
http.route({ path: "/api/activity/list", method: "POST", handler: getListActivityHttp });
http.route({ path: "/api/activity/list", method: "OPTIONS", handler: corsHandler });

// --- Billing endpoints ---
http.route({ path: "/api/stripe/webhook", method: "POST", handler: stripeWebhook });
http.route({ path: "/api/billing/checkout", method: "POST", handler: createCheckout });
http.route({ path: "/api/billing/checkout", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/api/billing/portal", method: "POST", handler: createPortal });
http.route({ path: "/api/billing/portal", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/api/billing/subscription", method: "GET", handler: getSubscription });
http.route({ path: "/api/billing/subscription", method: "OPTIONS", handler: corsHandler });

// --- Hosted site endpoints ---
http.route({ path: "/api/sites/resolve-host", method: "GET", handler: resolveSiteHost });
http.route({ path: "/api/sites/resolve-host", method: "OPTIONS", handler: resolveSiteHost });
http.route({ path: "/api/sites/resolve-asset", method: "GET", handler: resolveSiteAsset });
http.route({ path: "/api/sites/resolve-asset", method: "OPTIONS", handler: resolveSiteAsset });

// ============================================================================
// Agent API v1 (Plan 001)
// API-key management (JWT-only) + agent read/write over HTTP (JWT or X-API-Key).
// Note: keyId/listId are query params — the Convex router has no :param segments.
// ============================================================================
http.route({ path: "/api/v1/keys", method: "POST", handler: createApiKey });
http.route({ path: "/api/v1/keys", method: "GET", handler: listApiKeys });
http.route({ path: "/api/v1/keys", method: "DELETE", handler: revokeApiKey });
http.route({ path: "/api/v1/keys", method: "OPTIONS", handler: corsHandler });

http.route({ path: "/api/v1/lists", method: "GET", handler: getLists });
http.route({ path: "/api/v1/lists", method: "OPTIONS", handler: corsHandler });
http.route({ path: "/api/v1/lists/items", method: "GET", handler: getListWithItems });
http.route({ path: "/api/v1/lists/items", method: "OPTIONS", handler: corsHandler });

// ============================================================================
// Health check endpoint (public, no auth)
// Returns 200 OK with JSON body for Railway health checks and uptime monitoring.
// ============================================================================
const healthCheck = httpAction(async () => {
  return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

http.route({ path: "/health", method: "GET", handler: healthCheck });

// ============================================================================
// DID Resolution & Resource endpoints (public, no auth)
// Serves /{userPath}/did.jsonl and /{userPath}/resources/list-{id}
// These MUST come after all /api/ routes to avoid conflicts.
// ============================================================================
// DID paths are proxied via /d/ prefix to satisfy Convex's pathPrefix-must-end-with-/ rule.
// The production server (server.ts) rewrites /user-*/did.jsonl → /d/user-*/did.jsonl
http.route({ pathPrefix: "/d/", method: "GET", handler: didResourceHandler });
http.route({ pathPrefix: "/d/", method: "POST", handler: didResourceHandler });
http.route({ pathPrefix: "/d/", method: "OPTIONS", handler: didResourceHandler });

export default http;
