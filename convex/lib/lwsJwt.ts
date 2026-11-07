/**
 * Self-signed LWS authentication credentials (LWS 1.0 "Self-signed Identity
 * using Controlled Identifiers"): compact EdDSA JWTs whose sub = iss =
 * client_id, verified against
 * - a `did:key:z6Mk…` subject, the key being the identifier itself (access
 *   requests), or
 * - a boop did:webvh subject's stored DID document, the key being the agent
 *   method `kid` names (token exchange; docs/lws-agent-auth.md).
 *
 * Pure and synchronous (no Convex ctx, no WebCrypto Ed25519), so it runs in a
 * Convex mutation and tests import it directly. Replay is the caller's part:
 * record `replayKey` until `replayUntil`, and refuse a key already recorded.
 */
import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { isAgentFragment, type DidDocumentLike } from "../../shared/authorDid";
import { decodeEd25519DidKey, decodeEd25519Multikey } from "../../shared/multikey";

ed25519.hashes.sha512 ??= sha512;

/** Allowed clock difference between the agent and boop, in seconds. */
export const LWS_JWT_CLOCK_SKEW_S = 60;
/** Longest a credential may be valid for (exp - iat), in seconds. */
export const LWS_JWT_MAX_LIFETIME_S = 600;
const MAX_TOKEN_LENGTH = 8192;
const MAX_CLAIM_LENGTH = 2048;
const MAX_JTI_LENGTH = 256;

/** Every failure: the message is for logs and tests, never echoed to a client. */
export class LwsJwtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LwsJwtError";
  }
}

export interface ParsedJwt {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  signingInput: Uint8Array;
  signature: Uint8Array;
}

export interface VerifiedClaims {
  /** sub = iss = client_id. */
  subject: string;
  jti: string;
  iat: number;
  exp: number;
  /** What the caller records to refuse this credential a second time. */
  replayKey: string;
  /** Until when (ms) the replay record must be kept: past that, the credential has expired anyway. */
  replayUntil: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Strict base64url: the alphabet only, no padding, and the one canonical encoding of its bytes. */
export function decodeBase64url(part: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(part) || part.length % 4 === 1) return null;
  let binary: string;
  try { binary = atob(part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4)); }
  catch { return null; }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  let again = "";
  for (const byte of bytes) again += String.fromCharCode(byte);
  if (btoa(again).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== part) return null;
  return bytes;
}

function decodeJson(part: string, what: string): Record<string, unknown> {
  const bytes = decodeBase64url(part);
  if (!bytes) throw new LwsJwtError(`The ${what} is not base64url`);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new LwsJwtError(`The ${what} is not JSON`); }
  if (!isRecord(value)) throw new LwsJwtError(`The ${what} is not a JSON object`);
  return value;
}

/** A compact JWS with a JSON payload, split and decoded but not verified. */
export function parseCompactJwt(token: unknown): ParsedJwt {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) throw new LwsJwtError("No JWT");
  const parts = token.split(".");
  if (parts.length !== 3) throw new LwsJwtError("Not a compact JWS");
  const [headerPart, claimsPart, signaturePart] = parts;
  const header = decodeJson(headerPart, "JWT header");
  const claims = decodeJson(claimsPart, "JWT payload");
  const signature = decodeBase64url(signaturePart);
  if (!signature || signature.length !== 64) throw new LwsJwtError("The signature is not an Ed25519 signature");
  return { header, claims, signingInput: new TextEncoder().encode(`${headerPart}.${claimsPart}`), signature };
}

/** The claimed subject, unverified: only for finding the key to verify with. */
export function unverifiedSubject(token: unknown): string | null {
  try {
    const { claims } = parseCompactJwt(token);
    return typeof claims.sub === "string" ? claims.sub : null;
  } catch {
    return null;
  }
}

/**
 * The header: EdDSA only (never `none`, never anything else), no critical
 * extensions, and no key or key reference of its own; the key comes from the
 * subject. Returns `kid` when present.
 */
export function checkJwtHeader(header: Record<string, unknown>): { kid?: string } {
  if (header.alg !== "EdDSA") throw new LwsJwtError(`alg ${JSON.stringify(header.alg)} is not EdDSA`);
  if (header.typ !== undefined && header.typ !== "JWT") throw new LwsJwtError("typ is not JWT");
  if (header.crit !== undefined || header.b64 !== undefined) throw new LwsJwtError("Critical header extensions are not supported");
  for (const member of ["jwk", "jku", "x5u", "x5c", "x5t", "x5t#S256"]) {
    if (header[member] !== undefined) throw new LwsJwtError(`The header carries ${member}`);
  }
  if (header.kid !== undefined && (typeof header.kid !== "string" || header.kid.length === 0 || header.kid.length > MAX_CLAIM_LENGTH)) {
    throw new LwsJwtError("kid is not a string");
  }
  return header.kid === undefined ? {} : { kid: header.kid as string };
}

const isNumericDate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/**
 * The authentication suite's claim rules: sub = iss = client_id, `aud`
 * includes one of `audience`, `iat` and `exp` present and sane (60 s of skew,
 * at most 10 minutes of validity), `nbf` (when present) passed, and a `jti`.
 */
export function checkLwsClaims(claims: Record<string, unknown>, options: { audience: string | string[]; now: number }): VerifiedClaims {
  const { sub, iss, client_id: clientId, aud, exp, iat, nbf, jti } = claims;
  if (typeof sub !== "string" || sub.length === 0 || sub.length > MAX_CLAIM_LENGTH) throw new LwsJwtError("sub is missing");
  if (iss !== sub || clientId !== sub) throw new LwsJwtError("sub, iss and client_id differ");
  const audiences = typeof aud === "string" ? [aud] : Array.isArray(aud) && aud.every(value => typeof value === "string") ? aud as string[] : null;
  if (!audiences || audiences.length === 0) throw new LwsJwtError("aud is missing");
  const expected = typeof options.audience === "string" ? [options.audience] : options.audience;
  if (!audiences.some(value => expected.includes(value))) throw new LwsJwtError("aud does not include this server");
  if (!isNumericDate(exp) || !isNumericDate(iat)) throw new LwsJwtError("exp and iat are required");
  const now = options.now / 1000;
  if (iat > now + LWS_JWT_CLOCK_SKEW_S) throw new LwsJwtError("iat is in the future");
  if (exp + LWS_JWT_CLOCK_SKEW_S <= now) throw new LwsJwtError("The JWT has expired");
  if (exp <= iat) throw new LwsJwtError("exp is not after iat");
  if (exp - iat > LWS_JWT_MAX_LIFETIME_S) throw new LwsJwtError(`The JWT is valid for more than ${LWS_JWT_MAX_LIFETIME_S} seconds`);
  if (nbf !== undefined && (!isNumericDate(nbf) || nbf > now + LWS_JWT_CLOCK_SKEW_S)) throw new LwsJwtError("The JWT is not valid yet");
  if (typeof jti !== "string" || jti.length === 0 || jti.length > MAX_JTI_LENGTH) throw new LwsJwtError("jti is required");
  return {
    subject: sub, jti, iat, exp,
    // Per issuer, so one agent's jti can never burn another's.
    replayKey: JSON.stringify([sub, jti]),
    replayUntil: Math.ceil((exp + LWS_JWT_CLOCK_SKEW_S) * 1000),
  };
}

/** RFC 8032 (non-ZIP215) Ed25519 verification of the JWS signing input. */
export function verifyJwtSignature(jwt: ParsedJwt, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(jwt.signature, jwt.signingInput, publicKey, { zip215: false });
  } catch {
    return false;
  }
}

/**
 * An agent's self-signed credential as itself: `sub` is its `did:key`, whose
 * key verifies the signature. `kid`, if present, is the did:key's own method.
 */
export function verifyDidKeyJwt(token: unknown, options: { audience: string | string[]; now: number }): VerifiedClaims & { didKey: string; publicKeyMultibase: string } {
  const jwt = parseCompactJwt(token);
  const { kid } = checkJwtHeader(jwt.header);
  const subject = jwt.claims.sub;
  const key = decodeEd25519DidKey(subject);
  if (!key) throw new LwsJwtError("sub is not an Ed25519 did:key");
  if (kid !== undefined && kid !== `${subject}#${key.multikey}`) throw new LwsJwtError("kid is not the did:key's key");
  if (!verifyJwtSignature(jwt, key.publicKey)) throw new LwsJwtError("The signature does not verify");
  const claims = checkLwsClaims(jwt.claims, options);
  return { ...claims, didKey: `did:key:${key.multikey}`, publicKeyMultibase: key.multikey };
}

/**
 * The agent method `kid` names in `doc`: an `#agent-…` method (never the
 * author's `#key-0`), referenced by id from `authentication`, an Ed25519
 * Multikey controlled by the DID.
 */
export function selectAgentMethod(doc: DidDocumentLike, kid: string | undefined): { kid: string; fragment: string; publicKeyMultibase: string; publicKey: Uint8Array } {
  const did = doc.id;
  if (!did) throw new LwsJwtError("No DID document");
  if (kid === undefined) throw new LwsJwtError("kid is required");
  if (!kid.startsWith(`${did}#`)) throw new LwsJwtError("kid is not a method of the subject");
  const fragment = kid.slice(did.length + 1);
  if (!isAgentFragment(fragment)) throw new LwsJwtError("kid is not an agent method");
  const absolute = (ref: string) => (ref.startsWith("#") ? `${did}${ref}` : ref);
  const matches = (doc.verificationMethod ?? []).filter(vm => absolute(vm.id ?? "") === kid);
  if (matches.length !== 1) throw new LwsJwtError("kid is not a verification method of the DID");
  const [vm] = matches;
  if (!(doc.authentication ?? []).some(ref => typeof ref === "string" && absolute(ref) === kid)) {
    throw new LwsJwtError("kid is not in authentication");
  }
  if (vm.type !== "Multikey" || vm.controller !== did) throw new LwsJwtError("kid is not a Multikey the DID controls");
  const publicKey = decodeEd25519Multikey(vm.publicKeyMultibase);
  if (!publicKey) throw new LwsJwtError("kid is not an Ed25519 key");
  return { kid, fragment, publicKeyMultibase: vm.publicKeyMultibase!, publicKey };
}

/**
 * An agent's credential as the user: `sub` is the user's did:webvh, whose
 * (already verified, stored) document `doc` holds the agent method `kid`
 * names. The caller looked `doc` up by `unverifiedSubject(token)`, so it
 * must be that subject's.
 */
export function verifyAgentJwt(
  token: unknown,
  options: { audience: string | string[]; now: number; document: DidDocumentLike },
): VerifiedClaims & { kid: string; fragment: string; publicKeyMultibase: string } {
  const jwt = parseCompactJwt(token);
  const { kid } = checkJwtHeader(jwt.header);
  if (typeof jwt.claims.sub !== "string" || !jwt.claims.sub.startsWith("did:webvh:") || jwt.claims.sub !== options.document.id) {
    throw new LwsJwtError("sub is not the DID document's");
  }
  const method = selectAgentMethod(options.document, kid);
  if (!verifyJwtSignature(jwt, method.publicKey)) throw new LwsJwtError("The signature does not verify");
  const claims = checkLwsClaims(jwt.claims, options);
  return { ...claims, kid: method.kid, fragment: method.fragment, publicKeyMultibase: method.publicKeyMultibase };
}

/** The latest DID document of a stored did.jsonl (verified when it was written), or null. */
export function latestDidState(jsonl: string): DidDocumentLike | null {
  const lines = jsonl.split("\n").filter(line => line.length > 0);
  const last = lines[lines.length - 1];
  if (!last) return null;
  try {
    const entry = JSON.parse(last) as { state?: unknown };
    return isRecord(entry.state) ? entry.state as DidDocumentLike : null;
  } catch {
    return null;
  }
}
