/**
 * One-shot migration: copy Convex storage blobs to Railway Buckets.
 *
 * Run after deploying this branch:
 *   npx convex run migrations/bucketBackfill:runAll
 *   npx convex run --prod migrations/bucketBackfill:runAll
 *
 * Idempotent — rows already pointing at a bucketKey are skipped.
 * The legacy `storageId` fields and the Convex storage blobs are left in
 * place; a follow-up cleanup commit (post-verification) deletes them.
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { bucketKey as makeBucketKey, putObject } from "../lib/bucket";

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/json": "json",
  "text/html": "html",
  "text/html; charset=utf-8": "html",
};

function extensionFor(contentType: string): string {
  return EXT_BY_CONTENT_TYPE[contentType] ?? "bin";
}

function attachmentKey(itemId: Id<"items">, sha256: string, contentType: string): string {
  return makeBucketKey("attachments", itemId, `${sha256}.${extensionFor(contentType)}`);
}

function siteFileKey(fileId: Id<"siteFiles">): string {
  return makeBucketKey("siteFiles", `${fileId}.html`);
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return await blob.arrayBuffer();
}

export const runAll = internalAction({
  args: {},
  handler: async (ctx): Promise<{ siteFiles: number; attachments: number }> => {
    const sites: { migrated: number } = await ctx.runAction(
      internal.migrations.bucketBackfill.backfillSiteFiles,
      {}
    );
    const attachments: { migrated: number } = await ctx.runAction(
      internal.migrations.bucketBackfill.backfillAttachments,
      {}
    );
    console.log(
      `[bucketBackfill] complete — ${sites.migrated} siteFiles, ${attachments.migrated} item attachments migrated`
    );
    return {
      siteFiles: sites.migrated,
      attachments: attachments.migrated,
    };
  },
});

// --- siteFiles ---

export const listUnmigratedSiteFiles = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("siteFiles").collect();
    return all
      .filter((row) => !row.bucketKey && row.storageId)
      .map((row) => ({
        _id: row._id,
        storageId: row.storageId!,
        contentType: row.contentType,
        sha256: row.sha256,
        byteLength: row.byteLength,
      }));
  },
});

export const setSiteFileBucketKey = internalMutation({
  args: { fileId: v.id("siteFiles"), bucketKey: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.fileId, { bucketKey: args.bucketKey });
  },
});

export const backfillSiteFiles = internalAction({
  args: {},
  handler: async (ctx): Promise<{ migrated: number; skipped: number }> => {
    const rows: Array<{
      _id: Id<"siteFiles">;
      storageId: Id<"_storage">;
      contentType: string;
      sha256: string;
      byteLength: number;
    }> = await ctx.runQuery(
      internal.migrations.bucketBackfill.listUnmigratedSiteFiles,
      {}
    );

    let migrated = 0;
    let skipped = 0;
    for (const row of rows) {
      const blob = await ctx.storage.get(row.storageId);
      if (!blob) {
        console.warn(`[bucketBackfill] siteFile ${row._id} storage blob missing`);
        skipped += 1;
        continue;
      }
      const buffer = await blobToArrayBuffer(blob);
      const key = siteFileKey(row._id);
      await putObject(key, buffer, { contentType: row.contentType });
      await ctx.runMutation(internal.migrations.bucketBackfill.setSiteFileBucketKey, {
        fileId: row._id,
        bucketKey: key,
      });
      migrated += 1;
    }
    return { migrated, skipped };
  },
});

// --- item attachments ---

type AttachmentObject = {
  key: string;
  contentType: string;
  size: number;
  sha256: string;
};

export const listItemsWithLegacyAttachments = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("items").collect();
    return all
      .filter((row) =>
        (row.attachments ?? []).some((entry) => typeof entry === "string")
      )
      .map((row) => ({
        _id: row._id,
        attachments: row.attachments ?? [],
      }));
  },
});

export const setItemAttachments = internalMutation({
  args: {
    itemId: v.id("items"),
    attachments: v.array(
      v.object({
        key: v.string(),
        contentType: v.string(),
        size: v.number(),
        sha256: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.itemId, {
      attachments: args.attachments,
      updatedAt: Date.now(),
    });
  },
});

export const backfillAttachments = internalAction({
  args: {},
  handler: async (ctx): Promise<{ migrated: number; skipped: number }> => {
    const rows: Array<{
      _id: Id<"items">;
      attachments: Array<Id<"_storage"> | AttachmentObject>;
    }> = await ctx.runQuery(
      internal.migrations.bucketBackfill.listItemsWithLegacyAttachments,
      {}
    );

    let migrated = 0;
    let skipped = 0;
    for (const item of rows) {
      const converted: AttachmentObject[] = [];
      let touched = false;
      for (const entry of item.attachments) {
        if (typeof entry !== "string") {
          converted.push(entry);
          continue;
        }
        const storageId = entry as Id<"_storage">;
        const blob = await ctx.storage.get(storageId);
        if (!blob) {
          console.warn(
            `[bucketBackfill] item ${item._id} storage blob ${storageId} missing`
          );
          skipped += 1;
          continue;
        }
        const buffer = await blobToArrayBuffer(blob);
        const meta = await ctx.storage.getMetadata(storageId);
        const contentType = meta?.contentType ?? "application/octet-stream";
        const size = meta?.size ?? buffer.byteLength;
        const sha256 = meta?.sha256 ?? (await sha256Hex(buffer));
        const key = attachmentKey(item._id, sha256, contentType);
        await putObject(key, buffer, { contentType });
        converted.push({ key, contentType, size, sha256 });
        touched = true;
        migrated += 1;
      }
      if (touched) {
        await ctx.runMutation(
          internal.migrations.bucketBackfill.setItemAttachments,
          {
            itemId: item._id,
            attachments: converted,
          }
        );
      }
    }
    return { migrated, skipped };
  },
});

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
