import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { authenticatedRequest } from "./lib/actor";
import { jsonResponse, errorResponse, handlerErrorResponse } from "./lib/httpResponses";

export const getListActivity = httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    const { listId, limit } = body as { listId: string; limit?: number };
    if (!listId) return errorResponse(request, "listId is required");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activities = await ctx.runQuery(internal.activity.getListActivityInternal, {
      ...await authenticatedRequest(ctx, request),
      listId: listId as Id<"lists">,
      limit,
    });

    return jsonResponse(request, { activities });
  } catch (error) {
    return handlerErrorResponse(request, error, "Failed to get activity");
  }
});
