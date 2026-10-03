import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  bucketKey as makeBucketKey,
  deleteObject,
  presignPut,
} from "./lib/bucket";

const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  // images
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/avif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  // web content
  "text/html",
  "text/html; charset=utf-8",
  "text/css",
  "text/css; charset=utf-8",
  "text/javascript",
  "text/javascript; charset=utf-8",
  "application/javascript",
  "application/javascript; charset=utf-8",
  "application/json",
  "application/json; charset=utf-8",
  "text/plain",
  "text/plain; charset=utf-8",
  "application/wasm",
  // fonts
  "font/woff",
  "font/woff2",
  "application/font-woff",
  "application/font-woff2",
]);

function sanitizeFileName(fileName: string): string {
  const cleaned = fileName
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .replace(/[^A-Za-z0-9._\-]/g, "_")
    .replace(/^\.+/, "");
  if (!cleaned) throw new Error("Filename is empty.");
  if (cleaned.length > 128) throw new Error("Filename is too long.");
  return cleaned;
}

export const generateSiteAssetUploadUrl = action({
  args: {
    ownerDid: v.string(),
    siteId: v.id("sites"),
    fileName: v.string(),
    contentType: v.string(),
    byteLength: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ uploadUrl: string; bucketKey: string; fileName: string }> => {
    if (!ALLOWED_TYPES.has(args.contentType)) {
      throw new Error(`Unsupported asset type: ${args.contentType}`);
    }
    if (args.byteLength <= 0 || args.byteLength > MAX_ASSET_BYTES) {
      throw new Error("Asset is empty or exceeds the 10 MB limit.");
    }

    const owned = await ctx.runQuery(internal.siteAssets.assertOwnsSite, {
      siteId: args.siteId,
      ownerDid: args.ownerDid,
    });
    if (!owned) throw new Error("Site not found");

    const fileName = sanitizeFileName(args.fileName);
    const key = makeBucketKey("site-assets", args.siteId, fileName);
    const uploadUrl = await presignPut(key, {
      contentType: args.contentType,
      expiresSec: 600,
    });
    return { uploadUrl, bucketKey: key, fileName };
  },
});

export const addSiteAsset = mutation({
  args: {
    ownerDid: v.string(),
    siteId: v.id("sites"),
    fileName: v.string(),
    bucketKey: v.string(),
    contentType: v.string(),
    byteLength: v.number(),
    sha256: v.string(),
  },
  handler: async (ctx, args): Promise<{ assetId: Id<"siteAssets"> }> => {
    const site = await ctx.db.get(args.siteId);
    if (!site || site.ownerDid !== args.ownerDid) {
      throw new Error("Site not found");
    }

    const fileName = sanitizeFileName(args.fileName);
    const now = Date.now();
    const existing = await ctx.db
      .query("siteAssets")
      .withIndex("by_site_filename", (q) =>
        q.eq("siteId", args.siteId).eq("fileName", fileName)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        bucketKey: args.bucketKey,
        contentType: args.contentType,
        byteLength: args.byteLength,
        sha256: args.sha256,
        updatedAt: now,
      });
      return { assetId: existing._id };
    }

    const assetId = await ctx.db.insert("siteAssets", {
      siteId: args.siteId,
      fileName,
      bucketKey: args.bucketKey,
      contentType: args.contentType,
      byteLength: args.byteLength,
      sha256: args.sha256,
      createdAt: now,
    });
    return { assetId };
  },
});

export const listSiteAssets = query({
  args: { ownerDid: v.string(), siteId: v.id("sites") },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site || site.ownerDid !== args.ownerDid) return [];

    return await ctx.db
      .query("siteAssets")
      .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
      .order("desc")
      .collect();
  },
});

export const removeSiteAsset = action({
  args: {
    ownerDid: v.string(),
    assetId: v.id("siteAssets"),
  },
  handler: async (ctx, args): Promise<void> => {
    const asset = await ctx.runQuery(internal.siteAssets.getOwnedAsset, {
      assetId: args.assetId,
      ownerDid: args.ownerDid,
    });
    if (!asset) throw new Error("Asset not found");

    await deleteObject(asset.bucketKey);
    await ctx.runMutation(internal.siteAssets.deleteAssetRow, {
      assetId: args.assetId,
    });
  },
});

export const assertOwnsSite = internalQuery({
  args: { siteId: v.id("sites"), ownerDid: v.string() },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site || site.ownerDid !== args.ownerDid) return null;
    return { siteId: site._id };
  },
});

export const getOwnedAsset = internalQuery({
  args: { assetId: v.id("siteAssets"), ownerDid: v.string() },
  handler: async (ctx, args) => {
    const asset = await ctx.db.get(args.assetId);
    if (!asset) return null;
    const site = await ctx.db.get(asset.siteId);
    if (!site || site.ownerDid !== args.ownerDid) return null;
    return asset;
  },
});

export const deleteAssetRow = internalMutation({
  args: { assetId: v.id("siteAssets") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.assetId);
  },
});

export const resolvePublicAsset = internalQuery({
  args: { siteId: v.id("sites"), fileName: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("siteAssets")
      .withIndex("by_site_filename", (q) =>
        q.eq("siteId", args.siteId).eq("fileName", args.fileName)
      )
      .first();
  },
});
