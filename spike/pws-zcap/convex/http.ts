// THROWAWAY spike code (#286). Gate 2: a Convex HTTP route (default V8
// runtime) that only serves a request carrying a valid zCap invocation.
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifyInvocation } from "./zcapVerify";

const http = httpRouter();

const handler = (runtime: "v8" | "node") => httpAction(async (ctx, request) => {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => { headers[key] = value; });
  const url = new URL(request.url);
  const body = request.method === "GET" ? undefined : await request.text();
  // The owner is named by the path; their DID document is what boop stores (didLogs).
  const owner = await ctx.runQuery(internal.spike.owner, {});
  if (!owner) return Response.json({ verified: false, error: "not seeded" }, { status: 500 });
  const now = url.searchParams.get("spikeNow"); // test hook: verify as of another time
  const input = {
    url: request.url,
    method: request.method,
    headers,
    ...(body !== undefined ? { body } : {}),
    rootTarget: `${url.origin}${runtime === "node" ? "/node" : ""}/lws/`,
    rootController: owner.did,
    expectedAction: headers["x-spike-action"] ?? "item.created",
    didDocuments: { [owner.did]: JSON.parse(owner.document) },
    ...(now ? { now: Number(now) } : {}),
  };
  const result = runtime === "v8" ? await verifyInvocation(input) : await ctx.runAction(internal.nodeVerify.verify, { input: JSON.stringify(input) });
  return Response.json({ runtime, ...result, bodyBytes: body?.length ?? 0, seenUrl: request.url, seenHost: headers.host ?? null }, { status: result.verified ? 200 : 403 });
});

http.route({ pathPrefix: "/lws/", method: "POST", handler: handler("v8") });
http.route({ pathPrefix: "/lws/", method: "GET", handler: handler("v8") });
http.route({ pathPrefix: "/node/lws/", method: "POST", handler: handler("node") });

export default http;
