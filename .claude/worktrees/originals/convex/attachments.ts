/**
 * File attachments for list items — stored in Railway Bucket.
 */

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
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  bucketKey as makeBucketKey,
  deleteObject,
  presignGet,
  presignPut,
} from "./lib/bucket";

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/json": "json",
};

const ALLOWED_CONTENT_TYPES = new Set(Object.keys(EXT_BY_CONTENT_TYPE));
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function extensionFor(contentType: string): string {
  return EXT_BY_CONTENT_TYPE[contentType] ?? "bin";
}

async function canUserEditList(
  ctx: MutationCtx | QueryCtx,
  listId: Id<"lists">,
  userDid: string,
  legacyDid?: string
): Promise<boolean> {
  const list = await ctx.db.get(listId);
  if (!list) return false;

  const dids = [userDid];
  if (legacyDid) dids.push(legacyDid);

  if (dids.includes(list.ownerDid)) return true;

  const pub = await ctx.db
    .query("publications")
    .withIndex("by_list", (q) => q.eq("listId", listId))
    .first();

  return pub?.status === "active";
}

export const generateUploadUrl = action({
  args: {
    itemId: v.id("items"),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
    contentType: v.string(),
    byteLength: v.number(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ uploadUrl: string; bucketKey: string }> => {
    if (!ALLOWED_CONTENT_TYPES.has(args.contentType)) {
      throw new Error(`Unsupported file type: ${args.contentType}`);
    }
    if (args.byteLength <= 0 || args.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error("File is empty or exceeds the 10 MB limit.");
    }

    const owned = await ctx.runQuery(internal.attachments.assertItemEditable, {
      itemId: args.itemId,
      userDid: args.userDid,
      legacyDid: args.legacyDid,
    });
    if (!owned) {
      throw new Error("Not authorized to add attachments to this item");
    }

    const key = makeBucketKey(
      "attachments",
      args.itemId,
      `${crypto.randomUUID()}.${extensionFor(args.contentType)}`
    );
    const uploadUrl = await presignPut(key, {
      contentType: args.contentType,
      expiresSec: 600,
    });
    return { uploadUrl, bucketKey: key };
  },
});

export const addAttachment = mutation({
  args: {
    itemId: v.id("items"),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
    bucketKey: v.string(),
    contentType: v.string(),
    size: v.number(),
    sha256: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item not found");

    const canEdit = await canUserEditList(ctx, item.listId, args.userDid, args.legacyDid);
    if (!canEdit) {
      throw new Error("Not authorized to add attachments to this item");
    }

    const current = item.attachments ?? [];
    await ctx.db.patch(args.itemId, {
      attachments: [
        ...current,
        {
          key: args.bucketKey,
          contentType: args.contentType,
          size: args.size,
          sha256: args.sha256,
        },
      ],
      updatedAt: Date.now(),
    });
  },
});

export const removeAttachment = action({
  args: {
    itemId: v.id("items"),
    bucketKey: v.string(),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const owned = await ctx.runQuery(internal.attachments.assertItemEditable, {
      itemId: args.itemId,
      userDid: args.userDid,
      legacyDid: args.legacyDid,
    });
    if (!owned) {
      throw new Error("Not authorized to remove attachments from this item");
    }

    await deleteObject(args.bucketKey);
    await ctx.runMutation(internal.attachments.dropAttachment, {
      itemId: args.itemId,
      bucketKey: args.bucketKey,
    });
  },
});

export const getAttachmentUrls = query({
  args: { itemId: v.id("items") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item || !item.attachments) return [];

    // Legacy v.id("_storage") entries (un-migrated) are filtered out;
    // the bucketBackfill migration converts them to object form.
    const objects = item.attachments.filter(
      (entry): entry is { key: string; contentType: string; size: number; sha256: string } =>
        typeof entry === "object"
    );

    return await Promise.all(
      objects.map(async (entry) => ({
        key: entry.key,
        contentType: entry.contentType,
        size: entry.size,
        url: await presignGet(entry.key, { expiresSec: 600 }),
      }))
    );
  },
});

export const assertItemEditable = internalQuery({
  args: {
    itemId: v.id("items"),
    userDid: v.string(),
    legacyDid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;
    const canEdit = await canUserEditList(ctx, item.listId, args.userDid, args.legacyDid);
    return canEdit ? { itemId: item._id } : null;
  },
});

export const dropAttachment = internalMutation({
  args: { itemId: v.id("items"), bucketKey: v.string() },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return;
    const current = item.attachments ?? [];
    const remaining = current.filter(
      (entry) => typeof entry !== "object" || entry.key !== args.bucketKey
    );
    await ctx.db.patch(args.itemId, {
      attachments: remaining,
      updatedAt: Date.now(),
    });
  },
});
