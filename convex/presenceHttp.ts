import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { authenticatedRequest } from "./lib/actor";
import { jsonResponse, errorResponse, handlerErrorResponse } from "./lib/httpResponses";

export const heartbeat = httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    const { listId, status } = body as { listId: string; status?: "active" | "idle" | "offline" };
    if (!listId) return errorResponse(request, "listId is required");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await ctx.runMutation(internal.presence.heartbeatInternal, {
      ...await authenticatedRequest(ctx, request),
      listId: listId as Id<"lists">,
      status,
    });

    return jsonResponse(request, result);
  } catch (error) {
    return handlerErrorResponse(request, error, "Failed to update presence");
  }
});

export const listPresence = httpAction(async (ctx, request) => {
  try {
    const body = await request.json();
    const { listId } = body as { listId: string };
    if (!listId) return errorResponse(request, "listId is required");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const presence = await ctx.runQuery(internal.presence.getListPresenceInternal, {
      ...await authenticatedRequest(ctx, request),
      listId: listId as Id<"lists">,
    });

    return jsonResponse(request, { presence });
  } catch (error) {
    return handlerErrorResponse(request, error, "Failed to read presence");
  }
});
