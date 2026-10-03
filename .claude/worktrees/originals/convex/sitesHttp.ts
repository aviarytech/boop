import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { presignGet } from "./lib/bucket";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function normalizedHostname(value: string | null): string | null {
  if (!value) return null;
  return value.split(":")[0].trim().toLowerCase();
}

export const resolveSiteHost = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const url = new URL(request.url);
  const hostname = normalizedHostname(url.searchParams.get("hostname"));
  if (!hostname) {
    return json({ status: "error", error: "hostname is required" }, 400);
  }

  const record = await ctx.runQuery(api.sites.getPublicSiteByHostname, {
    hostname,
  });

  if (!record) {
    return json({ status: "missing", hostname }, 404);
  }

  if (record.hostname.status === "redirected" && record.hostname.redirectTo) {
    return json({
      status: "redirect",
      hostname,
      location: `https://${record.hostname.redirectTo}`,
    });
  }

  if (record.hostname.status !== "active") {
    return json({
      status: "pending",
      hostname,
    });
  }

  if (!record.file.bucketKey) {
    return json({ status: "missing", hostname }, 404);
  }

  const bucketUrl = await presignGet(record.file.bucketKey, { expiresSec: 300 });

  return json({
    status: "active",
    hostname,
    siteId: record.site._id,
    did: record.site.did,
    scid: record.site.scid,
    primaryHostname: record.primaryHostname?.hostname ?? hostname,
    bucketUrl,
    contentType: record.file.contentType,
    sha256: record.file.sha256,
    didLogJsonl: record.didLogJsonl,
  });
});

export const resolveSiteAsset = httpAction(async (ctx, request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const url = new URL(request.url);
  const hostname = normalizedHostname(url.searchParams.get("hostname"));
  const fileName = url.searchParams.get("fileName");
  if (!hostname || !fileName) {
    return json({ status: "error", error: "hostname and fileName are required" }, 400);
  }

  const record = await ctx.runQuery(api.sites.getPublicSiteByHostname, { hostname });
  if (!record) return json({ status: "missing" }, 404);
  if (record.hostname.status !== "active") {
    return json({ status: "pending" }, 404);
  }

  const asset = await ctx.runQuery(internal.siteAssets.resolvePublicAsset, {
    siteId: record.site._id,
    fileName,
  });
  if (!asset) return json({ status: "missing" }, 404);

  const presigned = await presignGet(asset.bucketKey, { expiresSec: 300 });
  return json({
    status: "active",
    siteId: record.site._id,
    contentType: asset.contentType,
    byteLength: asset.byteLength,
    sha256: asset.sha256,
    url: presigned,
  });
});
