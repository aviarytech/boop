/**
 * Shared list resource view — view and interact with a shared list.
 * Accessed via /{userPath}/resources/list-{listId}
 *
 * - Anyone can view the list
 * - Logged-in boop users can save to favourites
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useCurrentUser } from "../hooks/useCurrentUser";
import type { Id } from "../../convex/_generated/dataModel";

interface ListItem {
  _id: string;
  name: string;
  checked: boolean;
  createdAt: number;
  checkedAt?: number;
  description?: string;
  priority?: string;
  dueDate?: number;
}

interface ListResource {
  "@context": string[];
  id: string;
  type: string;
  controller: string;
  name: string;
  items: ListItem[];
  createdAt: number;
  itemCount: number;
  checkedCount: number;
  credential?: {
    type: string[];
    issuer: string;
    issuanceDate: string;
    proof?: {
      type: string;
      cryptosuite: string;
      created: string;
      verificationMethod: string;
      proofValue: string;
    };
  };
}

function getResourceUrl(userPath: string, listId: string): string {
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string;
  if (convexUrl?.includes("127.0.0.1") || convexUrl?.includes("localhost")) {
    const siteUrl = convexUrl.replace(":3210", ":3211");
    return `${siteUrl}/d/${userPath}/resources/list-${listId}`;
  }
  // Use relative URL — server.ts will proxy, or direct to Convex site
  const siteUrl = convexUrl?.replace(".convex.cloud", ".convex.site") ?? "";
  return `${siteUrl}/d/${userPath}/resources/list-${listId}`;
}

export function SharedListResource() {
  const { userPath, resourceId } = useParams<{ userPath: string; resourceId: string }>();
  // Resource ID is "list-{convexListId}" — strip the prefix
  const listId = resourceId?.startsWith("list-") ? resourceId.slice(5) : resourceId;
  const [resource, setResource] = useState<ListResource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auth for favouriting
  const { did } = useCurrentUser();
  const bookmarkMutation = useMutation(api.publication.bookmarkList);
  const unbookmarkMutation = useMutation(api.publication.unbookmarkList);

  // We need the Convex list ID for bookmarking — extract from resource URL
  // The listId param is the Convex ID
  const convexListId = listId as Id<"lists"> | undefined;

  const isBookmarked = useQuery(
    api.publication.isBookmarked,
    did && convexListId ? { listId: convexListId, userDid: did } : "skip"
  );

  const [favouritePending, setFavouritePending] = useState(false);
  const [bookmarkPlanLimit, setBookmarkPlanLimit] = useState(false);
  const navigate = useNavigate();

  const fetchResource = useCallback(async () => {
    if (!userPath || !listId) return;
    try {
      const url = getResourceUrl(userPath, listId);
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status === 404 ? "List not found" : "Failed to load list");
      const data = await res.json();
      setResource(data);
      setError(null);
    } catch (err: any) {
      if (!resource) setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [userPath, listId]);

  useEffect(() => {
    fetchResource();
    pollRef.current = setInterval(fetchResource, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchResource]);

  const handleToggleFavourite = async () => {
    if (!did || !convexListId || favouritePending) return;
    setFavouritePending(true);
    try {
      if (isBookmarked) {
        await unbookmarkMutation({ listId: convexListId, userDid: did });
        setBookmarkPlanLimit(false);
      } else {
        await bookmarkMutation({ listId: convexListId, userDid: did });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("PLAN_LIMIT")) {
        setBookmarkPlanLimit(true);
      } else {
        console.error("Failed to toggle favourite:", err);
      }
    } finally {
      setFavouritePending(false);
    }
  };

  const handleToggleItem = async (itemId: string, currentChecked: boolean) => {
    if (!userPath || !listId || !resource) return;

    // Optimistic update
    setResource((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((item) =>
        item._id === itemId ? { ...item, checked: !currentChecked } : item
      );
      const checkedCount = items.filter((i) => i.checked).length;
      return { ...prev, items, checkedCount };
    });

    try {
      const convexUrl = import.meta.env.VITE_CONVEX_URL as string;
      const siteUrl = convexUrl?.includes("127.0.0.1") || convexUrl?.includes("localhost")
        ? convexUrl.replace(":3210", ":3211")
        : convexUrl?.replace(".convex.cloud", ".convex.site") ?? "";

      const action = currentChecked ? "uncheck" : "check";
      const resp = await fetch(`${siteUrl}/d/${userPath}/resources/list-${listId}/items/${itemId}/${action}`, {
        method: "POST",
      });

      if (!resp.ok) {
        throw new Error(`Failed to toggle item (${resp.status})`);
      }
    } catch (err) {
      console.error("Failed to toggle shared item:", err);
      // Rollback by refetching
      await fetchResource();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !resource) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-center p-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2" style={{ fontFamily: 'Nunito, system-ui, sans-serif', letterSpacing: -0.5 }}>
            {error === "List not found" ? "List not found" : "Something went wrong"}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-4">{error}</p>
          <Link to="/" className="text-amber-600 hover:text-amber-500 font-medium">
            Go to boop →
          </Link>
        </div>
      </div>
    );
  }

  const progress = resource.itemCount > 0
    ? Math.round((resource.checkedCount / resource.itemCount) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <span className="boop-dot" aria-hidden="true" style={{ width: 10, height: 10 }} />
              <span style={{ fontFamily: 'Geist Mono, ui-monospace, monospace', fontSize: 12 }}>shared list</span>
            </div>
            {/* Favourite button — only for logged-in users */}
            {did && convexListId && (
              <button
                onClick={handleToggleFavourite}
                disabled={favouritePending}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all active:scale-95 ${
                  isBookmarked
                    ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 hover:text-amber-600 dark:hover:text-amber-400 hover:border-amber-200 dark:hover:border-amber-800"
                } ${favouritePending ? "opacity-50" : ""}`}
              >
                <span>{isBookmarked ? "⭐" : "☆"}</span>
                <span>{isBookmarked ? "Saved" : "Save"}</span>
              </button>
            )}
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {resource.name}
          </h1>
          <div className="mt-2 flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
            <span>{resource.itemCount} items</span>
            <span>·</span>
            <span>{resource.checkedCount} done</span>
            {progress > 0 && (
              <>
                <span>·</span>
                <span>{progress}%</span>
              </>
            )}
          </div>
          {resource.itemCount > 0 && (
            <div className="mt-3 h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>

        {/* Plan limit hit when saving to favourites */}
        {bookmarkPlanLimit && (
          <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-sm space-y-2">
            <div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
              <span>🚀</span>
              <span>This list has reached its collaborator limit</span>
            </div>
            <p className="text-amber-700 dark:text-amber-400">The list owner needs to upgrade to Pro to add more collaborators.</p>
            <button
              onClick={() => navigate("/pricing")}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-lg font-semibold text-sm transition-colors"
            >
              View pricing →
            </button>
          </div>
        )}

        {/* Not logged in — nudge to sign up */}
        {!did && (
          <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl text-sm text-amber-700 dark:text-amber-400 flex items-center gap-2">
            <span>⭐</span>
            <span>
              <Link to="/login" className="font-medium underline">Sign in</Link>
              {" "}to save this list to your favourites
            </span>
          </div>
        )}

        {/* Logged-in shortcut to full app list view */}
        {did && convexListId && (
          <div className="mb-4 flex gap-2">
            <Link
              to={`/list/${convexListId}`}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white transition-colors"
            >
              <span>↗</span>
              <span>Open full list view</span>
            </Link>
          </div>
        )}

        {/* Items */}
        <div className="space-y-1">
          {resource.items.map((item) => (
            <button
              key={item._id}
              onClick={() => handleToggleItem(item._id, item.checked)}
              className={`w-full text-left flex items-start gap-3 px-4 py-3 rounded-xl transition-colors ${
                item.checked
                  ? "bg-gray-100 dark:bg-gray-900/50"
                  : "bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50"
              }`}
            >
              <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                item.checked
                  ? "border-green-500 bg-green-500"
                  : "border-gray-300 dark:border-gray-600"
              }`}>
                {item.checked && (
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${
                  item.checked
                    ? "text-gray-400 dark:text-gray-500 line-through"
                    : "text-gray-900 dark:text-gray-100"
                }`}>
                  {item.name}
                </p>
                {item.description && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                    {item.description}
                  </p>
                )}
                {item.priority && (
                  <span className={`inline-block text-xs px-1.5 py-0.5 rounded mt-1 ${
                    item.priority === "high"
                      ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                      : item.priority === "medium"
                      ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400"
                      : "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                  }`}>
                    {item.priority}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Provenance */}
        {resource.credential?.proof && (
          <div className="mt-6 p-4 bg-green-50 dark:bg-green-900/20 rounded-xl">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400 mb-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="text-sm font-medium">Cryptographically signed</span>
            </div>
            <div className="space-y-1 text-xs text-green-600 dark:text-green-500">
              <p><span className="font-medium">Signed by:</span> <span className="font-mono break-all">{resource.credential.issuer}</span></p>
              <p><span className="font-medium">Date:</span> {new Date(resource.credential.proof.created).toLocaleString()}</p>
              <p><span className="font-medium">Cryptosuite:</span> {resource.credential.proof.cryptosuite}</p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-800">
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
            Shared via{" "}
            <a href="/" className="text-amber-600 hover:text-amber-500">
              boop
            </a>
            {" "}· Verified with{" "}
            <span className="font-mono">did:webvh</span>
          </p>
          <p className="text-xs text-gray-300 dark:text-gray-600 text-center mt-1 font-mono break-all">
            {resource.id}
          </p>
        </div>
      </div>
    </div>
  );
}
