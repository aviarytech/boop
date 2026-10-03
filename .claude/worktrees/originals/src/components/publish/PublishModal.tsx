/**
 * Panel for publishing a list to did:webvh.
 * Uses Panel component for slide-up drawer experience.
 *
 * Phase 4: Allows list owners to publish their lists publicly.
 * Published lists are verifiable and can be viewed by anyone.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useSettings } from "../../hooks/useSettings";
import { buildListResourceDid, buildListResourceUrl } from "../../lib/webvh";
import { Panel } from "../ui/Panel";

interface PublishModalProps {
  list: Doc<"lists">;
  onClose: () => void;
}

export function PublishModal({ list, onClose }: PublishModalProps) {
  const { did, subOrgId } = useCurrentUser();
  const { haptic } = useSettings();
  // List DID creation happens client-side
  const publishListMutation = useMutation(api.publication.publishList);
  const unpublishListMutation = useMutation(api.publication.unpublishList);
  const publicationStatus = useQuery(api.publication.getPublicationStatus, {
    listId: list._id,
  });

  const [isPublishing, setIsPublishing] = useState(false);
  const [isUnpublishing, setIsUnpublishing] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPublished = publicationStatus?.status === "active";
  const publicUrl = isPublished && did
    ? buildListResourceUrl(did, list._id)
    : null;

  const handlePublish = async () => {
    if (!did || !subOrgId) {
      setError("You must be logged in to publish a list");
      return;
    }

    setIsPublishing(true);
    setError(null);
    haptic('medium');

    try {
      // The list is a resource under the user's DID — no separate DID needed.
      const listResourceDid = buildListResourceDid(did, list._id);

      // Record publication in Convex
      await publishListMutation({
        listId: list._id,
        webvhDid: listResourceDid,
        publisherDid: did,
      });
      
      haptic('success');
    } catch (err) {
      console.error("[PublishModal] Failed to publish:", err);
      setError(
        err instanceof Error ? err.message : "Failed to publish list"
      );
      haptic('error');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!did) {
      setError("You must be logged in to unpublish a list");
      return;
    }

    setIsUnpublishing(true);
    setError(null);
    haptic('medium');

    try {
      await unpublishListMutation({
        listId: list._id,
        userDid: did,
      });
      haptic('success');
    } catch (err) {
      console.error("[PublishModal] Failed to unpublish:", err);
      setError(
        err instanceof Error ? err.message : "Failed to unpublish list"
      );
      haptic('error');
    } finally {
      setIsUnpublishing(false);
    }
  };

  const handleCopy = async () => {
    if (!publicUrl) return;

    try {
      await navigator.clipboard.writeText(publicUrl);
      haptic('success');
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
      haptic('error');
    }
  };

  const header = (
    <>
      <div className="flex items-center gap-3">
        <span className="text-2xl leading-none">{isPublished ? "🌐" : "📤"}</span>
        <div>
          <h2 id="publish-dialog-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {isPublished ? "Published List" : "Publish List"}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
            {list.name}
          </p>
        </div>
      </div>
      <button
        onClick={onClose}
        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        aria-label="Close"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </>
  );

  const footer = isPublished ? (
    <div className="px-5 py-4 flex gap-3">
      <button
        onClick={handleUnpublish}
        disabled={isUnpublishing}
        className="flex-1 px-4 py-3 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl font-medium hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-50 transition-colors"
      >
        {isUnpublishing ? "Unpublishing..." : "Unpublish"}
      </button>
      <button
        onClick={onClose}
        className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold transition-colors"
      >
        Done
      </button>
    </div>
  ) : (
    <div className="px-5 py-4 flex gap-3">
      <button
        onClick={() => {
          haptic('light');
          onClose();
        }}
        className="flex-1 px-4 py-3 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={handlePublish}
        disabled={isPublishing}
        className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-semibold shadow-lg shadow-amber-500/25 disabled:opacity-50 transition-all"
      >
        {isPublishing ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Publishing...
          </span>
        ) : (
          "Publish List"
        )}
      </button>
    </div>
  );

  // Loading state while fetching publication status
  if (publicationStatus === undefined) {
    return (
      <Panel
        isOpen={true}
        onClose={onClose}
        title="Loading..."
        ariaLabelledBy="publish-dialog-title"
      >
        <div className="p-5">
          <div className="flex items-center justify-center py-8">
            <svg className="w-8 h-8 animate-spin text-amber-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      isOpen={true}
      onClose={onClose}
      header={header}
      footer={footer}
      ariaLabelledBy="publish-dialog-title"
    >
      <div className="p-5 space-y-4">
        {isPublished ? (
          <>
            <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-xl">
              <div className="flex items-center gap-2 text-green-800 dark:text-green-400">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span className="font-medium">This list is published</span>
              </div>
              <p className="mt-1 text-sm text-green-700 dark:text-green-500">
                Anyone with the link can view this list.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Public URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={publicUrl ?? ""}
                  readOnly
                  className="flex-1 px-4 py-3 text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-sm"
                />
                <button
                  onClick={handleCopy}
                  className={`px-4 py-3 rounded-xl font-medium transition-all ${
                    isCopied
                      ? "bg-green-500 text-white"
                      : "bg-amber-500 hover:bg-amber-600 text-white"
                  }`}
                >
                  {isCopied ? "✓" : "Copy"}
                </button>
              </div>
            </div>

            <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                <span className="font-medium">DID:</span>{" "}
                <span className="font-mono text-xs break-all">
                  {publicationStatus.webvhDid}
                </span>
              </p>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Publishing makes this list publicly viewable. Anyone with the link
              can see the list contents and verify who added each item.
            </p>

            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
              <div className="flex items-start gap-3 text-amber-800 dark:text-amber-400">
                <svg
                  className="w-5 h-5 mt-0.5 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <div>
                  <p className="font-medium">Before you publish</p>
                  <ul className="mt-2 text-sm space-y-1 text-amber-700 dark:text-amber-500">
                    <li>• All items will be publicly visible</li>
                    <li>• Contributor names will be shown</li>
                    <li>• The list URL will be shareable</li>
                  </ul>
                </div>
              </div>
            </div>
          </>
        )}

        {error && (
          <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-700 dark:text-red-400 text-sm flex items-center gap-2">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        )}
      </div>
    </Panel>
  );
}
