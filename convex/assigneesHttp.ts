import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { authenticatedRequest } from "./lib/actor";
import { jsonResponse, errorResponse, handlerErrorResponse } from "./lib/httpResponses";

export const assignItem = httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    const { itemId, assigneeDid } = body as { itemId: string; assigneeDid: string };

    if (!itemId || !assigneeDid) return errorResponse(request, "itemId and assigneeDid are required");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.runMutation(internal.assignees.assignItemInternal, {
      ...await authenticatedRequest(ctx, request),
      itemId: itemId as Id<"items">,
      assigneeDid,
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
    return handlerErrorResponse(request, error, "Failed to assign item");
  }
});

export const unassignItem = httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    const { itemId, assigneeDid } = body as { itemId: string; assigneeDid: string };

    if (!itemId || !assigneeDid) return errorResponse(request, "itemId and assigneeDid are required");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.runMutation(internal.assignees.unassignItemInternal, {
      ...await authenticatedRequest(ctx, request),
      itemId: itemId as Id<"items">,
      assigneeDid,
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
    return handlerErrorResponse(request, error, "Failed to unassign item");
  }
});

export const getItemAssignees = httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    const { itemId } = body as { itemId: string };
    if (!itemId) return errorResponse(request, "itemId is required");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const assignees = await ctx.runQuery(internal.assignees.getItemAssigneesInternal, {
      ...await authenticatedRequest(ctx, request),
      itemId: itemId as Id<"items">,
    });

    return jsonResponse(request, { assignees });
  } catch (error) {
    return handlerErrorResponse(request, error, "Failed to get assignees");
  }
});
