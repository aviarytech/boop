/**
 * What a client declares it supports when it signs in (`clientCapabilities`
 * in the /auth/verify body). The server refuses a sign-in that lacks one it
 * requires with 426, so builds that can't handle the account are turned away
 * rather than misreading it.
 *
 * `agent-keys`: the client accepts an author DID that lists LWS agent methods
 * in `authentication` (docs/lws-agent-auth.md). Builds before it treat such a
 * DID as not an author DID.
 */
export const AGENT_KEYS_CAPABILITY = "agent-keys";

/** Everything this build supports, sent with every sign-in. */
export const CLIENT_CAPABILITIES: readonly string[] = [AGENT_KEYS_CAPABILITY];

/** Capabilities the server requires at sign-in. */
export const REQUIRED_CLIENT_CAPABILITIES: readonly string[] = [AGENT_KEYS_CAPABILITY];

/** True when `declared` (the request body's field, unchecked) covers every required capability. */
export function hasRequiredCapabilities(declared: unknown): boolean {
  return Array.isArray(declared) && REQUIRED_CLIENT_CAPABILITIES.every(capability => declared.includes(capability));
}

export const UPGRADE_REQUIRED_MESSAGE = "This version of boop can no longer sign in. Please update or reload the app.";
