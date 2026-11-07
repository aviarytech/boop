/**
 * LWS access tokens and identifiers (docs/lws-agent-auth.md). Pure, so tests
 * import it directly. Only the SHA-256 of a token is stored (hashApiKey).
 */

/** Every LWS access token starts with this; nothing else may. */
export const LWS_ACCESS_TOKEN_PREFIX = "lwsat_";
/** Access tokens last an hour. */
export const LWS_ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
/** Access requests the owner hasn't decided expire after a day. */
export const LWS_ACCESS_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
/** Most pending access requests one user can have; a new one past this expires the oldest. */
export const MAX_PENDING_ACCESS_REQUESTS = 10;

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `lwsat_` + 32 random bytes, base64url. */
export function generateLwsAccessToken(): string {
  return LWS_ACCESS_TOKEN_PREFIX + base64url(randomBytes(32));
}

/** An access request's id: 24 random bytes, base64url (32 characters), safe in a URL path. */
export function generateAccessRequestId(): string {
  return base64url(randomBytes(24));
}
export const ACCESS_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/** `agent-` + 10 lowercase base32 characters (shared/authorDid.ts AGENT_VM_PATTERN). */
export function generateAgentFragment(): string {
  // 32 divides 256, so `byte % 32` is unbiased.
  return `agent-${Array.from(randomBytes(10), byte => BASE32[byte % 32]).join("")}`;
}

/** The bearer credential of a request's Authorization header, if it has one. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

/** Constant-time string equality, for secrets and values derived from them. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}
