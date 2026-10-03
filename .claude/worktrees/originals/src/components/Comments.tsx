/**
 * Comments component - Thread discussions on items for shared lists.
 * Displays comment thread and allows adding/deleting comments.
 */

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useSettings } from "../hooks/useSettings";

interface CommentsProps {
  itemId: Id<"items">;
  userDid: string;
  legacyDid?: string;
  canEdit: boolean;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

function truncateDid(did: string): string {
  if (did.length <= 20) return did;
  return `${did.slice(0, 12)}...${did.slice(-6)}`;
}

export function Comments({ itemId, userDid, legacyDid, canEdit }: CommentsProps) {
  const { haptic } = useSettings();
  const [newComment, setNewComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<Id<"comments"> | null>(null);

  const comments = useQuery(api.comments.getItemComments, {
    itemId,
    userDid,
    legacyDid,
  });

  const addComment = useMutation(api.comments.addComment);
  const deleteComment = useMutation(api.comments.deleteComment);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || isSubmitting) return;

    haptic("light");
    setIsSubmitting(true);

    try {
      await addComment({
        itemId,
        userDid,
        legacyDid,
        text: newComment.trim(),
      });
      setNewComment("");
      haptic("success");
    } catch (err) {
      console.error("Failed to add comment:", err);
      haptic("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (commentId: Id<"comments">) => {
    if (deletingId) return;

    haptic("medium");
    setDeletingId(commentId);

    try {
      await deleteComment({
        commentId,
        userDid,
        legacyDid,
      });
      haptic("success");
    } catch (err) {
      console.error("Failed to delete comment:", err);
      haptic("error");
    } finally {
      setDeletingId(null);
    }
  };

  const canDeleteComment = (commentUserDid: string) => {
    // Author can always delete their own comments
    if (commentUserDid === userDid || commentUserDid === legacyDid) {
      return true;
    }
    // Editors and owners can delete any comment
    return canEdit;
  };

  if (comments === undefined) {
    return (
      <div className="animate-pulse space-y-2">
        <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Comment thread */}
      {comments.length > 0 ? (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {comments.map((comment) => (
            <div
              key={comment._id}
              className="group bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-1">
                    <span
                      className="font-medium truncate"
                      title={comment.userDid}
                    >
                      {truncateDid(comment.userDid)}
                    </span>
                    <span>•</span>
                    <span>{formatRelativeTime(comment.createdAt)}</span>
                  </div>
                  <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
                    {comment.text}
                  </p>
                </div>
                {canDeleteComment(comment.userDid) && (
                  <button
                    onClick={() => handleDelete(comment._id)}
                    disabled={deletingId === comment._id}
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-all disabled:opacity-50"
                    aria-label="Delete comment"
                  >
                    {deletingId === comment._id ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">
          No comments yet
        </p>
      )}

      {/* Add comment form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add a comment..."
          className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <button
          type="submit"
          disabled={!newComment.trim() || isSubmitting}
          className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          )}
        </button>
      </form>
    </div>
  );
}
