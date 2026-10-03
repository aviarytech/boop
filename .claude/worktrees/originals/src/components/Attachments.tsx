/**
 * Attachments component for uploading and viewing files on items.
 * Uses Convex file storage for secure file handling.
 */

import { useState, useRef } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useSettings } from "../hooks/useSettings";

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface AttachmentsProps {
  itemId: Id<"items">;
  userDid: string;
  legacyDid?: string;
  canEdit: boolean;
}

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Limit per selection to avoid accidental huge uploads
const MAX_FILES_PER_UPLOAD = 5;

// Allowed file types
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/json",
];

export function Attachments({ itemId, userDid, legacyDid, canEdit }: AttachmentsProps) {
  const { haptic } = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [failedPreviewKeys, setFailedPreviewKeys] = useState<Record<string, true>>({});

  // Fetch attachment URLs
  const attachments = useQuery(api.attachments.getAttachmentUrls, { itemId });

  const generateUploadUrl = useAction(api.attachments.generateUploadUrl);
  const addAttachment = useMutation(api.attachments.addAttachment);
  const removeAttachment = useAction(api.attachments.removeAttachment);

  const handleUploadClick = () => {
    if (!canEdit) return;
    haptic("light");
    fileInputRef.current?.click();
  };

  const uploadSingleFile = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const sha256 = await sha256Hex(buffer);
    const contentType = file.type || "application/octet-stream";

    const { uploadUrl, bucketKey } = await generateUploadUrl({
      itemId,
      userDid,
      legacyDid,
      contentType,
      byteLength: file.size,
    });

    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: buffer,
    });

    if (!response.ok) {
      throw new Error("Upload failed");
    }

    await addAttachment({
      itemId,
      userDid,
      legacyDid,
      bucketKey,
      contentType,
      size: file.size,
      sha256,
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    // Clear previous error
    setUploadError(null);

    const files = Array.from(selectedFiles).slice(0, MAX_FILES_PER_UPLOAD);
    const rejected: string[] = [];
    const validFiles: File[] = [];

    // Validate selected files
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        rejected.push(`${file.name} (too large)`);
        continue;
      }

      if (!ALLOWED_TYPES.includes(file.type)) {
        rejected.push(`${file.name} (unsupported type)`);
        continue;
      }

      validFiles.push(file);
    }

    if (validFiles.length === 0) {
      setUploadError("No valid files selected. Use images, PDFs, or text files under 10MB.");
      haptic("error");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (rejected.length > 0) {
      setUploadError(`Skipped ${rejected.length} file(s): ${rejected.slice(0, 2).join(", ")}${rejected.length > 2 ? "..." : ""}`);
    }

    setUploadingCount(validFiles.length);
    haptic("medium");

    try {
      for (const file of validFiles) {
        await uploadSingleFile(file);
        setUploadingCount((count) => Math.max(0, count - 1));
      }
      haptic("success");
    } catch (err) {
      console.error("Failed to upload attachment:", err);
      setUploadError("Failed to upload one or more files. Please try again.");
      haptic("error");
    } finally {
      setUploadingCount(0);
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDelete = async (bucketKey: string) => {
    if (!canEdit) return;

    haptic("medium");
    setDeletingKey(bucketKey);

    try {
      await removeAttachment({
        itemId,
        bucketKey,
        userDid,
        legacyDid,
      });
      setFailedPreviewKeys((prev) => {
        if (!prev[bucketKey]) return prev;
        const clone = { ...prev };
        delete clone[bucketKey];
        return clone;
      });
      haptic("success");
    } catch (err) {
      console.error("Failed to remove attachment:", err);
      haptic("error");
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ALLOWED_TYPES.join(",")}
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Attachment grid */}
      {attachments && attachments.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {attachments.map(({ key, url }) => (
            <div
              key={key}
              className="relative group aspect-square bg-gray-100 dark:bg-gray-900 rounded-lg overflow-hidden"
            >
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full h-full"
                  title="Open attachment"
                >
                  {!failedPreviewKeys[key] ? (
                    <img
                      src={url}
                      alt="Attachment"
                      className="w-full h-full object-cover"
                      onError={() => {
                        setFailedPreviewKeys((prev) => ({ ...prev, [key]: true }));
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                  )}
                </a>
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              )}

              {/* Delete button */}
              {canEdit && (
                <button
                  onClick={() => handleDelete(key)}
                  disabled={deletingKey === key}
                  className="absolute top-1 right-1 p-1 bg-red-500 hover:bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                >
                  {deletingKey === key ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload button */}
      {canEdit && (
        <button
          onClick={handleUploadClick}
          disabled={uploadingCount > 0}
          className="flex items-center gap-2 w-full px-3 py-2 bg-gray-100 dark:bg-gray-900 hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {uploadingCount > 0 ? (
            <>
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Uploading {uploadingCount}...
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Add photos or files
            </>
          )}
        </button>
      )}

      {/* Error message */}
      {uploadError && (
        <p className="text-xs text-red-500 dark:text-red-400">{uploadError}</p>
      )}

      {/* Empty state */}
      {(!attachments || attachments.length === 0) && !canEdit && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          No attachments
        </p>
      )}
    </div>
  );
}

/**
 * Compact attachment preview for list items.
 * Shows small thumbnail count.
 */
interface AttachmentPreviewProps {
  itemId: Id<"items">;
  count?: number;
}

export function AttachmentPreview({ count }: AttachmentPreviewProps) {
  if (!count || count === 0) return null;

  return (
    <div className="flex items-center gap-1 text-gray-400 dark:text-gray-500">
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
      </svg>
      <span className="text-[10px] font-medium">{count}</span>
    </div>
  );
}
