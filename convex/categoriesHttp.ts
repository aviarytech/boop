import { authenticatedRequest } from "./lib/actor";
/**
 * HTTP action handlers for protected category mutations.
 *
 * These endpoints require JWT authentication via requireAuth().
 * The user's DID is looked up server-side from their turnkeySubOrgId.
 */

import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { jsonResponse, errorResponse } from "./lib/httpResponses";

/**
 * POST /api/categories/create
 *
 * Create a new category. Requires authentication.
 *
 * Request: { "name": "..." }
 * Response: { "categoryId": "..." }
 */
export const createCategory = httpAction(async (ctx, request) => {
  try {
    // Require authentication

    // Get user's DID from their turnkeySubOrgId

    // Parse request body
    const body = await request.json();
    const { name } = body as { name: string };

    if (!name) {
      return errorResponse(request, "name is required");
    }

    // Call the mutation with server-verified DID
    const categoryId = await ctx.runMutation(internal.categories.createCategoryInternal, {
      ...await authenticatedRequest(ctx, request),

      name,
      createdAt: Date.now(),
    });

    return jsonResponse(request, { categoryId });
  } catch (error) {
    console.error("[categoriesHttp] createCategory error:", error);
    return errorResponse(
      request,
      error instanceof Error ? error.message : "Failed to create category",
      500
    );
  }
});

/**
 * POST /api/categories/rename
 *
 * Rename a category. Requires authentication and ownership.
 *
 * Request: { "categoryId": "...", "name": "..." }
 * Response: { "success": true }
 */
export const renameCategory = httpAction(async (ctx, request) => {
  try {
    // Require authentication

    // Get user's DID from their turnkeySubOrgId

    // Parse request body
    const body = await request.json();
    const { categoryId, name } = body as { categoryId: string; name: string };

    if (!categoryId || !name) {
      return errorResponse(request, "categoryId and name are required");
    }

    // Call the mutation with server-verified DID
    await ctx.runMutation(internal.categories.renameCategoryInternal, {
      ...await authenticatedRequest(ctx, request),
      categoryId: categoryId as Id<"categories">,
      name,
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
    console.error("[categoriesHttp] renameCategory error:", error);
    return errorResponse(
      request,
      error instanceof Error ? error.message : "Failed to rename category",
      500
    );
  }
});

/**
 * POST /api/categories/delete
 *
 * Delete a category. Requires authentication and ownership.
 *
 * Request: { "categoryId": "..." }
 * Response: { "success": true }
 */
export const deleteCategory = httpAction(async (ctx, request) => {
  try {
    // Require authentication

    // Get user's DID from their turnkeySubOrgId

    // Parse request body
    const body = await request.json();
    const { categoryId } = body as { categoryId: string };

    if (!categoryId) {
      return errorResponse(request, "categoryId is required");
    }

    // Call the mutation with server-verified DID
    await ctx.runMutation(internal.categories.deleteCategoryInternal, {
      ...await authenticatedRequest(ctx, request),
      categoryId: categoryId as Id<"categories">,
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
    console.error("[categoriesHttp] deleteCategory error:", error);
    return errorResponse(
      request,
      error instanceof Error ? error.message : "Failed to delete category",
      500
    );
  }
});

/**
 * POST /api/categories/setListCategory
 *
 * Set a list's category. Requires authentication and list access.
 *
 * Request: { "listId": "...", "categoryId": "..." (optional, null to uncategorize) }
 * Response: { "success": true }
 */
export const setListCategory = httpAction(async (ctx, request) => {
  try {
    // Require authentication

    // Get user's DID from their turnkeySubOrgId

    // Parse request body
    const body = await request.json();
    const { listId, categoryId } = body as { listId: string; categoryId?: string };

    if (!listId) {
      return errorResponse(request, "listId is required");
    }

    // Call the mutation with server-verified DID
    await ctx.runMutation(internal.categories.setListCategoryInternal, {
      ...await authenticatedRequest(ctx, request),
      listId: listId as Id<"lists">,
      categoryId: categoryId as Id<"categories">,
    });

    return jsonResponse(request, { success: true });
  } catch (error) {
    console.error("[categoriesHttp] setListCategory error:", error);
    return errorResponse(
      request,
      error instanceof Error ? error.message : "Failed to set list category",
      500
    );
  }
});
