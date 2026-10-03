/**
 * Pure, dependency-free API-key helpers.
 *
 * SYNC: convex/lib/apiKeyHelpers.ts is a byte-for-byte copy of this module's
 * logic (Convex cannot import from src/). Keep both in sync.
 *
 * Only the SHA-256 hash of a key is ever persisted; the raw key is shown once.
 */

const KEY_PREFIX = "pa_live_";
const KEY_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const KEY_BODY_LENGTH = 40;

/** Scopes granted to agent API keys by default. */
export const AGENT_SCOPES = ["lists:read", "items:read", "items:write"] as const;

/**
 * Generate a fresh raw API key: "pa_live_" + 40 chars of [A-Za-z0-9].
 * Uses crypto.getRandomValues for CSPRNG-quality randomness.
 */
export function generateApiKey(): string {
  const bytes = new Uint8Array(KEY_BODY_LENGTH);
  crypto.getRandomValues(bytes);
  let body = "";
  for (let i = 0; i < KEY_BODY_LENGTH; i++) {
    body += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  }
  return KEY_PREFIX + body;
}

/** First 12 chars of a raw key — safe to store/display for identification. */
export function formatKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, 12);
}

/** Lowercase hex SHA-256 of a raw key. Only the hash is ever stored. */
export async function hashApiKey(rawKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(rawKey);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** True if `granted` includes `required` or the wildcard "*". */
export function hasScope(granted: string[], required: string): boolean {
  return granted.includes("*") || granted.includes(required);
}

/**
 * Keep only recognized agent scopes. Drops "*" and any unknown/privileged
 * scope so a caller can never mint a wildcard key via the create endpoint.
 */
export function sanitizeScopes(scopes: string[]): string[] {
  return scopes.filter((s) => (AGENT_SCOPES as readonly string[]).includes(s));
}
