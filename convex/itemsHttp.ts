/** HTTP adapter; authentication and authorization run in the shared operation. */

import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { authenticatedRequest } from "./lib/actor";
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

    // Parse request body
    const body = await request.json();
    const { listId, name } = body as { listId: string; name: string };

    if (!listId || !name) {
      return errorResponse(request, "listId and name are required");
    }

    // Call the mutation with server-verified acting DID
    const itemId = await ctx.runMutation(internal.items.addItemInternal, {
      ...await authenticatedRequest(ctx, request),
      listId: listId as Id<"lists">,
      name,
      createdAt: Date.now(),
    });

    return jsonResponse(request, { itemId });
  } catch (error) {
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

    // Parse request body
    const body = await request.json();
    const { itemId } = body as { itemId: string };

    if (!itemId) {
      return errorResponse(request, "itemId is required");
    }

    // Call the mutation with server-verified acting DID
    await ctx.runMutation(internal.items.checkItemInternal, {
      ...await authenticatedRequest(ctx, request),
      itemId: itemId as Id<"items">,
      checkedAt: Date.now(),
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
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

    // Parse request body
    const body = await request.json();
    const { itemId } = body as { itemId: string };

    if (!itemId) {
      return errorResponse(request, "itemId is required");
    }

    // Call the mutation with server-verified acting DID
    await ctx.runMutation(internal.items.uncheckItemInternal, {
      ...await authenticatedRequest(ctx, request),
      itemId: itemId as Id<"items">,
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
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

    // Parse request body
    const body = await request.json();
    const { itemId } = body as { itemId: string };

    if (!itemId) {
      return errorResponse(request, "itemId is required");
    }

    // Call the mutation with server-verified acting DID
    await ctx.runMutation(internal.items.removeItemInternal, {
      ...await authenticatedRequest(ctx, request),
      itemId: itemId as Id<"items">,
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
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

    // Parse request body
    const body = await request.json();
    const { listId, itemIds } = body as { listId: string; itemIds: string[] };

    if (!listId || !itemIds || !Array.isArray(itemIds)) {
      return errorResponse(request, "listId and itemIds array are required");
    }

    // Call the mutation with server-verified acting DID
    await ctx.runMutation(internal.items.reorderItemsInternal, {
      ...await authenticatedRequest(ctx, request),
      listId: listId as Id<"lists">,
      itemIds: itemIds as Id<"items">[],
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
    console.error("[itemsHttp] reorderItems error:", error);
    return handlerErrorResponse(
      request,
      error,
      "Failed to reorder items"
    );
  }
});
