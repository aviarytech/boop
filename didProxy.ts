/**
 * Serve user DIDs at their did:webvh location.
 *
 * A did:webvh resolves by fetching https://<domain>/<path>/did.jsonl, so
 * did:webvh:…:boop.ad:user-abc resolves from https://boop.ad/user-abc/did.jsonl.
 * Convex serves the logs, but only under /d/ (its pathPrefix routes must end
 * in a slash), so the app server proxies these paths to it.
 *
 * /user-*\/resources/list-* is also the app's page for a shared list, so a
 * browser navigation there still gets the app; only a request that doesn't
 * ask for HTML (a resolver) is proxied. Only reads are proxied: the app calls
 * Convex's /d/ routes directly for writes.
 */

const DID_LOG = /^\/(user-[A-Za-z0-9_-]+)\/did\.jsonl$/;
const DID_RESOURCE = /^\/(user-[A-Za-z0-9_-]+)\/resources\/list-[A-Za-z0-9_-]+$/;

function wantsHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

/** The Convex /d/ URL for a DID path this server should proxy, or null. */
export function didProxyTarget(request: Request, convexHttpUrl: string): string | null {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) return null;
  const url = new URL(request.url);
  const isLog = DID_LOG.test(url.pathname);
  const isResource = DID_RESOURCE.test(url.pathname);
  if (!isLog && !(isResource && !wantsHtml(request))) return null;
  return `${convexHttpUrl.replace(/\/+$/, "")}/d${url.pathname}`;
}

/** Proxy a DID path to Convex, or return null when `request` isn't one. */
export async function serveDidPath(
  request: Request,
  convexHttpUrl: string | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<Response | null> {
  if (!convexHttpUrl) return null;
  const target = didProxyTarget(request, convexHttpUrl);
  if (!target) return null;
  const upstream = await fetchImpl(target, {
    method: request.method,
    headers: { accept: request.headers.get("accept") ?? "*/*", ...(request.headers.get("origin") ? { origin: request.headers.get("origin")! } : {}) },
    redirect: "manual",
  });
  const headers = new Headers();
  for (const name of ["content-type", "access-control-allow-origin", "access-control-allow-methods", "access-control-allow-headers"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Resolvers need the log to reach them even without an Origin header.
  if (!headers.has("access-control-allow-origin")) headers.set("access-control-allow-origin", "*");
  if (upstream.ok) headers.set("cache-control", "public, max-age=60");
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
}
