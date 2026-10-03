import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { AuthError, unauthorizedResponseWithCors } from "./lib/auth";
import { requireAuthenticatedUser } from "./lib/authUser";
import { jsonResponse, errorResponse } from "./lib/httpResponses";

export const getListActivity = httpAction(async (ctx, request) => {
  try {
    await requireAuthenticatedUser(ctx, request);
    const body = await request.json();
    const { listId, limit } = body as { listId: string; limit?: number };
    if (!listId) return errorResponse(request, "listId is required");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activities = await ctx.runQuery((api as any).activity.getListActivity, {
      listId: listId as Id<"lists">,
      limit,
    });

    return jsonResponse(request, { activities });
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponseWithCors(request, error.message);
    return errorResponse(request, error instanceof Error ? error.message : "Failed to get activity", 500);
  }
});
