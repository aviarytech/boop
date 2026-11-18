/**
 * What a build declares it can handle, sent as `clientCapabilities` when it
 * signs in (/auth/verify) and when it restores a session
 * (`clientCapabilities.report`).
 *
 * Report-only (plans/002 D13, #286 P2b): the server records what it is told
 * so the owner can read adoption, and never refuses or changes a response
 * because of it. A build that sends nothing signs in exactly as before.
 *
 * `did-capability-relationships`: the build accepts an author DID whose
 * `#orig-1` is also referenced under `capabilityDelegation` and
 * `capabilityInvocation` (shared/authorDid.ts). Builds before it treat such a
 * DID as not an author DID, so no DID may gain those references until enough
 * of them are gone.
 */
export const DID_CAPABILITY_RELATIONSHIPS = "did-capability-relationships";

/** Everything this build supports. */
export const CLIENT_CAPABILITIES: readonly string[] = [DID_CAPABILITY_RELATIONSHIPS];

export const CLIENT_PLATFORMS = ["web", "ios", "android"] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number] | "unknown";

const CAPABILITY_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_CAPABILITIES = 16;

/**
 * The capability names in `declared` (a request field, unchecked): well-formed
 * names only, deduplicated and sorted. Anything else, including a missing
 * field, is no capabilities; it is never an error.
 */
export function declaredCapabilities(declared: unknown): string[] {
  if (!Array.isArray(declared)) return [];
  const names = declared.filter((name): name is string => typeof name === "string" && CAPABILITY_NAME.test(name));
  return [...new Set(names)].sort().slice(0, MAX_CAPABILITIES);
}

/** The platform a request names (Capacitor's), or "unknown". */
export function clientPlatform(platform: unknown): ClientPlatform {
  return CLIENT_PLATFORMS.find(known => known === platform) ?? "unknown";
}
