/**
 * Streak milestone celebration overlay.
 * 
 * Shows a brief animated celebration when the user hits a streak milestone.
 * Auto-dismisses after a few seconds.
 */

import { useEffect, useState } from 'react';
import { getMilestoneMessage, getStreakEmoji } from '../lib/streaks';

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

  const emoji = getStreakEmoji(milestone);
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
        className={`relative bg-white dark:bg-stone-800 rounded-3xl shadow-2xl shadow-orange-500/20 px-8 py-6 mx-6 text-center border border-orange-200/60 dark:border-orange-800/40 transition-all duration-500 ${
          isVisible ? 'scale-100 translate-y-0' : 'scale-75 translate-y-8'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          setIsVisible(false);
          setTimeout(onDismiss, 300);
        }}
        style={{ pointerEvents: 'auto' }}
      >
        {/* Confetti-like decorative elements */}
        <div className="absolute -top-3 -left-3 text-2xl animate-bounce" style={{ animationDelay: '0ms' }}>🎉</div>
        <div className="absolute -top-3 -right-3 text-2xl animate-bounce" style={{ animationDelay: '150ms' }}>🎊</div>
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-xl animate-bounce" style={{ animationDelay: '300ms' }}>🏆</div>

        {/* Main emoji */}
        <div className="text-5xl mb-3 animate-pulse">
          {emoji}
        </div>

        {/* Message */}
        <p className="text-lg font-bold text-stone-900 dark:text-stone-50 mb-1">
          {message}
        </p>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Tap to dismiss
        </p>
      </div>
    </div>
  );
}
