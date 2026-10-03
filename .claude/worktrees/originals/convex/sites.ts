import { v } from "convex/values";
import { action, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  bucketKey as makeBucketKey,
  presignGet,
  presignPut,
} from "./lib/bucket";

const UPLOAD_EXPIRY_SEC = 600;
const PREVIEW_EXPIRY_SEC = 300;
const SITE_HTML_CONTENT_TYPE = "text/html; charset=utf-8";

function newSiteBucketKey(): string {
  return makeBucketKey("siteFiles", `${crypto.randomUUID()}.html`);
}

export const generateSiteUploadUrl = action({
  args: { ownerDid: v.string() },
  handler: async (
    _ctx,
    _args
  ): Promise<{ uploadUrl: string; bucketKey: string }> => {
    const key = newSiteBucketKey();
    const uploadUrl = await presignPut(key, {
      contentType: SITE_HTML_CONTENT_TYPE,
      expiresSec: UPLOAD_EXPIRY_SEC,
    });
    return { uploadUrl, bucketKey: key };
  },
});

export const listSites = query({
  args: { ownerDid: v.string() },
  handler: async (ctx, args) => {
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_owner", (q) => q.eq("ownerDid", args.ownerDid))
      .order("desc")
      .collect();

    return Promise.all(
      sites.map(async (site) => {
        const primaryHostname = site.primaryHostnameId
          ? await ctx.db.get(site.primaryHostnameId)
          : null;
        return { ...site, primaryHostname };
      })
    );
  },
});

export const getSite = query({
  args: {
    siteId: v.id("sites"),
    ownerDid: v.string(),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site || site.ownerDid !== args.ownerDid) return null;

    const [file, key, hostnames, didLogEntries] = await Promise.all([
      ctx.db.get(site.fileId),
      ctx.db
        .query("siteKeys")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .first(),
      ctx.db
        .query("siteHostnames")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .collect(),
      ctx.db
        .query("siteDidLogEntries")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .collect(),
    ]);

    const primaryHostname =
      site.primaryHostnameId != null ? await ctx.db.get(site.primaryHostnameId) : null;

    return {
      ...site,
      file: file
        ? {
            _id: file._id,
            contentType: file.contentType,
            sha256: file.sha256,
            byteLength: file.byteLength,
            bucketKey: file.bucketKey ?? null,
            createdAt: file.createdAt,
          }
        : null,
      publicKeyMultibase: key?.publicKeyMultibase ?? null,
      hostnames,
      primaryHostname,
      didLogJsonl: didLogEntries
        .sort((a, b) => a.signedAt - b.signedAt)
        .map((entry) => entry.entryJsonl)
        .join("\n"),
    };
  },
});

export const getSitePreviewUrl = action({
  args: { siteId: v.id("sites"), ownerDid: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const site = await ctx.runQuery(internal.sites.getSiteFileBucketKey, {
      siteId: args.siteId,
      ownerDid: args.ownerDid,
    });
    if (!site?.bucketKey) return null;
    return await presignGet(site.bucketKey, { expiresSec: PREVIEW_EXPIRY_SEC });
  },
});

export const getSiteFileBucketKey = internalQuery({
  args: { siteId: v.id("sites"), ownerDid: v.string() },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site || site.ownerDid !== args.ownerDid) return null;
    const file = await ctx.db.get(site.fileId);
    if (!file) return null;
    return { bucketKey: file.bucketKey ?? null };
  },
});

export const getPublicSiteByHostname = query({
  args: { hostname: v.string() },
  handler: async (ctx, args) => {
    const normalizedHostname = args.hostname.toLowerCase();
    const hostname = await ctx.db
      .query("siteHostnames")
      .withIndex("by_hostname", (q) => q.eq("hostname", normalizedHostname))
      .first();

    if (!hostname) return null;
    const site = await ctx.db.get(hostname.siteId);
    if (!site) return null;
    const file = await ctx.db.get(site.fileId);
    if (!file) return null;
    const didLogEntries = await ctx.db
      .query("siteDidLogEntries")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .collect();

    const primaryHostname =
      site.primaryHostnameId != null ? await ctx.db.get(site.primaryHostnameId) : null;

    return {
      site,
      hostname,
      primaryHostname,
      file: {
        contentType: file.contentType,
        sha256: file.sha256,
        byteLength: file.byteLength,
        bucketKey: file.bucketKey ?? null,
      },
      didLogJsonl: didLogEntries
        .sort((a, b) => a.signedAt - b.signedAt)
        .map((entry) => entry.entryJsonl)
        .join("\n"),
    };
  },
});
