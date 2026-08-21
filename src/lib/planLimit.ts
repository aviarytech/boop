/**
 * The free-plan list cap, as it reaches the UI.
 *
 * assertListQuota (convex/lists.ts) throws a message prefixed PLAN_LIMIT when a
 * free-plan user is at their list cap. Every path that creates a list has to
 * recognise it: it is a gate the user can act on, not a failure, and "please try
 * again" is advice that can never work.
 */

const PLAN_LIMIT_PREFIX = "PLAN_LIMIT";

/** The message shown when someone is out of lists. */
export const PLAN_LIMIT_MESSAGE =
  "You've reached the free plan limit of 5 lists. Invite a friend or upgrade for unlimited lists.";

export function isPlanLimitError(err: unknown): boolean {
  // Convex wraps mutation errors, so the marker can sit anywhere in the string.
  return err instanceof Error && err.message.includes(PLAN_LIMIT_PREFIX);
}

/**
 * What to show the user for a failed list creation: the actionable cap message,
 * or a generic fallback for anything genuinely unexpected.
 */
export function listCreationErrorMessage(
  err: unknown,
  fallback = "Failed to create list. Please try again."
): string {
  return isPlanLimitError(err) ? PLAN_LIMIT_MESSAGE : fallback;
}
