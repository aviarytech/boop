import { isResourceOwner } from "./lib/permissions";
import { actorAction, actorQuery } from "./lib/authenticated";
import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  bucketKey as makeBucketKey,
  presignGet,
  presignPut,
} from "./lib/bucket";

const UPLOAD_EXPIRY_SEC = 600;
const PREVIEW_EXPIRY_SEC = 300;
const SITE_HTML_CONTENT_TYPE = "text/html; charset=utf-8";

function newSiteBucketKey(ownerDid: string): string {
  return makeBucketKey("siteFiles", encodeURIComponent(ownerDid), `${crypto.randomUUID()}.html`);
}

export const { public: generateSiteUploadUrl, internal: generateSiteUploadUrlInternal } = actorAction({
  resources: () => ({}),
  scope: "*",
  args: {},
  handler: async (
    ctx
  ): Promise<{ uploadUrl: string; bucketKey: string }> => {
    const key = newSiteBucketKey(ctx.actor.did);
    const uploadUrl = await presignPut(key, {
      contentType: SITE_HTML_CONTENT_TYPE,
      expiresSec: UPLOAD_EXPIRY_SEC,
    });
    return { uploadUrl, bucketKey: key };
  },
});

export const { public: listSites, internal: listSitesInternal } = actorQuery({
  resources: () => ({}),
  scope: "*",
  args: {},
  handler: async (ctx) => {
    const identities = [ctx.actor.did, ctx.actor.legacyDid].filter((did): did is string => !!did);
    const sites = (await Promise.all(identities.map(did => ctx.db.query("sites")
      .withIndex("by_owner", q => q.eq("ownerDid", did)).order("desc").collect()))).flat();

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

export const { public: getSite, internal: getSiteInternal } = actorQuery({
  resources: () => ({}),
  scope: "*",
  args: {
    siteId: v.id("sites"),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site || !await isResourceOwner(ctx, site.ownerDid, ctx.actor.did)) return null;

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

export const { public: getSitePreviewUrl, internal: getSitePreviewUrlInternal } = actorAction({
  resources: () => ({}),
  scope: "*",
  args: { siteId: v.id("sites") },
  handler: async (ctx, args): Promise<string | null> => {
    const site = await ctx.runQuery(internal.sites.getSiteFileBucketKey, {
      siteId: args.siteId,
      ownerDid: ctx.actor.did,
    });
    if (!site?.bucketKey) return null;
    return await presignGet(site.bucketKey, { expiresSec: PREVIEW_EXPIRY_SEC });
  },
});

export const getSiteFileBucketKey = internalQuery({
  args: { siteId: v.id("sites"), ownerDid: v.string() },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site || !await isResourceOwner(ctx, site.ownerDid, args.ownerDid)) return null;
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
