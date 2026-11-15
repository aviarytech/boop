/**
 * Feature flags. boop has no flag service: a flag is a build-time env var that
 * is off unless it is set to "true".
 */

/**
 * Settings → "Agent enrollment code" (docs/agent-enrollment-codes.md). The
 * server has its own switch, the Convex env var AGENT_ENROLLMENT_CODES.
 */
export const AGENT_ENROLLMENT_CODES_ENABLED = import.meta.env.VITE_AGENT_ENROLLMENT_CODES === "true";
