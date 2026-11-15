/**
 * One-time agent enrollment codes (plans/002 D14, docs/agent-enrollment-codes.md).
 *
 * Pure helpers shared by Convex and the app. A code is shown once in Settings,
 * typed or pasted into an agent, and redeemed once. Only its SHA-256 hash is
 * stored.
 *
 * Format: `BOOP-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`. The body is 25 characters of
 * Crockford base32 (no I, L, O or U), so 125 bits from the CSPRNG. Reading is
 * forgiving: case, spaces and hyphens don't matter, and I/L read as 1, O as 0.
 */

/** How long a code can be redeemed after it is minted. */
export const ENROLLMENT_CODE_TTL_MS = 15 * 60 * 1000;
/** Unredeemed, unexpired codes one account may hold at a time. */
export const MAX_ACTIVE_ENROLLMENT_CODES = 5;
/** Longest label kept with a code. */
export const ENROLLMENT_CODE_LABEL_MAX = 60;

const PREFIX = "BOOP";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const BODY_LENGTH = 25;
const GROUP = 5;

/** A fresh code. 32 symbols divide 256 evenly, so masking a byte has no bias. */
export function generateEnrollmentCode(): string {
  const bytes = new Uint8Array(BODY_LENGTH);
  crypto.getRandomValues(bytes);
  let body = "";
  for (const byte of bytes) body += ALPHABET[byte & 31];
  return formatBody(body);
}

function formatBody(body: string): string {
  const groups: string[] = [];
  for (let i = 0; i < body.length; i += GROUP) groups.push(body.slice(i, i + GROUP));
  return [PREFIX, ...groups].join("-");
}

/**
 * The canonical form of what someone typed, or null when it can't be a code.
 * Two inputs that normalize alike are the same code.
 */
export function normalizeEnrollmentCode(input: string): string | null {
  if (typeof input !== "string" || input.length > 128) return null;
  const compact = input.toUpperCase().replace(/[\s-]/g, "");
  if (!compact.startsWith(PREFIX)) return null;
  const body = compact.slice(PREFIX.length).replace(/[IL]/g, "1").replace(/O/g, "0");
  if (body.length !== BODY_LENGTH) return null;
  for (const char of body) if (!ALPHABET.includes(char)) return null;
  return formatBody(body);
}

/** Lowercase hex SHA-256 of the canonical code, or null when it is malformed. */
export async function hashEnrollmentCode(input: string): Promise<string | null> {
  const code = normalizeEnrollmentCode(input);
  if (code === null) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Compares two strings without stopping at the first difference. */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** A label as stored: trimmed, bounded, and absent when empty. */
export function cleanEnrollmentLabel(label: string | undefined): string | undefined {
  const trimmed = label?.trim().slice(0, ENROLLMENT_CODE_LABEL_MAX).trim();
  return trimmed ? trimmed : undefined;
}

/** `m:ss` left until `expiresAt`; `0:00` once it has passed. */
export function formatEnrollmentCountdown(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
