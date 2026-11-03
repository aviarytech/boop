/**
 * Public list view page.
 *
 * Phase 4: Displays a published list that anyone can view without authentication.
 * Shows current items with recorded attribution and unverified identifier details.
 */

import { useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "../lib/authenticatedConvex";
import { api } from "../../convex/_generated/api";
import { VerificationBadge } from "../components/publish/VerificationBadge";
import { formatRelativeTime } from "../lib/time";

export function PublicList() {
  useEffect(() => {
    document.body.classList.add('scrollable-page');
    return () => document.body.classList.remove('scrollable-page');
  }, []);

  const { did } = useParams<{ did: string }>();

  // Construct full DID from URL parameter
  const webvhDid = did ? `did:webvh:${decodeURIComponent(did)}` : null;

  const publicList = useQuery(
    api.publication.getPublicList,
    webvhDid ? { webvhDid } : "skip"
  );

  // Loading state
  if (publicList === undefined) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-gray-950">
        <div className="container mx-auto p-4">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4"></div>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-gray-200 dark:bg-gray-700 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Not found or unpublished
  if (!publicList) {
    return (
      <div className="min-h-screen bg-stone-50 dark:bg-gray-950">
        <div className="container mx-auto p-4">
          <div className="text-center py-12">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
              List not found
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              This list may have been unpublished or doesn't exist.
            </p>
            <Link to="/" className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300">
              Go to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { list, items, publication } = publicList;

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-gray-950">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm">
        <div className="container mx-auto p-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="boop-wordmark text-[20px] hover:opacity-80 transition-opacity" aria-label="boop">
              <span className="boop-dot" aria-hidden="true" />
              <span>boop</span>
            </Link>
            <span className="text-sm text-gray-500 dark:text-gray-400">Public List</span>
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4">
        {/* List Header */}
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                {list.name}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Created by {list.ownerName}
              </p>
            </div>
            <VerificationBadge
              did={publication.webvhDid}
              didDocument={publication.didDocument}
            />
          </div>
        </div>

        <section aria-label="Publication evidence" className="mb-6 p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
          <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100">Live list · not a sealed snapshot</h2>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            This page shows the current list, which can change after publication.
            It does not verify a sealed snapshot or who added each item.
            Contributor names are recorded attribution.
          </p>
        </section>

        {/* Items */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow divide-y divide-gray-100 dark:divide-gray-700">
          {items.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              This list is empty.
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item._id}
                className="p-4 flex items-start gap-3"
              >
                {/* Checkbox (read-only) */}
                <div className="flex-shrink-0 pt-0.5">
                  {item.checked ? (
                    <svg
                      className="w-5 h-5 text-green-600 dark:text-green-400"
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
                  ) : (
                    <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 rounded" />
                  )}
                </div>

                {/* Item content */}
                <div className="flex-1 min-w-0">
                  <p
                    className={item.checked
                      ? "line-through text-gray-500 dark:text-gray-400"
                      : "text-gray-900 dark:text-gray-100"
                    }
                  >
                    {item.name}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Added by {item.createdByName}{" "}
                    {formatRelativeTime(item.createdAt)}
                    {item.checked && item.checkedAt && (
                      <> &middot; Completed {formatRelativeTime(item.checkedAt)}</>
                    )}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer info */}
        <div className="mt-6 p-4 bg-gray-100 dark:bg-gray-700 rounded-lg">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            About this list
          </h3>
          <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
            <p>
              <span className="font-medium">Published:</span>{" "}
              {new Date(publication.publishedAt).toLocaleDateString()}
            </p>
            <p>
              <span className="font-medium">Items:</span> {items.length}
            </p>
            <p className="break-all">
              <span className="font-medium">DID:</span>{" "}
              <span className="font-mono text-xs">{publication.webvhDid}</span>
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-6 text-center">
          <p className="text-gray-600 dark:text-gray-300 mb-3">
            To edit this list, ask its owner for an editor invitation and accept it after signing in.
          </p>
          <Link
            to="/login"
            className="inline-block px-6 py-2 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600"
          >
            Sign up for boop
          </Link>
        </div>
      </main>
    </div>
  );
}
