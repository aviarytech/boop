import { useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useToast } from "../../hooks/useToast";
import { useSettings } from "../../hooks/useSettings";

type Props = {
  siteId: Id<"sites">;
  ownerDid: string;
  hostname: string;
};

const ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/x-icon",
  "image/avif",
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "application/json",
  "text/plain",
  "application/wasm",
  "font/woff",
  "font/woff2",
].join(",");
const MAX_BYTES = 10 * 1024 * 1024;

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function assetIcon(contentType: string): string {
  if (contentType.startsWith("image/")) return "🖼";
  if (contentType.startsWith("text/html")) return "📄";
  if (contentType.startsWith("text/css")) return "🎨";
  if (contentType.includes("javascript")) return "📜";
  if (contentType.includes("json")) return "📋";
  if (contentType.startsWith("font/")) return "🔤";
  return "📁";
}

export function SiteAssets({ siteId, ownerDid, hostname }: Props) {
  const assets = useQuery(api.siteAssets.listSiteAssets, { ownerDid, siteId });
  const generateUploadUrl = useAction(api.siteAssets.generateSiteAssetUploadUrl);
  const addAsset = useMutation(api.siteAssets.addSiteAsset);
  const removeAsset = useAction(api.siteAssets.removeSiteAsset);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const { addToast } = useToast();
  const { haptic } = useSettings();

  const sorted = useMemo(
    () => (assets ?? []).slice().sort((a, b) => b.createdAt - a.createdAt),
    [assets]
  );

  const handleUpload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      addToast("That file is over the 10 MB limit.", "error");
      return;
    }
    setUploading(true);
    haptic("medium");
    try {
      const buffer = await file.arrayBuffer();
      const sha256 = await sha256Hex(buffer);
      const contentType = file.type || "application/octet-stream";
      const { uploadUrl, bucketKey, fileName } = await generateUploadUrl({
        ownerDid,
        siteId,
        fileName: file.name,
        contentType,
        byteLength: file.size,
      });
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: buffer,
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed (${putRes.status})`);
      }
      await addAsset({
        ownerDid,
        siteId,
        fileName,
        bucketKey,
        contentType,
        byteLength: file.size,
        sha256,
      });
      addToast(`Uploaded ${fileName}`);
      haptic("success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      addToast(message, "error");
      haptic("error");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = async (asset: Doc<"siteAssets">) => {
    if (!confirm(`Delete ${asset.fileName}?`)) return;
    try {
      await removeAsset({ ownerDid, assetId: asset._id });
      addToast(`Deleted ${asset.fileName}`);
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : "Could not delete that file.",
        "error"
      );
    }
  };

  return (
    <div className="rounded-2xl border border-stone-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between border-b border-stone-100 dark:border-gray-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-stone-800 dark:text-stone-100">
            Files
          </h2>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Images, sub-pages, CSS, JS — served at <code>/_assets/&lt;filename&gt;</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {uploading ? "Uploading…" : "Upload file"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />
      </div>

      {sorted.length === 0 ? (
        <p className="px-4 py-6 text-sm text-stone-500 dark:text-stone-400">
          No files yet.
        </p>
      ) : (
        <ul className="divide-y divide-stone-100 dark:divide-gray-800">
          {sorted.map((asset) => {
            const href = hostname
              ? `https://${hostname}/_assets/${asset.fileName}`
              : "";
            return (
              <li
                key={asset._id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span className="text-xl" aria-hidden>
                  {assetIcon(asset.contentType)}
                </span>
                <div className="flex-1 min-w-0">
                  <a
                    href={href || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm font-medium text-stone-800 dark:text-stone-100 hover:text-amber-600"
                  >
                    {asset.fileName}
                  </a>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    {asset.contentType} · {formatBytes(asset.byteLength)}
                  </p>
                </div>
                <code className="hidden sm:block text-xs text-stone-500 dark:text-stone-400">
                  /_assets/{asset.fileName}
                </code>
                <button
                  type="button"
                  onClick={() => handleRemove(asset)}
                  className="rounded-lg px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
