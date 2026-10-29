import { Capacitor } from '@capacitor/core';

/**
 * Before #286 the account's did:webvh was minted with an Ed25519 key kept in
 * localStorage under this prefix, in every role. Author DIDs replace those
 * (src/lib/authorIdentity.ts); the old key is deleted once the account moves.
 */
const LEGACY_KEY_STORAGE_PREFIX = "lisa-webvh-ed25519";
const LEGACY_DID_LOG_STORAGE_KEY = "lisa-webvh-did-log";

export function forgetLegacyDidKey(subOrgId: string): void {
  try {
    localStorage.removeItem(`${LEGACY_KEY_STORAGE_PREFIX}:${subOrgId}`);
    localStorage.removeItem(`${LEGACY_DID_LOG_STORAGE_KEY}:${subOrgId}`);
  } catch { /* storage unavailable */ }
}

/** The path this account's did.jsonl is served at. convex/lib/didLogAuth.ts must agree. */
export function userDidPath(subOrgId: string): string {
  return `user-${subOrgId.slice(0, 16)}`;
}

/**
 * Extract the path slug from a did:webvh DID.
 * e.g. "did:webvh:{scid}:boop.ad:user-abc123" → "user-abc123"
 */
export function pathFromDid(did: string): string {
  const parts = did.split(":");
  // did:webvh:{scid}:{domain}:{path...}
  if (parts.length < 5 || parts[1] !== "webvh") {
    throw new Error(`Cannot extract path from DID: ${did}`);
  }
  return parts.slice(4).join(":");
}

/**
 * The domain a DID minted right now would carry.
 *
 * The native check comes FIRST on purpose. VITE_WEBVH_DOMAIN is baked in at
 * build time, so a locally-built app (`bun run cap:build` reads .env.local)
 * used to stamp a dev host like `localhost:5173` into real native DIDs,
 * overriding the boop.ad branch. The env override is dev-only now.
 */
export function currentWebvhDomain(): string {
  if (Capacitor.isNativePlatform()) return "boop.ad";
  return (import.meta.env.VITE_WEBVH_DOMAIN as string | undefined) || window.location.host;
}

/** The domain encoded in a did:webvh, percent-decoded (`localhost%3A5173` → `localhost:5173`). */
export function domainFromDidSafe(did: string): string | null {
  const parts = did.split(":");
  if (parts.length < 5 || parts[1] !== "webvh") return null;
  try {
    return decodeURIComponent(parts[3]);
  } catch {
    return parts[3];
  }
}

/** True when this DID names a domain we no longer mint on — its did.jsonl is unreachable. */
export function isStaleDidDomain(did: string): boolean {
  const domain = domainFromDidSafe(did);
  return domain !== null && domain !== currentWebvhDomain();
}

/**
 * Extract the domain from a did:webvh string.
 * e.g. "did:webvh:{scid}:boop.ad:user-abc123" → "boop.ad"
 */
export function domainFromDid(did: string): string {
  const parts = did.split(":");
  if (parts.length < 4 || parts[1] !== "webvh") {
    throw new Error(`Cannot extract domain from DID: ${did}`);
  }
  // A host with a port is stored percent-encoded (`localhost%3A5173`), because
  // `:` is the DID's own separator. Decode it or the URL has an invalid host.
  return decodeURIComponent(parts[3]);
}

/**
 * Build the DID URI for a list resource under the user's DID.
 * e.g. "did:webvh:{scid}:boop.ad:user-abc123/resources/list-{listId}"
 */
export function buildListResourceDid(userDid: string, listId: string): string {
  return `${userDid}/resources/list-${listId}`;
}

/**
 * Build the HTTPS URL for a list resource.
 * e.g. "https://boop.ad/user-abc123/resources/list-{listId}"
 */
export function buildListResourceUrl(userDid: string, listId: string): string {
  const domain = domainFromDid(userDid);
  const path = pathFromDid(userDid);
  // did:webvh mandates https; local hosts have no certificate, so dev links
  // would be unopenable otherwise.
  const scheme = /^(localhost|127\.0\.0\.1)(:|$)/.test(domain) ? "http" : "https";
  return `${scheme}://${domain}/${path}/resources/list-${listId}`;
}
