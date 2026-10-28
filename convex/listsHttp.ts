/** HTTP adapter; authentication and authorization run in the shared operation. */

import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { authenticatedRequest } from "./lib/actor";
import { jsonResponse, errorResponse, handlerErrorResponse } from "./lib/httpResponses";

/**
 * POST /api/lists/create
 *
 * Create a new list. Requires authentication.
 *
 * Request: { "name": "...", "categoryId": "..." (optional) }
 * The list's Original is minted by the owner's device, not by this endpoint.
 * Response: { "listId": "..." }
 */
export const createList = httpAction(async (ctx, request) => {
  try {
    // Accept a JWT session or an agent API key with items:write scope.

    // Parse request body
    const body = await request.json();
    const { name, categoryId } = body as {
      name: string;
      categoryId?: string;
    };

    if (!name) {
      return errorResponse(request, "name is required");
    }

    // Call the mutation with server-verified DID
    const listId = await ctx.runMutation(internal.lists.createListInternal, {
      ...await authenticatedRequest(ctx, request),
      name,
      categoryId: categoryId as unknown as undefined, // Optional category ID
      createdAt: Date.now(),
    });

    return jsonResponse(request, { listId });
  } catch (error) {
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

    // Parse request body
    const body = await request.json();
    const { listId } = body as { listId: string };

    if (!listId) {
      return errorResponse(request, "listId is required");
    }

    // Call the mutation with server-verified DID
    await ctx.runMutation(internal.lists.deleteListInternal, {
      ...await authenticatedRequest(ctx, request),
      listId: listId as Id<"lists">,
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
    console.error("[listsHttp] deleteList error:", error);
    return handlerErrorResponse(
      request,
      error,
      "Failed to delete list"
    );
  }
});
