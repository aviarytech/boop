/**
 * Streak tracking utilities.
 * 
 * Tracks consecutive days where the user completed at least one task.
 * Data is stored in localStorage keyed by user DID.
 */

const STREAK_KEY_PREFIX = 'boop:streak:';

export interface StreakData {
  /** Sorted array of date strings (YYYY-MM-DD) when tasks were completed */
  completionDates: string[];
  /** Timestamp of last celebration shown (to avoid repeat celebrations) */
  lastCelebrationMilestone: number;
}

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100] as const;

function getStorageKey(userDid: string): string {
  return `${STREAK_KEY_PREFIX}${userDid}`;
}

function getTodayDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function getStreakData(userDid: string): StreakData {
  try {
    const raw = localStorage.getItem(getStorageKey(userDid));
    if (raw) {
      return JSON.parse(raw) as StreakData;
    }
  } catch {
    // Ignore parse errors
  }
  return { completionDates: [], lastCelebrationMilestone: 0 };
}

function saveStreakData(userDid: string, data: StreakData): void {
  localStorage.setItem(getStorageKey(userDid), JSON.stringify(data));
}

/**
 * Record that a task was completed today.
 * Returns the new streak count and whether a milestone was just hit.
 */
export function recordCompletion(userDid: string): { streak: number; newMilestone: number | null } {
  const data = getStreakData(userDid);
  const today = getTodayDateString();

  if (!data.completionDates.includes(today)) {
    data.completionDates.push(today);
    // Keep only last 120 days to avoid unbounded growth
    if (data.completionDates.length > 120) {
      data.completionDates = data.completionDates.slice(-120);
    }
  }

  const streak = calculateStreak(data.completionDates);

  // Check if we hit a new milestone
  let newMilestone: number | null = null;
  for (const milestone of STREAK_MILESTONES) {
    if (streak >= milestone && data.lastCelebrationMilestone < milestone) {
      newMilestone = milestone;
    }
  }

  if (newMilestone !== null) {
    data.lastCelebrationMilestone = newMilestone;
  }

  saveStreakData(userDid, data);
  return { streak, newMilestone };
}

/**
 * Calculate current streak from an array of completion date strings.
 * A streak is consecutive days ending at today (or yesterday, to be forgiving).
 */
export function calculateStreak(completionDates: string[]): number {
  if (completionDates.length === 0) return 0;

  const sorted = [...completionDates].sort().reverse();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const formatDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const todayStr = formatDate(today);
  const yesterdayStr = formatDate(yesterday);

  // Streak must include today or yesterday
  if (sorted[0] !== todayStr && sorted[0] !== yesterdayStr) {
    return 0;
  }

  const dateSet = new Set(sorted);
  let streak = 0;
  const checkDate = new Date(today);

  // If today isn't in the set but yesterday is, start from yesterday
  if (!dateSet.has(todayStr) && dateSet.has(yesterdayStr)) {
    checkDate.setDate(checkDate.getDate() - 1);
  }

  while (dateSet.has(formatDate(checkDate))) {
    streak++;
    checkDate.setDate(checkDate.getDate() - 1);
  }

  return streak;
}

/**
 * Get the current streak count for a user.
 */
export function getCurrentStreak(userDid: string): number {
  const data = getStreakData(userDid);
  return calculateStreak(data.completionDates);
}

/**
 * Get the emoji for a streak count.
 */
export function getStreakEmoji(streak: number): string {
  if (streak >= 100) return '💎';
  if (streak >= 60) return '👑';
  if (streak >= 30) return '⭐';
  if (streak >= 14) return '🌟';
  if (streak >= 7) return '🔥';
  if (streak >= 3) return '✨';
  if (streak >= 1) return '💪';
  return '';
}

/**
 * Get celebration message for a milestone.
 */
export function getMilestoneMessage(milestone: number): string {
  switch (milestone) {
    case 3: return '3-day streak! You\'re on a roll! ✨';
    case 7: return '🔥 One week streak! Unstoppable!';
    case 14: return '🌟 Two weeks strong! Amazing dedication!';
    case 30: return '⭐ 30-day streak! You\'re a legend!';
    case 60: return '👑 60 days! Absolute champion!';
    case 100: return '💎 100-DAY STREAK! INCREDIBLE!';
    default: return `${milestone}-day streak! Keep going!`;
  }
}
