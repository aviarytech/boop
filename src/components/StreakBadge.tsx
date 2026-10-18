/**
 * Streak badge component — displays current streak count.
 * 
 * Compact pill showing the streak in words (no emoji).
 * Only renders when streak >= 1.
 */

import { memo } from 'react';

interface StreakBadgeProps {
  streak: number;
  size?: 'sm' | 'md';
}

export const StreakBadge = memo(function StreakBadge({ streak, size = 'md' }: StreakBadgeProps) {
  if (streak < 1) return null;

  if (size === 'sm') {
    return (
      <span className="inline-flex items-center whitespace-nowrap px-2 py-0.5 rounded-full text-[12px] font-semibold text-[var(--boop-accent-ink)] border border-[var(--boop-line)] tabular-nums" title={`${streak}-day streak`}>
        {streak}-day streak
      </span>
    );
  }

  return (
    <span className="inline-flex items-center whitespace-nowrap px-3 py-1.5 rounded-full text-[14px] font-semibold text-[var(--boop-accent-ink)] border border-[var(--boop-line)] tabular-nums">
      {streak}-day streak
    </span>
  );
});
