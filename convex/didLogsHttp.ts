/**
 * HTTP actions for DID log storage and retrieval.
 * 
 * POST /api/did/log - Store/update a DID log (requires auth)
 * GET /api/did/log?path={path} - Get a DID log by path (public)
 */

import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { requireAuth, AuthError } from "./lib/auth";
import { assertDidLogOwnership, DidLogOwnershipError } from "./lib/didLogAuth";

function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

/**
 * Store/update a DID log for the authenticated caller.
 *
 * The body's `userDid`/`path` are checked against the ones derivable from the
 * caller's token, never trusted — this endpoint decides what the world resolves
 * for an identity.
 */
export const storeDidLog = httpAction(async (ctx, request) => {
  const corsHeaders = getCorsHeaders(request);

  try {
    const auth = await requireAuth(request);

    const body = await request.json();
    const { userDid, path, log } = body as { userDid: string; path: string; log: string };

    if (!userDid || !path || !log) {
      return new Response(JSON.stringify({ error: "Missing required fields: userDid, path, log" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    assertDidLogOwnership({ subOrgId: auth.turnkeySubOrgId, userDid, path });

    await ctx.runMutation(internal.didLogs.upsertDidLog, { userDid, path, log });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    if (error instanceof DidLogOwnershipError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    console.error("[didLogsHttp] Store error:", error);
    return new Response(JSON.stringify({ error: "Failed to store DID log" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

/**
 * Get a DID log by path. Public endpoint (no auth required).
 */
export const getDidLog = httpAction(async (ctx, request) => {
  const corsHeaders = getCorsHeaders(request);

  try {
    const url = new URL(request.url);
    const path = url.searchParams.get("path");

    if (!path) {
      return new Response(JSON.stringify({ error: "Missing 'path' query parameter" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const log = await ctx.runQuery(api.didLogs.getDidLogByPath, { path });

    if (!log) {
      return new Response("Not found", {
        status: 404,
        headers: corsHeaders,
      });
    }

    // Return as JSONL (text/plain with each line being a JSON object)
    return new Response(log, {
      status: 200,
      headers: {
        "Content-Type": "application/jsonl+json",
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error("[didLogsHttp] Get error:", error);
    return new Response("Internal server error", {
      status: 500,
      headers: corsHeaders,
    });
  }
});
