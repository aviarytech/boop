/**
 * Empty state components — Boop design.
 */

import { type ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

/**
 * Generic empty state component.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div
      className="text-center py-14 px-6 rounded-3xl border-2 border-dashed border-stone-200 dark:border-stone-700"
      style={{ background: 'var(--boop-panel)' }}
    >
      <div className="relative inline-block mb-6">
        {icon || (
          <div
            className="rounded-full mx-auto flex items-center justify-center"
            style={{
              width: 88,
              height: 88,
              background: 'var(--boop-accent-soft)',
            }}
          >
            <div
              className="rounded-full"
              style={{
                width: 40,
                height: 40,
                background: 'var(--boop-accent)',
                animation: 'pulse-ring 2.4s ease-in-out infinite',
              }}
              aria-hidden="true"
            />
          </div>
        )}
      </div>

      <h3
        className="text-stone-900 dark:text-stone-50 mb-2"
        style={{
          fontFamily: 'Nunito, system-ui, sans-serif',
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: -0.6,
        }}
      >
        {title}
      </h3>
      <p className="text-stone-500 dark:text-stone-400 max-w-sm mx-auto mb-6 text-sm leading-relaxed">
        {description}
      </p>

      {action}
    </div>
  );
}

/**
 * Empty state for when user has no lists.
 */
export function NoListsEmptyState({ onCreateList }: { onCreateList: () => void }) {
  return (
    <EmptyState
      title="Nothing here yet."
      description="Make a list for the thing you keep meaning to do. One is enough to start."
      action={
        <button
          onClick={onCreateList}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-semibold text-white text-sm transition-transform active:scale-95"
          style={{
            background: 'var(--boop-accent)',
            boxShadow: '0 8px 20px rgba(107,60,255,0.35)',
          }}
        >
          Make your first list
        </button>
      }
    />
  );
}

/**
 * Empty state for when a list has no items.
 */
export function NoItemsEmptyState() {
  return (
    <div className="py-12 px-6 text-center">
      <div
        className="rounded-full mx-auto mb-4"
        style={{
          width: 44,
          height: 44,
          background: 'var(--boop-accent-soft)',
        }}
        aria-hidden="true"
      />
      <h3
        className="text-stone-700 dark:text-stone-200 mb-1"
        style={{
          fontFamily: 'Nunito, system-ui, sans-serif',
          fontWeight: 700,
          fontSize: 18,
          letterSpacing: -0.4,
        }}
      >
        This list is empty
      </h3>
      <p className="text-stone-500 dark:text-stone-400 text-sm">
        Add your first item below to get started.
      </p>
    </div>
  );
}

/**
 * Empty state for search with no results.
 */
export function NoSearchResultsEmptyState({ query }: { query: string }) {
  return (
    <EmptyState
      title="Nothing matches."
      description={`No lists matching "${query}". Try a different search term.`}
    />
  );
}
