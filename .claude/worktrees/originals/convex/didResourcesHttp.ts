/**
 * HTTP actions for serving DID logs and list resources at canonical paths.
 *
 * Resolution paths:
 *   GET /{userPath}/did.jsonl          → user's DID log (JSONL)
 *   GET /{userPath}/resources/list-{id} → list resource (JSON)
 */

import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
  };
}

/**
 * Catch-all handler for /{userPath}/did.jsonl and /{userPath}/resources/list-{id}.
 * Convex pathPrefix routes match everything under a prefix, so we parse the URL ourselves.
 */
export const didResourceHandler = httpAction(async (ctx, request) => {
  const headers = corsHeaders(request);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  const url = new URL(request.url);
  let pathname = url.pathname;

  // Strip /d/ prefix (Convex pathPrefix routing requires trailing /)
  if (pathname.startsWith("/d/")) {
    pathname = "/" + pathname.slice(3);
  }

  // Strip leading slash and split
  const parts = pathname.replace(/^\//, "").split("/");

  if (parts.length < 2) {
    return new Response("Not found", { status: 404, headers });
  }

  const userPath = parts[0]; // e.g. "user-abc123"

  // /{userPath}/did.jsonl
  if (parts.length === 2 && parts[1] === "did.jsonl") {
    return await serveDidLog(ctx, userPath, headers);
  }

  // /{userPath}/resources/list-{listId}
  if (parts.length === 3 && parts[1] === "resources" && parts[2].startsWith("list-")) {
    const listId = parts[2].slice("list-".length);
    return await serveListResource(ctx, userPath, listId, headers);
  }

  // POST /{userPath}/resources/list-{listId}/items/{itemId}/check
  if (
    request.method === "POST" &&
    parts.length === 6 &&
    parts[1] === "resources" &&
    parts[2].startsWith("list-") &&
    parts[3] === "items" &&
    parts[5] === "check"
  ) {
    const listId = parts[2].slice("list-".length);
    const itemId = parts[4];
    return await toggleItem(ctx, userPath, listId, itemId, true, headers);
  }

  // POST /{userPath}/resources/list-{listId}/items/{itemId}/uncheck
  if (
    request.method === "POST" &&
    parts.length === 6 &&
    parts[1] === "resources" &&
    parts[2].startsWith("list-") &&
    parts[3] === "items" &&
    parts[5] === "uncheck"
  ) {
    const listId = parts[2].slice("list-".length);
    const itemId = parts[4];
    return await toggleItem(ctx, userPath, listId, itemId, false, headers);
  }

  return new Response("Not found", { status: 404, headers });
});

async function serveDidLog(
  ctx: { runQuery: Function },
  userPath: string,
  headers: Record<string, string>
): Promise<Response> {
  try {
    const log = await ctx.runQuery(api.didLogs.getDidLogByPath, { path: userPath });

    if (!log) {
      return new Response("DID not found", {
        status: 404,
        headers: { "Content-Type": "text/plain", ...headers },
      });
    }

    return new Response(log, {
      status: 200,
      headers: {
        "Content-Type": "application/jsonl+json",
        "Cache-Control": "public, max-age=60",
        ...headers,
      },
    });
  } catch (error) {
    console.error("[didResources] Error serving DID log:", error);
    return new Response("Internal server error", { status: 500, headers });
  }
}

async function serveListResource(
  ctx: { runQuery: Function },
  userPath: string,
  listId: string,
  headers: Record<string, string>
): Promise<Response> {
  try {
    // Primary path: resolve owner DID via didLogs
    const fullRecord = await ctx.runQuery(api.didLogs.getDidLogRecordByPath, { path: userPath });

    let userDid: string | null = fullRecord?.userDid ?? null;
    let list = null;

    if (userDid) {
      list = await ctx.runQuery(api.didResources.getPublicList, {
        listId,
        ownerDid: userDid,
      });
    }

    // Fallback path for legacy users without didLogs rows yet:
    // verify the list is actively published and the publication DID matches this URL path.
    if (!list) {
      const candidate = await ctx.runQuery(api.didResources.getListById, { listId });
      if (!candidate) {
        return new Response("List not found", {
          status: 404,
          headers: { "Content-Type": "text/plain", ...headers },
        });
      }

      const publication = await ctx.runQuery(api.didResources.getActivePublicationByListId, {
        listId: candidate._id,
      });
      if (!publication) {
        return new Response("List not found", {
          status: 404,
          headers: { "Content-Type": "text/plain", ...headers },
        });
      }

      // Expected: did:webvh:{scid}:{domain}:{userPath}/resources/list-{listId}
      const expectedSuffix = `:${userPath}/resources/list-${listId}`;
      if (!publication.webvhDid.endsWith(expectedSuffix)) {
        return new Response("List not found", {
          status: 404,
          headers: { "Content-Type": "text/plain", ...headers },
        });
      }

      // Derive controller DID from resource DID by stripping /resources/... suffix
      userDid = publication.webvhDid.replace(/\/resources\/list-.+$/, "");
      list = candidate;
    }

    // Get list items
    const items = await ctx.runQuery(api.didResources.getPublicListItems, {
      listId: list._id,
    });

    const checkedCount = items.filter((i: { checked: boolean }) => i.checked).length;

    // Build the resource response
    const resource = {
      "@context": ["https://www.w3.org/ns/did/v1"],
      id: `${userDid}/resources/list-${listId}`,
      type: "PooList",
      controller: userDid,
      name: list.name,
      items: items.map((item: {
        _id: string;
        name: string;
        checked: boolean;
        createdAt: number;
        checkedAt?: number;
        description?: string;
        priority?: string;
        dueDate?: number;
        order?: number;
      }) => ({
        _id: item._id,
        name: item.name,
        checked: item.checked,
        createdAt: item.createdAt,
        ...(item.checkedAt && { checkedAt: item.checkedAt }),
        ...(item.description && { description: item.description }),
        ...(item.priority && { priority: item.priority }),
        ...(item.dueDate && { dueDate: item.dueDate }),
      })),
      createdAt: list.createdAt,
      itemCount: items.length,
      checkedCount,
    };

    return new Response(JSON.stringify(resource, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30",
        ...headers,
      },
    });
  } catch (error) {
    console.error("[didResources] Error serving list resource:", error);
    return new Response("Internal server error", { status: 500, headers });
  }
}

async function toggleItem(
  ctx: { runQuery: Function; runMutation: Function },
  userPath: string,
  listId: string,
  itemId: string,
  checked: boolean,
  headers: Record<string, string>
): Promise<Response> {
  try {
    // Resolve list the same way as serveListResource (didLogs primary, publication fallback)
    const fullRecord = await ctx.runQuery(api.didLogs.getDidLogRecordByPath, { path: userPath });
    let userDid: string | null = fullRecord?.userDid ?? null;
    let list = null;

    if (userDid) {
      list = await ctx.runQuery(api.didResources.getPublicList, { listId, ownerDid: userDid });
    }

    if (!list) {
      const candidate = await ctx.runQuery(api.didResources.getListById, { listId });
      if (!candidate) return new Response("List not found", { status: 404, headers });

      const publication = await ctx.runQuery(api.didResources.getActivePublicationByListId, {
        listId: candidate._id,
      });
      if (!publication) return new Response("List not found", { status: 404, headers });

      const expectedSuffix = `:${userPath}/resources/list-${listId}`;
      if (!publication.webvhDid.endsWith(expectedSuffix)) {
        return new Response("List not found", { status: 404, headers });
      }
      list = candidate;
    }

    if (checked) {
      await ctx.runMutation(api.didResources.checkSharedItem, {
        listId: list._id,
        itemId,
      });
    } else {
      await ctx.runMutation(api.didResources.uncheckSharedItem, {
        listId: list._id,
        itemId,
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...headers },
    });
  } catch (error) {
    console.error("[didResources] Error toggling item:", error);
    return new Response("Internal server error", { status: 500, headers });
  }
}
