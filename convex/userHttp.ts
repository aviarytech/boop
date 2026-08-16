/**
 * HTTP action handlers for user-related mutations.
 *
 * These endpoints require JWT authentication via requireAuth().
 */

import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import {
  requireAuth,
  AuthError,
  unauthorizedResponseWithCors,
} from "./lib/auth";
import { jsonResponse, errorResponse } from "./lib/httpResponses";
import { assertDidLogOwnership, DidLogOwnershipError } from "./lib/didLogAuth";

/** The domain encoded in a did:webvh, percent-decoded. Null if not a did:webvh. */
function didWebvhDomain(did: string): string | null {
  const parts = did.split(":");
  if (parts.length < 5 || parts[1] !== "webvh") return null;
  try {
    return decodeURIComponent(parts[3]);
  } catch {
    return parts[3];
  }
}

/**
 * POST /api/user/updateDID
 *
 * Update the authenticated user's DID. Used after client-side DID creation
 * to upgrade from did:temp to did:webvh.
 *
 * Request: { "did": "did:webvh:..." }
 * Response: { "success": true, "did": "..." }
 */
export const updateUserDID = httpAction(async (ctx, request) => {
  try {
    // Require authentication
    const auth = await requireAuth(request);

    // Parse request body
    const body = await request.json();
    const { did } = body as { did: string };

    if (!did) {
      return errorResponse(request, "did is required");
    }

    // Validate DID format (must be did:webvh, not did:temp)
    if (did.startsWith("did:temp:")) {
      return errorResponse(request, "Cannot update to a temporary DID");
    }

    if (!did.startsWith("did:webvh:") && !did.startsWith("did:key:")) {
      return errorResponse(request, "Invalid DID format. Expected did:webvh or did:key");
    }

    console.log(`[userHttp] Updating DID for ${auth.email} to ${did}`);

    // Call upsertUser which handles the DID upgrade logic
    await ctx.runMutation(api.auth.upsertUser, {
      turnkeySubOrgId: auth.turnkeySubOrgId,
      email: auth.email,
      did,
    });

    console.log(`[userHttp] DID updated successfully for ${auth.email}`);

    return jsonResponse(request, { success: true, did });
  } catch (err) {
    if (err instanceof AuthError) {
      return unauthorizedResponseWithCors(request, err.message);
    }
    console.error("[userHttp] Update DID error:", err);
    return errorResponse(
      request,
      err instanceof Error ? err.message : "Failed to update DID",
      500
    );
  }
});

/**
 * POST /api/user/remintDid
 *
 * Point the authenticated user at a freshly minted DID and move every row that
 * referenced the old one.
 *
 * Authorized by the JWT, not by key continuity. An earlier design required the
 * new DID log to be signed by the key controlling the old DID; that is
 * unsatisfiable for an identity whose original controller key was lost with the
 * origin it was minted on — didwebvh-ts rejects those with "Key ... is not
 * authorized to update". The JWT proves account ownership, which is the right
 * authorization for "reassign my own rows to my own new identifier".
 *
 * Strictly safer than the status quo: /api/user/updateDID already lets an
 * authenticated user change their DID, and today that silently strands every
 * row on the old value.
 *
 * Request: { "did": "did:webvh:...", "didLog": "<jsonl>", "path": "user-..." }
 * Response: { "success": true, "newDid": "...", "rewritten": n }
 */
export const remintUserDID = httpAction(async (ctx, request) => {
  try {
    const auth = await requireAuth(request);
    const body = await request.json();
    const { did: newDid, didLog, path } = body as {
      did: string;
      didLog?: string;
      path?: string;
    };

    if (!newDid || !newDid.startsWith("did:webvh:")) {
      return errorResponse(request, "did must be a did:webvh");
    }

    // The identity comes from the verified token, never the request body.
    const user = await ctx.runQuery(internal.migrations.remintUserDidDb.findUserBySubOrg, {
      turnkeySubOrgId: auth.turnkeySubOrgId,
    });
    if (!user || !user.did) {
      return errorResponse(request, "No DID on the authenticated account");
    }
    if (user.did === newDid) {
      return jsonResponse(request, { success: true, newDid, rewritten: 0 });
    }

    // Only ever repair an identity that is actually on a stale domain. Without
    // this, a client whose cached auth state still holds the pre-migration DID
    // re-triggers on every reload and walks the account to a new DID each time.
    const targetDomain = process.env.WEBVH_DOMAIN;
    const currentDomain = didWebvhDomain(user.did);
    if (targetDomain && currentDomain === targetDomain) {
      return jsonResponse(request, {
        success: true,
        newDid: user.did,
        rewritten: 0,
        skipped: "already on the current domain",
      });
    }

    // Checked before applyRemint: storeDidLog patches the didLogs row matching
    // `path`, so an unchecked body could point any other account's serving path
    // at this caller's log. Rejecting afterwards would leave rows already moved.
    if (didLog && path) {
      assertDidLogOwnership({ subOrgId: auth.turnkeySubOrgId, userDid: newDid, path });
    }

    const { rewritten } = await ctx.runMutation(
      internal.migrations.remintUserDidDb.applyRemint,
      { userId: user._id, oldDid: user.did, newDid }
    );

    if (didLog && path) {
      await ctx.runMutation(internal.migrations.remintUserDidDb.storeDidLog, {
        userDid: newDid,
        path,
        log: didLog,
      });
    }

    console.log(
      `[userHttp] Re-minted ${auth.email}: ${user.did} -> ${newDid} (${rewritten} rows)`
    );
    return jsonResponse(request, { success: true, newDid, rewritten });
  } catch (err) {
    if (err instanceof AuthError) {
      return unauthorizedResponseWithCors(request, err.message);
    }
    if (err instanceof DidLogOwnershipError) {
      return errorResponse(request, err.message, 403);
    }
    console.error("[userHttp] Re-mint error:", err);
    return errorResponse(
      request,
      err instanceof Error ? err.message : "Failed to re-mint DID",
      500
    );
  }
});
