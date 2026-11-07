/**
 * Strict Ed25519 Multikey (`z6Mk…`) handling, shared by the author DID rule
 * (shared/authorDid.ts) and the LWS JWT verifier (convex/lib/lwsJwt.ts).
 *
 * Strict means one spelling per key: base58btc of exactly 0xed 0x01 followed
 * by 32 bytes, and the text must be the canonical encoding of those bytes, so
 * two strings can never name the same key (a key-reuse check compares strings).
 */
import { base58Decode, base58Encode } from "./actionRecord";

const ED25519_MULTICODEC = [0xed, 0x01] as const;

/** The raw 32-byte Ed25519 public key of a canonical `z6Mk…` Multikey, or null. */
export function decodeEd25519Multikey(multikey: unknown): Uint8Array | null {
  if (typeof multikey !== "string" || !multikey.startsWith("z6Mk") || multikey.length > 64) return null;
  const bytes = base58Decode(multikey.slice(1));
  if (!bytes || bytes.length !== 34 || bytes[0] !== ED25519_MULTICODEC[0] || bytes[1] !== ED25519_MULTICODEC[1]) return null;
  if (`z${base58Encode(bytes)}` !== multikey) return null;
  return bytes.slice(2);
}

export function isEd25519Multikey(multikey: unknown): multikey is string {
  return decodeEd25519Multikey(multikey) !== null;
}

/** `did:key:z6Mk…` (no fragment) → its raw Ed25519 key, or null for anything else. */
export function decodeEd25519DidKey(did: unknown): { multikey: string; publicKey: Uint8Array } | null {
  if (typeof did !== "string" || !did.startsWith("did:key:")) return null;
  const multikey = did.slice("did:key:".length);
  const publicKey = decodeEd25519Multikey(multikey);
  return publicKey ? { multikey, publicKey } : null;
}

/**
 * What the app (Settings → Agents) and agents (scripts/lws-agent.mjs) show
 * so a person can tell that a pending request is their agent's: the last 12
 * characters of the Multikey, in groups of four ("aB3d eF5h iJ7k"). The
 * leading `z6Mk` is the same for every Ed25519 key, so it is left out; 12
 * base58 characters are too many to grind a lookalike key for.
 */
export function keyFingerprint(key: string): string {
  const multikey = key.replace(/^did:key:/, "").split("#")[0];
  const tail = multikey.length > 12 ? multikey.slice(-12) : multikey;
  return tail.match(/.{1,4}/g)?.join(" ") ?? "";
}
