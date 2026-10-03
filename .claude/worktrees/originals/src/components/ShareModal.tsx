/**
 * Share modal - now triggers did:webvh publication for sharing.
 * Publishing = sharing. Once published, anyone with the link can edit.
 */

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useSettings } from "../hooks/useSettings";
import { buildListResourceDid, buildListResourceUrl } from "../lib/webvh";
import { shareList, canShare } from "../lib/share";
import { Panel } from "./ui/Panel";
import { ListProvenanceInfo } from "./ProvenanceInfo";
import { trackListShared, trackInviteSent } from "../lib/analytics";

interface ShareModalProps {
  list: Doc<"lists">;
  onClose: () => void;
}

export function ShareModal({ list, onClose }: ShareModalProps) {
  const { did, subOrgId } = useCurrentUser();
  const { haptic } = useSettings();
  // List DID creation happens client-side (no server-side Turnkey needed)
  const publishListMutation = useMutation(api.publication.publishList);
  const unpublishListMutation = useMutation(api.publication.unpublishList);
  const publicationStatus = useQuery(api.publication.getPublicationStatus, {
    listId: list._id,
  });

  const [isPublishing, setIsPublishing] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nativeShareAvailable, setNativeShareAvailable] = useState(false);
  const [showDid, setShowDid] = useState(false);

  useEffect(() => {
    canShare().then(setNativeShareAvailable);
  }, []);

  const isPublished = publicationStatus?.status === "active";
  const publicUrl = isPublished && did
    ? buildListResourceUrl(did, list._id)
    : null;
  const resourceDid = isPublished && did
    ? buildListResourceDid(did, list._id)
    : null;

  const handlePublish = async () => {
    if (!did || !subOrgId) {
      setError("You must be logged in to share a list");
      return;
    }

    setIsPublishing(true);
    setError(null);
    haptic('medium');

    try {
      // The list is a resource under the user's DID — no separate DID needed.
      // The resource DID URI is: {userDid}/resources/list-{listId}
      const listResourceDid = buildListResourceDid(did, list._id);

      await publishListMutation({
        listId: list._id,
        webvhDid: listResourceDid,
        publisherDid: did,
      });

      trackListShared('webvh');
      haptic('success');
    } catch (err) {
      console.error("[ShareModal] Failed to publish:", err);
      setError(err instanceof Error ? err.message : "Failed to share list");
      haptic('error');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!did) return;
    setError(null);
    try {
      await unpublishListMutation({ listId: list._id, userDid: did });
      haptic('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unpublish");
      haptic('error');
    }
  };

  const handleCopy = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      trackInviteSent('copy');
      haptic('success');
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
      haptic('error');
    }
  };

  const handleNativeShare = async () => {
    if (!publicUrl) return;
    try {
      await shareList(list.name, publicUrl);
      trackInviteSent('native_share');
      haptic('success');
    } catch (err) {
      // User cancelled or share failed — not an error worth surfacing
      console.error("Native share cancelled or failed:", err);
    }
  };

  const header = (
    <>
      <div>
        <h2 id="share-dialog-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {isPublished ? "🌐 Shared List" : "🔗 Share List"}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
          {list.name}
        </p>
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

  const footer = (
    <div className="px-5 py-4 flex gap-3">
      {isPublished && (
        <button
          onClick={handleUnpublish}
          className="px-4 py-3 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl font-medium hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
        >
          Stop sharing
        </button>
      )}
      <button
        onClick={onClose}
        className="flex-1 px-4 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold transition-colors"
      >
        Done
      </button>
    </div>
  );

  return (
    <Panel
      isOpen={true}
      onClose={onClose}
      header={header}
      footer={footer}
      ariaLabelledBy="share-dialog-title"
    >
      <div className="p-5 space-y-5">
        {isPublished ? (
          <>
            <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-xl">
              <div className="flex items-center gap-2 text-green-800 dark:text-green-400">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="font-medium">This list is shared</span>
              </div>
              <p className="mt-1 text-sm text-green-700 dark:text-green-500">
                Anyone with the link can view and edit this list.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Share link
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
                      : "bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {isCopied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            {nativeShareAvailable && (
              <button
                onClick={handleNativeShare}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-semibold shadow-lg shadow-amber-500/25 transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Send to a friend
              </button>
            )}

            <button
              onClick={() => setShowDid(v => !v)}
              className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <svg className={`w-3 h-3 transition-transform ${showDid ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Technical details
            </button>

            {showDid && (
              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-xl">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  <span className="font-medium">DID:</span>{" "}
                  <span className="font-mono text-xs break-all">
                    {resourceDid}
                  </span>
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Share this list by publishing it with a verifiable <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">did:webvh</code> identity. 
              Anyone with the link can view and edit the list.
            </p>

            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
              <div className="flex items-start gap-3 text-amber-800 dark:text-amber-400">
                <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="font-medium">What happens when you share</p>
                  <ul className="mt-2 text-sm space-y-1 text-amber-700 dark:text-amber-500">
                    <li>• A verifiable DID is created for the list</li>
                    <li>• Anyone with the link can view &amp; edit items</li>
                    <li>• You can stop sharing at any time</li>
                  </ul>
                </div>
              </div>
            </div>

            <button
              onClick={handlePublish}
              disabled={isPublishing}
              className="w-full px-4 py-3 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-semibold shadow-lg shadow-amber-500/25 disabled:opacity-50 transition-all"
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
                "Publish to Share"
              )}
            </button>
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

        <ListProvenanceInfo list={list} />
      </div>
    </Panel>
  );
}
