import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { AuthError, unauthorizedResponseWithCors } from "./lib/auth";
import { requireAuthenticatedUser } from "./lib/authUser";
import { jsonResponse, errorResponse } from "./lib/httpResponses";

export const heartbeat = httpAction(async (ctx, request) => {
  try {
    const user = await requireAuthenticatedUser(ctx, request);
    const body = await request.json();
    const { listId, status } = body as { listId: string; status?: "active" | "idle" | "offline" };
    if (!listId) return errorResponse(request, "listId is required");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await ctx.runMutation((api as any).presence.heartbeat, {
      listId: listId as Id<"lists">,
      userDid: user.did,
      legacyDid: user.legacyDid,
      status,
    });

    return jsonResponse(request, result);
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponseWithCors(request, error.message);
    return errorResponse(request, error instanceof Error ? error.message : "Failed to update presence", 500);
  }
});

export const listPresence = httpAction(async (ctx, request) => {
  try {
    await requireAuthenticatedUser(ctx, request);
    const body = await request.json();
    const { listId } = body as { listId: string };
    if (!listId) return errorResponse(request, "listId is required");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const presence = await ctx.runQuery((api as any).presence.getListPresence, {
      listId: listId as Id<"lists">,
    });

    return jsonResponse(request, { presence });
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponseWithCors(request, error.message);
    return errorResponse(request, error instanceof Error ? error.message : "Failed to read presence", 500);
  }
});
