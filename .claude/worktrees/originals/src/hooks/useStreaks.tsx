/**
 * Hook for streak tracking state.
 * 
 * Provides current streak count and a function to record completions
 * with milestone celebration support.
 */

import { useState, useCallback, useEffect } from 'react';
import { getCurrentStreak, recordCompletion } from '../lib/streaks';

interface UseStreaksResult {
  /** Current streak count (consecutive days) */
  streak: number;
  /** Record a task completion; returns milestone number if one was just hit */
  recordTaskCompletion: () => number | null;
  /** Refresh streak from storage */
  refreshStreak: () => void;
}

export function useStreaks(userDid: string | undefined): UseStreaksResult {
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    if (userDid) {
      setStreak(getCurrentStreak(userDid));
    }
  }, [userDid]);

  const refreshStreak = useCallback(() => {
    if (userDid) {
      setStreak(getCurrentStreak(userDid));
    }
  }, [userDid]);

  const recordTaskCompletion = useCallback((): number | null => {
    if (!userDid) return null;
    const result = recordCompletion(userDid);
    setStreak(result.streak);
    return result.newMilestone;
  }, [userDid]);

  return { streak, recordTaskCompletion, refreshStreak };
}
