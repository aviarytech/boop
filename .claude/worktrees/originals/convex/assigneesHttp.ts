import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { AuthError, unauthorizedResponseWithCors } from "./lib/auth";
import { requireAuthenticatedUser } from "./lib/authUser";
import { jsonResponse, errorResponse } from "./lib/httpResponses";

export const assignItem = httpAction(async (ctx, request) => {
  try {
    const user = await requireAuthenticatedUser(ctx, request);
    const body = await request.json();
    const { itemId, assigneeDid } = body as { itemId: string; assigneeDid: string };

    if (!itemId || !assigneeDid) return errorResponse(request, "itemId and assigneeDid are required");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.runMutation((api as any).assignees.assignItem, {
      itemId: itemId as Id<"items">,
      assigneeDid,
      actorDid: user.did,
      legacyDid: user.legacyDid,
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponseWithCors(request, error.message);
    return errorResponse(request, error instanceof Error ? error.message : "Failed to assign item", 500);
  }
});

export const unassignItem = httpAction(async (ctx, request) => {
  try {
    const user = await requireAuthenticatedUser(ctx, request);
    const body = await request.json();
    const { itemId, assigneeDid } = body as { itemId: string; assigneeDid: string };

    if (!itemId || !assigneeDid) return errorResponse(request, "itemId and assigneeDid are required");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ctx.runMutation((api as any).assignees.unassignItem, {
      itemId: itemId as Id<"items">,
      assigneeDid,
      actorDid: user.did,
      legacyDid: user.legacyDid,
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponseWithCors(request, error.message);
    return errorResponse(request, error instanceof Error ? error.message : "Failed to unassign item", 500);
  }
});

export const getItemAssignees = httpAction(async (ctx, request) => {
  try {
    await requireAuthenticatedUser(ctx, request);
    const body = await request.json();
    const { itemId } = body as { itemId: string };
    if (!itemId) return errorResponse(request, "itemId is required");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const assignees = await ctx.runQuery((api as any).assignees.getItemAssignees, {
      itemId: itemId as Id<"items">,
    });

    return jsonResponse(request, { assignees });
  } catch (error) {
    if (error instanceof AuthError) return unauthorizedResponseWithCors(request, error.message);
    return errorResponse(request, error instanceof Error ? error.message : "Failed to get assignees", 500);
  }
});
