/**
 * HTTP actions for DID log storage and retrieval.
 * 
 * POST /api/did/log - Store/update a DID log (requires auth)
 * GET /api/did/log?path={path} - Get a DID log by path (public)
 */

import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
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

/** Turnkey could not be read, so the write can't be checked. Retry later. */
export class KeyLookupError extends Error {}

/**
 * Check a DID log for this account: a valid continuation of `stored`, on the
 * current domain, and an author DID only with this sub-org's own Turnkey keys
 * (read with the parent's read-only access).
 */
export async function checkAccountDidLog(ctx: Pick<ActionCtx, "runAction">, subOrgId: string, stored: string | null, next: string) {
  let accounts;
  try {
    accounts = await ctx.runAction(internal.authInternal.listSubOrgEd25519Accounts, { subOrgId });
  } catch (error) {
    console.error("[didLogsHttp] Turnkey account lookup failed:", error);
    throw new KeyLookupError("Could not check this account's keys. Try again shortly.");
  }
  return ctx.runAction(internal.didLogValidation.checkWrite, {
    stored, next, accounts, ...(process.env.WEBVH_DOMAIN ? { domain: process.env.WEBVH_DOMAIN } : {}),
  });
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
    const auth = await requireAuth(ctx, request);

    const body = await request.json();
    const { userDid, path, log } = body as { userDid: string; path: string; log: string };

    if (!userDid || !path || !log) {
      return new Response(JSON.stringify({ error: "Missing required fields: userDid, path, log" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    assertDidLogOwnership({ subOrgId: auth.turnkeySubOrgId, userDid, path });

    // #286: only a valid continuation of the DID served at this path. A new
    // DID goes here only for an account with no did:webvh yet, only if it is
    // this account's author DID, and never over a served author DID. Anything
    // else is a re-genesis: /api/user/remintDid.
    const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), {
      status, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
    const served = await ctx.runQuery(internal.didLogs.getDidLogRecordByPath, { path });
    const continuing = served?.userDid === userDid;
    if (!continuing) {
      const account = await ctx.runQuery(internal.migrations.remintUserDidDb.findUserBySubOrg, { turnkeySubOrgId: auth.turnkeySubOrgId });
      if (account?.did?.startsWith("did:webvh:") || served?.author) {
        return json(409, { error: "This account already has a DID. Re-mint through /api/user/remintDid." });
      }
    }
    const checked = await checkAccountDidLog(ctx, auth.turnkeySubOrgId, continuing ? served.log : null, log);
    if (!checked.ok || checked.did !== userDid) {
      return json(422, { error: checked.ok ? "The log is for another DID" : checked.error });
    }
    if (!continuing && !checked.author) {
      return json(422, { error: `Not this account's author DID: ${checked.authorProblems.join("; ")}` });
    }

    // Compare-and-swap: a concurrent write to this path since `served` was read loses.
    await ctx.runMutation(internal.didLogs.upsertDidLog, {
      userDid, path, log, scid: checked.scid, versionId: checked.versionId, author: checked.author,
      expected: served ? { userDid: served.userDid, log: served.log } : null,
    });

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
    if (error instanceof KeyLookupError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 503,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    if (error instanceof Error && error.message.startsWith("DID log conflict")) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 409,
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

    const log = await ctx.runQuery(internal.didLogs.getDidLogByPath, { path });

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
