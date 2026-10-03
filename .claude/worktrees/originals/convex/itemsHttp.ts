/**
 * HTTP action handlers for protected item mutations.
 *
 * These endpoints authenticate via resolveActor(), which accepts either a JWT
 * session or an agent API key (X-API-Key). Writes require the "items:write" scope.
 * The acting DID is resolved server-side and passed to the mutations.
 */

import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { AuthError, unauthorizedResponseWithCors } from "./lib/auth";
import { resolveActor, requireScope } from "./lib/actor";
import { jsonResponse, errorResponse, handlerErrorResponse } from "./lib/httpResponses";

/**
 * POST /api/items/add
 *
 * Add an item to a list. Requires authentication and edit access.
 *
 * Request: { "listId": "...", "name": "..." }
 * Response: { "itemId": "..." }
 */
export const addItem = httpAction(async (ctx, request) => {
  try {
    // Accept a JWT session or an agent API key with items:write scope.
    const actor = await resolveActor(ctx, request);
    requireScope(actor, "items:write");

    // Parse request body
    const body = await request.json();
    const { listId, name } = body as { listId: string; name: string };

    if (!listId || !name) {
      return errorResponse(request, "listId and name are required");
    }

    // Call the mutation with server-verified acting DID
    const itemId = await ctx.runMutation(api.items.addItem, {
      listId: listId as Id<"lists">,
      name,
      createdByDid: actor.did,
      legacyDid: actor.legacyDid,
      createdAt: Date.now(),
    });

    return jsonResponse(request, { itemId });
  } catch (error) {
    if (error instanceof AuthError) {
      return unauthorizedResponseWithCors(request, error.message);
    }
    console.error("[itemsHttp] addItem error:", error);
    return handlerErrorResponse(
      request,
      error,
      "Failed to add item"
    );
  }
});

/**
 * POST /api/items/check
 *
 * Check (mark as complete) an item. Requires authentication and edit access.
 *
 * Request: { "itemId": "..." }
 * Response: { "success": true }
 */
export const checkItem = httpAction(async (ctx, request) => {
  try {
    // Accept a JWT session or an agent API key with items:write scope.
    const actor = await resolveActor(ctx, request);
    requireScope(actor, "items:write");

    // Parse request body
    const body = await request.json();
    const { itemId } = body as { itemId: string };

    if (!itemId) {
      return errorResponse(request, "itemId is required");
    }

    // Call the mutation with server-verified acting DID
    await ctx.runMutation(api.items.checkItem, {
      itemId: itemId as Id<"items">,
      checkedByDid: actor.did,
      legacyDid: actor.legacyDid,
      checkedAt: Date.now(),
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return unauthorizedResponseWithCors(request, error.message);
    }
    console.error("[itemsHttp] checkItem error:", error);
    return handlerErrorResponse(
      request,
      error,
      "Failed to check item"
    );
  }
});

/**
 * POST /api/items/uncheck
 *
 * Uncheck an item. Requires authentication and edit access.
 *
 * Request: { "itemId": "..." }
 * Response: { "success": true }
 */
export const uncheckItem = httpAction(async (ctx, request) => {
  try {
    // Accept a JWT session or an agent API key with items:write scope.
    const actor = await resolveActor(ctx, request);
    requireScope(actor, "items:write");

    // Parse request body
    const body = await request.json();
    const { itemId } = body as { itemId: string };

    if (!itemId) {
      return errorResponse(request, "itemId is required");
    }

    // Call the mutation with server-verified acting DID
    await ctx.runMutation(api.items.uncheckItem, {
      itemId: itemId as Id<"items">,
      userDid: actor.did,
      legacyDid: actor.legacyDid,
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return unauthorizedResponseWithCors(request, error.message);
    }
    console.error("[itemsHttp] uncheckItem error:", error);
    return handlerErrorResponse(
      request,
      error,
      "Failed to uncheck item"
    );
  }
});

/**
 * POST /api/items/remove
 *
 * Remove an item. Requires authentication and edit access.
 *
 * Request: { "itemId": "..." }
 * Response: { "success": true }
 */
export const removeItem = httpAction(async (ctx, request) => {
  try {
    // Accept a JWT session or an agent API key with items:write scope.
    const actor = await resolveActor(ctx, request);
    requireScope(actor, "items:write");

    // Parse request body
    const body = await request.json();
    const { itemId } = body as { itemId: string };

    if (!itemId) {
      return errorResponse(request, "itemId is required");
    }

    // Call the mutation with server-verified acting DID
    await ctx.runMutation(api.items.removeItem, {
      itemId: itemId as Id<"items">,
      userDid: actor.did,
      legacyDid: actor.legacyDid,
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return unauthorizedResponseWithCors(request, error.message);
    }
    console.error("[itemsHttp] removeItem error:", error);
    return handlerErrorResponse(
      request,
      error,
      "Failed to remove item"
    );
  }
});

/**
 * POST /api/items/reorder
 *
 * Reorder items in a list. Requires authentication and edit access.
 *
 * Request: { "listId": "...", "itemIds": ["...", "..."] }
 * Response: { "success": true }
 */
export const reorderItems = httpAction(async (ctx, request) => {
  try {
    // Accept a JWT session or an agent API key with items:write scope.
    const actor = await resolveActor(ctx, request);
    requireScope(actor, "items:write");

    // Parse request body
    const body = await request.json();
    const { listId, itemIds } = body as { listId: string; itemIds: string[] };

    if (!listId || !itemIds || !Array.isArray(itemIds)) {
      return errorResponse(request, "listId and itemIds array are required");
    }

    // Call the mutation with server-verified acting DID
    await ctx.runMutation(api.items.reorderItems, {
      listId: listId as Id<"lists">,
      itemIds: itemIds as Id<"items">[],
      userDid: actor.did,
      legacyDid: actor.legacyDid,
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return unauthorizedResponseWithCors(request, error.message);
    }
    console.error("[itemsHttp] reorderItems error:", error);
    return handlerErrorResponse(
      request,
      error,
      "Failed to reorder items"
    );
  }
});
