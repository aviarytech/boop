/**
 * HTTP action handlers for user-related mutations.
 *
 * These endpoints require JWT authentication via requireAuth().
 */

import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  requireAuth,
  AuthError,
  unauthorizedResponseWithCors,
} from "./lib/auth";
import { jsonResponse, errorResponse } from "./lib/httpResponses";
import { assertDidLogOwnership, didLogPathForSubOrg, DidLogOwnershipError } from "./lib/didLogAuth";
import { checkAccountDidLog, KeyLookupError } from "./didLogsHttp";
import { REMINT_TABLES } from "./migrations/remintUserDidDb";

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
    const auth = await requireAuth(ctx, request);

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

    if (!did.startsWith("did:webvh:")) {
      return errorResponse(request, "Invalid DID format. Expected did:webvh");
    }
    // The account identity comes from the token; the DID must be minted at this
    // sub-org's own path. did:key is derived server-side at login, never accepted here.
    assertDidLogOwnership({ subOrgId: auth.turnkeySubOrgId, userDid: did, path: didLogPathForSubOrg(auth.turnkeySubOrgId) });
    // #286: only a DID whose checked log is already served (POST /api/did/log)
    // and is an author DID, so no account adopts a DID the world can't resolve.
    const served = await ctx.runQuery(internal.didLogs.getDidLogByUserDid, { userDid: did });
    if (!served?.author) {
      return errorResponse(request, "Store this DID's author log (POST /api/did/log) before adopting it", 409);
    }

    console.log(`[userHttp] Updating DID for ${auth.email} to ${did}`);

    // Call upsertUser which handles the DID upgrade logic
    await ctx.runMutation(internal.auth.upsertUserInternal, {
      turnkeySubOrgId: auth.turnkeySubOrgId,
      email: auth.email,
      did,
    });

    // upsertUserInternal keeps an existing did:webvh rather than replace it;
    // never report success for a DID the account didn't take.
    const account = await ctx.runQuery(internal.migrations.remintUserDidDb.findUserBySubOrg, { turnkeySubOrgId: auth.turnkeySubOrgId });
    if (account?.did !== did) return errorResponse(request, "The account kept its existing DID", 409);

    console.log(`[userHttp] DID updated successfully for ${auth.email}`);

    return jsonResponse(request, { success: true, did });
  } catch (err) {
    if (err instanceof AuthError) {
      return unauthorizedResponseWithCors(request, err.message);
    }
    if (err instanceof DidLogOwnershipError) {
      return errorResponse(request, err.message, 403);
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
 * #286: also the author DID re-genesis. A did:webvh minted before #286 has
 * one local key in every role and controller "", which Originals 5 refuses,
 * so the client mints a new author DID through its Turnkey session and moves
 * the account here. No continuity link is kept (decided on #286). Allowed
 * only while the account has no author DID on the current domain, so a
 * client can't walk an account from DID to DID.
 *
 * Request: { "did": "did:webvh:...", "didLog": "<jsonl>", "path": "user-..." }
 * Response: { "success": true, "newDid": "...", "rewritten": n }
 */
export const remintUserDID = httpAction(async (ctx, request) => {
  try {
    const auth = await requireAuth(ctx, request);
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

    // Only ever move an account that has no author DID on the current domain.
    // Without this, a client whose cached auth state still holds the
    // pre-migration DID re-triggers on every reload and walks the account to a
    // new DID each time.
    const targetDomain = process.env.WEBVH_DOMAIN;
    const currentDomain = didWebvhDomain(user.did);
    const current = await ctx.runQuery(internal.didLogs.getDidLogByUserDid, { userDid: user.did });
    if (current?.author && (!targetDomain || currentDomain === targetDomain)) {
      return jsonResponse(request, {
        success: true,
        newDid: user.did,
        rewritten: 0,
        skipped: "already an author DID on the current domain",
      });
    }


    // Checked before any row moves, whether or not a log is supplied: the new DID
    // must be minted at this sub-org's own path, so it cannot name another
    // account. finishRemint patches the didLogs row matching `path`, so an
    // unchecked path could also point another account's serving path at this
    // caller's log. Rejecting afterwards would leave rows already moved.
    assertDidLogOwnership({ subOrgId: auth.turnkeySubOrgId, userDid: newDid, path: path ?? didLogPathForSubOrg(auth.turnkeySubOrgId) });

    // The new DID's log must verify from genesis and be an author DID.
    if (!didLog || !path) return errorResponse(request, "didLog and path are required");
    const checked = await checkAccountDidLog(ctx, auth.turnkeySubOrgId, null, didLog);
    if (!checked.ok) return errorResponse(request, checked.error, 422);
    if (checked.did !== newDid) return errorResponse(request, "didLog is for another DID", 422);
    if (!checked.author) return errorResponse(request, `Not this account's author DID: ${checked.authorProblems.join("; ")}`, 422);

    // Paged, so it fits Convex's per-mutation limits however large the tables
    // are; the account and its served log move together at the end.
    const remint = internal.migrations.remintUserDidDb;
    const move = { userId: user._id, oldDid: user.did, newDid };
    const begun = await ctx.runMutation(remint.beginRemint, move);
    if (begun.skipped) {
      // Another re-mint moved the account first. Store nothing: its log is the one served.
      return jsonResponse(request, { success: true, newDid: begun.did, rewritten: 0, skipped: "moved by another re-mint" });
    }
    let rewritten = 0;
    for (const table of REMINT_TABLES) {
      let cursor: string | null = null;
      for (;;) {
        const page: { rewritten: number; isDone: boolean; cursor: string } = await ctx.runMutation(remint.remintPage, { ...move, table, cursor });
        rewritten += page.rewritten;
        if (page.isDone) break;
        cursor = page.cursor;
      }
    }
    await ctx.runMutation(remint.finishRemint, {
      ...move, path, log: didLog, scid: checked.scid, versionId: checked.versionId, author: checked.author,
    });

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
    if (err instanceof KeyLookupError) return errorResponse(request, err.message, 503);
    console.error("[userHttp] Re-mint error:", err);
    return errorResponse(
      request,
      err instanceof Error ? err.message : "Failed to re-mint DID",
      500
    );
  }
});
