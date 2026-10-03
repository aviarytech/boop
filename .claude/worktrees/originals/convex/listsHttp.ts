/**
 * HTTP action handlers for protected list mutations.
 *
 * These endpoints authenticate via resolveActor(), which accepts either a JWT
 * session or an agent API key (X-API-Key). Writes require the "items:write" scope
 * (there is no lists:write scope yet).
 */

import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { AuthError, unauthorizedResponseWithCors } from "./lib/auth";
import { resolveActor, requireScope } from "./lib/actor";
import { jsonResponse, errorResponse, handlerErrorResponse } from "./lib/httpResponses";

/**
 * POST /api/lists/create
 *
 * Create a new list. Requires authentication.
 *
 * Request: { "assetDid": "...", "name": "...", "categoryId": "..." (optional) }
 * Response: { "listId": "..." }
 */
export const createList = httpAction(async (ctx, request) => {
  try {
    // Accept a JWT session or an agent API key with items:write scope.
    const actor = await resolveActor(ctx, request);
    requireScope(actor, "items:write");

    // Parse request body
    const body = await request.json();
    const { assetDid, name, categoryId } = body as {
      assetDid: string;
      name: string;
      categoryId?: string;
    };

    if (!assetDid || !name) {
      return errorResponse(request, "assetDid and name are required");
    }

    // Call the mutation with server-verified DID
    const listId = await ctx.runMutation(api.lists.createList, {
      assetDid,
      name,
      ownerDid: actor.did,
      categoryId: categoryId as unknown as undefined, // Optional category ID
      createdAt: Date.now(),
    });

    return jsonResponse(request, { listId });
  } catch (error) {
    if (error instanceof AuthError) {
      return unauthorizedResponseWithCors(request, error.message);
    }
    console.error("[listsHttp] createList error:", error);
    return handlerErrorResponse(
      request,
      error,
      "Failed to create list"
    );
  }
});

/**
 * POST /api/lists/delete
 *
 * Delete a list. Requires authentication and ownership.
 *
 * Request: { "listId": "..." }
 * Response: { "success": true }
 */
export const deleteList = httpAction(async (ctx, request) => {
  try {
    // Accept a JWT session or an agent API key with items:write scope.
    const actor = await resolveActor(ctx, request);
    requireScope(actor, "items:write");

    // Parse request body
    const body = await request.json();
    const { listId } = body as { listId: string };

    if (!listId) {
      return errorResponse(request, "listId is required");
    }

    // Call the mutation with server-verified DID
    await ctx.runMutation(api.lists.deleteList, {
      listId: listId as Id<"lists">,
      userDid: actor.did,
      legacyDid: actor.legacyDid,
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return unauthorizedResponseWithCors(request, error.message);
    }
    console.error("[listsHttp] deleteList error:", error);
    return handlerErrorResponse(
      request,
      error,
      "Failed to delete list"
    );
  }
});
