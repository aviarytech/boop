/**
 * Collapsible section header for a category.
 *
 * Shows category name, list count, and expand/collapse toggle.
 */

import { useState, type ReactNode } from "react";

interface CategoryHeaderProps {
  name: string;
  listCount: number;
  children: ReactNode;
  defaultExpanded?: boolean;
}

export function CategoryHeader({
  name,
  listCount,
  children,
  defaultExpanded = true,
}: CategoryHeaderProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const isUncategorized = name.toLowerCase() === "uncategorized";

  return (
    <div className="mb-8">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between py-3 text-left group"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-3">
          <span
            className={`transform transition-transform duration-300 ${
              isExpanded ? "rotate-90" : ""
            }`}
          >
            <svg
              className="w-5 h-5 text-amber-600 dark:text-amber-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </span>
          <h3
            className={`text-xl font-bold tracking-tight ${
              isUncategorized
                ? "text-gray-500 dark:text-gray-400 group-hover:text-amber-600 dark:group-hover:text-amber-400"
                : "text-gray-800 dark:text-gray-100 group-hover:text-amber-700 dark:group-hover:text-amber-300"
            } transition-colors`}
          >
            {name}
          </h3>
          <span className="text-sm font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-full">
            {listCount}
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="mt-5 space-y-4">
          {children}
        </div>
      )}
    </div>
  );
}
