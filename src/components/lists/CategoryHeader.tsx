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
              className="w-5 h-5 text-[var(--boop-muted)]"
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
            className={`text-[20px] font-bold tracking-tight ${
              isUncategorized ? "text-[var(--boop-muted)]" : "text-[var(--boop-ink)]"
            } group-hover:text-[var(--boop-accent)] transition-colors`}
          >
            {name}
          </h3>
          <span className="text-[13px] font-medium text-[var(--boop-muted)] border border-[var(--boop-line)] px-2 py-0.5 rounded-full tabular-nums">
            {listCount}
          </span>
        </div>
      </button>

      {isExpanded && (
        <div className="mt-3">
          {children}
        </div>
      )}
    </div>
  );
}
