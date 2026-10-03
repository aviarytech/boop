import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { anonDistinctId, captureEvent } from "./convex/lib/analytics";

const port = Number(process.env.PORT || 3000);
const distDir = join(process.cwd(), "dist");
const siteCacheControl = "public, max-age=300, s-maxage=86400";

function normalizeBaseDomain(baseDomain: string): string {
  return baseDomain
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0]
    .trim()
    .toLowerCase();
}

function configuredAppHostnames(): Set<string> {
  const explicit = process.env.APP_HOSTNAMES;
  const baseDomain = normalizeBaseDomain(
    process.env.SITE_BASE_DOMAIN || process.env.WEBVH_DOMAIN || "boop.ad"
  );
  const values = explicit
    ? explicit.split(",")
    : [baseDomain, `www.${baseDomain}`, "localhost", "127.0.0.1", "0.0.0.0"];
  return new Set(values.map((value) => normalizeBaseDomain(value)).filter(Boolean));
}

const appHostnames = configuredAppHostnames();

function hostnameFromRequest(request: Request): string {
  // Cloudflare for SaaS proxies customer-domain traffic to the boop.ad
  // Railway origin. Railway routes by Host header, so a Cloudflare Origin
  // Rule rewrites Host -> boop.ad and a Transform Rule preserves the
  // original customer hostname in X-Original-Host. Prefer that header so
  // we know which hosted site to serve.
  const original = request.headers.get("x-original-host");
  if (original) return original.split(":")[0].toLowerCase();
  const host = request.headers.get("host") || "";
  return host.split(":")[0].toLowerCase();
}

function isAppHostname(hostname: string): boolean {
  return appHostnames.has(hostname);
}

function contentTypeFor(pathname: string): string {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".ico")) return "image/x-icon";
  if (pathname.endsWith(".webmanifest")) return "application/manifest+json";
  return "application/octet-stream";
}

function safeDistPath(pathname: string): string {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const normalized = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  return join(distDir, normalized);
}

async function serveApp(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let filePath = safeDistPath(url.pathname);

  if (!existsSync(filePath)) {
    filePath = join(distDir, "index.html");
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return new Response("boop has not been built yet. Run `bun run build` first.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(file, {
    headers: {
      "Content-Type": contentTypeFor(filePath),
    },
  });
}

async function resolveHostedSite(hostname: string) {
  const convexHttpUrl = process.env.CONVEX_HTTP_URL || process.env.VITE_CONVEX_HTTP_URL;
  if (!convexHttpUrl) {
    return null;
  }

  const response = await fetch(
    `${convexHttpUrl}/api/sites/resolve-host?hostname=${encodeURIComponent(hostname)}`
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Host resolve failed with ${response.status}`);
  }
  return response.json() as Promise<{
    status: "active" | "missing" | "pending" | "redirect" | "error";
    hostname: string;
    location?: string;
    bucketUrl?: string;
    contentType?: string;
    didLogJsonl?: string;
    siteId?: string;
    did?: string;
    scid?: string;
  }>;
}


function clientIpFromRequest(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function resolveSiteAssetUrl(
  hostname: string,
  fileName: string
): Promise<{ status: "active" | "missing" | "pending"; url?: string; contentType?: string }> {
  const convexHttpUrl = process.env.CONVEX_HTTP_URL || process.env.VITE_CONVEX_HTTP_URL;
  if (!convexHttpUrl) return { status: "missing" };

  const response = await fetch(
    `${convexHttpUrl}/api/sites/resolve-asset?hostname=${encodeURIComponent(hostname)}&fileName=${encodeURIComponent(fileName)}`
  );
  if (response.status === 404) return { status: "missing" };
  if (!response.ok) throw new Error(`Asset resolve failed with ${response.status}`);
  return response.json() as Promise<{
    status: "active" | "missing" | "pending";
    url?: string;
    contentType?: string;
    siteId?: string;
  }>;
}

function missingSitePage(hostname: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found on boop</title><style>body{font-family:ui-sans-serif,system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#fafaf7;color:#292524}.wrap{max-width:34rem;padding:2rem}h1{font-size:clamp(2rem,8vw,4rem);line-height:1;margin:0 0 1rem}p{font-size:1.05rem;color:#57534e;line-height:1.6}</style></head><body><main class="wrap"><h1>Nothing here yet.</h1><p><strong>${hostname}</strong> does not exist on boop, or it is still waking up. Check the link and try again.</p></main></body></html>`,
    {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }
  );
}

async function serveHostedSiteAsset(
  request: Request,
  hostname: string,
  fileName: string
): Promise<Response> {
  const asset = await resolveSiteAssetUrl(hostname, fileName);
  if (asset.status === "active" && asset.url) {
    void trackAssetView(request, hostname, fileName, asset).catch(() => {});
    return Response.redirect(asset.url, 302);
  }
  return missingSitePage(hostname);
}

async function trackSiteView(
  request: Request,
  hostname: string,
  site: { siteId?: string; did?: string; scid?: string; contentType?: string }
): Promise<void> {
  const ip = clientIpFromRequest(request);
  const ua = request.headers.get("user-agent") ?? "";
  const referrer = request.headers.get("referer") ?? "";
  const distinctId = await anonDistinctId(ip, ua);
  await captureEvent({
    event: "site_view",
    distinctId,
    properties: {
      $current_url: `https://${hostname}/`,
      $referrer: referrer,
      $ip: ip,
      $useragent: ua,
      site_id: site.siteId,
      site_hostname: hostname,
      site_did: site.did,
      site_scid: site.scid,
      content_type: site.contentType,
    },
  });
}

async function trackAssetView(
  request: Request,
  hostname: string,
  fileName: string,
  asset: { siteId?: string; contentType?: string }
): Promise<void> {
  const ip = clientIpFromRequest(request);
  const ua = request.headers.get("user-agent") ?? "";
  const referrer = request.headers.get("referer") ?? "";
  const distinctId = await anonDistinctId(ip, ua);
  await captureEvent({
    event: "site_asset_view",
    distinctId,
    properties: {
      $current_url: `https://${hostname}/_assets/${fileName}`,
      $referrer: referrer,
      $ip: ip,
      $useragent: ua,
      site_id: asset.siteId,
      site_hostname: hostname,
      file_name: fileName,
      content_type: asset.contentType,
    },
  });
}

async function serveHostedSite(request: Request, hostname: string): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/_assets/")) {
    const fileName = decodeURIComponent(url.pathname.slice("/_assets/".length));
    if (!fileName || fileName.includes("/")) return missingSitePage(hostname);
    return serveHostedSiteAsset(request, hostname, fileName);
  }

  const site = await resolveHostedSite(hostname);

  if (!site || site.status === "missing" || site.status === "error") {
    return missingSitePage(hostname);
  }

  if (site.status === "pending") {
    return new Response("This boop site is still getting ready.", {
      status: 202,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (site.status === "redirect" && site.location) {
    return Response.redirect(site.location, 302);
  }

  if (url.pathname === "/.well-known/did.jsonl") {
    return new Response(site.didLogJsonl || "", {
      headers: {
        "Content-Type": "application/jsonl; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  if (url.pathname === "/") {
    if (!site.bucketUrl) return missingSitePage(hostname);
    const bucketResponse = await fetch(site.bucketUrl);
    if (!bucketResponse.ok) return missingSitePage(hostname);
    void trackSiteView(request, hostname, site).catch(() => {});
    return new Response(bucketResponse.body, {
      headers: {
        "Content-Type": site.contentType || "text/html; charset=utf-8",
        "Cache-Control": siteCacheControl,
      },
    });
  }

  return missingSitePage(hostname);
}

Bun.serve({
  port,
  async fetch(request) {
    try {
      const hostname = hostnameFromRequest(request);
      if (isAppHostname(hostname)) {
        return serveApp(request);
      }
      return serveHostedSite(request, hostname);
    } catch (error) {
      console.error("[server] request failed", error);
      return new Response("boop tripped while serving this. Try again in a moment.", {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
});

console.log(`boop server listening on :${port}`);
