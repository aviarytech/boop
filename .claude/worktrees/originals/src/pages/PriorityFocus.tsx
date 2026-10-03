/**
 * Priority Focus page showing high-priority items across all lists.
 *
 * Displays a master list of all high-priority items from the user's lists,
 * grouped by source list with links to navigate to each list.
 */

import { useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { Link } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id, Doc } from "../../convex/_generated/dataModel";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { useSettings } from "../hooks/useSettings";
import { PriorityFocusSkeleton } from "../components/ui/Skeleton";
import { EmptyState } from "../components/ui/EmptyState";

type HighPriorityItem = {
  item: Doc<"items">;
  listName: string;
  listId: Id<"lists">;
};

/**
 * Single priority item row with checkbox and details.
 */
function PriorityItem({
  itemData,
  userDid,
  legacyDid,
}: {
  itemData: HighPriorityItem;
  userDid: string;
  legacyDid?: string;
}) {
  const { haptic } = useSettings();
  const checkItem = useMutation(api.items.checkItem);
  const { item, listName, listId } = itemData;

  const handleCheck = async () => {
    haptic("success");
    await checkItem({
      itemId: item._id,
      checkedByDid: userDid,
      legacyDid: legacyDid ?? undefined,
      checkedAt: Date.now(),
    });
  };

  // Format due date for display
  const dueDateStr = item.dueDate
    ? new Date(item.dueDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;

  const isOverdue = item.dueDate && item.dueDate < Date.now();

  return (
    <div className="group flex items-start gap-3 p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-amber-300 dark:hover:border-amber-700 transition-all">
      {/* Checkbox */}
      <button
        onClick={handleCheck}
        className="mt-0.5 w-5 h-5 rounded-md border-2 border-red-400 dark:border-red-500 hover:border-red-500 dark:hover:border-red-400 flex items-center justify-center transition-colors flex-shrink-0"
        aria-label="Mark as complete"
      >
        <span className="sr-only">Complete</span>
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-gray-900 dark:text-gray-100 font-medium truncate">
              {item.name}
            </p>
            {item.description && (
              <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">
                {item.description}
              </p>
            )}
          </div>

          {/* Priority badge */}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 flex-shrink-0">
            🔥 High
          </span>
        </div>

        {/* Meta info row */}
        <div className="flex items-center gap-3 mt-2 text-sm">
          {/* Source list link */}
          <Link
            to={`/list/${listId}`}
            className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            <span className="truncate max-w-32">{listName}</span>
          </Link>

          {/* Due date */}
          {dueDateStr && (
            <span
              className={`inline-flex items-center gap-1 ${
                isOverdue
                  ? "text-red-600 dark:text-red-400"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              {dueDateStr}
            </span>
          )}

          {/* URL indicator */}
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                />
              </svg>
              Link
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Empty state when there are no high-priority items.
 */
function NoPriorityItemsEmptyState() {
  return (
    <EmptyState
      title="No high-priority items"
      description="You don't have any high-priority items across your lists. When you mark items as high priority, they'll appear here for easy focus."
    />
  );
}

export function PriorityFocus() {
  const { did, legacyDid, isLoading: userLoading } = useCurrentUser();
  const { haptic } = useSettings();

  // Query high-priority items across all lists
  const highPriorityData = useQuery(
    api.items.getHighPriorityItems,
    did ? { userDid: did, legacyDid: legacyDid ?? undefined } : "skip"
  );

  // Group items by list for better organization
  const groupedItems = useMemo(() => {
    if (!highPriorityData) return null;

    const groups = new Map<
      string,
      { listName: string; listId: Id<"lists">; items: HighPriorityItem[] }
    >();

    for (const data of highPriorityData) {
      if (!data.item) continue;
      
      const key = data.listId.toString();
      if (!groups.has(key)) {
        groups.set(key, {
          listName: data.listName,
          listId: data.listId,
          items: [],
        });
      }
      groups.get(key)!.items.push(data as HighPriorityItem);
    }

    return Array.from(groups.values());
  }, [highPriorityData]);

  if (!did && !userLoading) {
    return null; // Login page will show instead
  }

  const isLoading = highPriorityData === undefined;
  const hasItems = groupedItems && groupedItems.length > 0;
  const totalItems = groupedItems?.reduce((sum, group) => sum + group.items.length, 0) ?? 0;

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <Link
              to="/d"
              onClick={() => haptic("light")}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
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
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              🎯 Priority Focus
            </h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {isLoading
              ? "Loading..."
              : hasItems
              ? `${totalItems} high-priority item${totalItems === 1 ? "" : "s"} across your lists`
              : "Your high-priority items from all lists"}
          </p>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && <PriorityFocusSkeleton />}

      {/* Empty state */}
      {!isLoading && !hasItems && (
        <div className="animate-slide-up">
          <NoPriorityItemsEmptyState />
        </div>
      )}

      {/* Items grouped by list */}
      {!isLoading && hasItems && did && (
        <div className="space-y-6 animate-slide-up">
          {groupedItems!.map((group) => (
            <section key={group.listId}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <span>📋</span>
                  <Link
                    to={`/list/${group.listId}`}
                    className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                  >
                    {group.listName}
                  </Link>
                  <span className="text-gray-400 dark:text-gray-500 font-normal">
                    ({group.items.length})
                  </span>
                </h3>
              </div>
              <div className="space-y-2">
                {group.items.map((itemData) => (
                  <PriorityItem
                    key={itemData.item._id}
                    itemData={itemData}
                    userDid={did}
                    legacyDid={legacyDid ?? undefined}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
