/**
 * Streak milestone celebration overlay.
 * 
 * Shows a brief animated celebration when the user hits a streak milestone.
 * Auto-dismisses after a few seconds.
 */

import { useEffect, useState } from 'react';
import { getMilestoneMessage } from '../lib/streaks';
import { Icon } from './ui/Icon';

interface StreakCelebrationProps {
  milestone: number;
  onDismiss: () => void;
}

export function StreakCelebration({ milestone, onDismiss }: StreakCelebrationProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Animate in
    requestAnimationFrame(() => setIsVisible(true));

    // Auto-dismiss after 3 seconds
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onDismiss, 300);
    }, 3000);

    return () => clearTimeout(timer);
  }, [onDismiss]);

  const message = getMilestoneMessage(milestone);

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center pointer-events-none transition-all duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {/* Backdrop glow */}
      <div className={`absolute inset-0 bg-amber-500/10 dark:bg-amber-500/20 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`} />

      {/* Celebration card */}
      <div
        className={`relative bg-[var(--boop-card)] rounded-3xl shadow-2xl px-8 py-6 mx-6 text-center border border-[var(--boop-line)] transition-all duration-500 ${
          isVisible ? 'scale-100 translate-y-0' : 'scale-75 translate-y-8'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          setIsVisible(false);
          setTimeout(onDismiss, 300);
        }}
        style={{ pointerEvents: 'auto' }}
      >

        {/* Seal */}
        <div className="mx-auto mb-3 flex items-center justify-center w-14 h-14 rounded-full border-[3px] border-[var(--boop-accent)] text-[var(--boop-accent)]">
          <Icon name="flame" className="w-7 h-7" />
        </div>

        {/* Message */}
        <p className="text-lg font-bold text-[var(--boop-ink)] mb-1">
          {message}
        </p>
        <p className="text-sm text-[var(--boop-muted)]">
          Tap to dismiss
        </p>
      </div>
    </div>
  );
}
