/** HTTP adapter; authentication and authorization run in the shared operation. */

import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { authenticatedRequest } from "./lib/actor";
import { jsonResponse, errorResponse, handlerErrorResponse } from "./lib/httpResponses";

/**
 * GET /api/v1/lists
 *
 * List the caller's lists. Requires the "lists:read" scope.
 * Response: { "lists": [...] }
 */
export const getLists = httpAction(async (ctx, request) => {
  try {
    const lists = await ctx.runQuery(internal.lists.getUserListsInternal, {
      ...await authenticatedRequest(ctx, request),
    });
    return jsonResponse(request, { lists });
  } catch (error) {
    console.error("[agentReadHttp] getLists error:", error);
    return handlerErrorResponse(
      request,
      error,
      "Failed to get lists"
    );
  }
});

/**
 * GET /api/v1/lists/items?listId=<id>
 *
 * Get a list and its items. Requires the "items:read" scope.
 * The Convex router has no :param path segments, so listId is a query param.
 * Response: { "list": {...} | null, "items": [...] }
 */
export const getListWithItems = httpAction(async (ctx, request) => {
  try {
    const listId = new URL(request.url).searchParams.get("listId");
    if (!listId) {
      return errorResponse(request, "listId query parameter is required");
    }

    // Authorized combined fetch: returns null if the list is missing OR the
    // caller may not view it, so an items:read key can't read arbitrary lists.
    const result = await ctx.runQuery(internal.lists.getListWithItemsForViewer, {
      listId: listId as Id<"lists">,
      ...await authenticatedRequest(ctx, request),
    });
    if (!result) {
      return errorResponse(request, "List not found", 404);
    }
    return jsonResponse(request, result);
  } catch (error) {
    console.error("[agentReadHttp] getListWithItems error:", error);
    return handlerErrorResponse(
      request,
      error,
      "Failed to get list items"
    );
  }
});

/**
 * GET /api/v1/action-records?itemId=<id>  (requires "items:read")
 * GET /api/v1/action-records?listId=<id>  (requires "lists:read"; list-level records)
 *
 * Signed action records in the shape shared/actionRecord.ts verifyActionRecord
 * takes, so a caller can verify them without trusting this server.
 * Response: { "records": [...] }
 */
export const getActionRecords = httpAction(async (ctx, request) => {
  try {
    const params = new URL(request.url).searchParams;
    const itemId = params.get("itemId");
    const listId = params.get("listId");
    if (!itemId === !listId) {
      return errorResponse(request, "Provide exactly one of itemId or listId");
    }

    const credentials = await authenticatedRequest(ctx, request);
    const records = itemId
      ? await ctx.runQuery(internal.actionRecords.getItemActionRecordsInternal, {
          itemId: itemId as Id<"items">,
          ...credentials,
        })
      : await ctx.runQuery(internal.actionRecords.getListActionRecordsInternal, {
          listId: listId as Id<"lists">,
          ...credentials,
        });
    return jsonResponse(request, { records });
  } catch (error) {
    console.error("[agentReadHttp] getActionRecords error:", error);
    return handlerErrorResponse(
      request,
      error,
      "Failed to get action records"
    );
  }
});
