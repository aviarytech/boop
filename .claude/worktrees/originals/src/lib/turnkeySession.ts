/**
 * Browser-side Turnkey signing session — the custody layer under every signature.
 *
 * The user's Ed25519 key lives in their Turnkey sub-organization and never
 * leaves it. At login the server mints a short-lived API key inside that
 * sub-org, HPKE-encrypted to a keypair only this browser holds; opening that
 * bundle gives the browser a credential it can stamp Turnkey requests with
 * directly. Signing then costs one Turnkey round-trip instead of a Convex hop
 * plus a Turnkey round-trip, and no server can sign as the user.
 *
 * This replaces the locally generated keys in webvh.ts and celKeyStore.ts.
 * Consequence worth remembering: Turnkey is a REMOTE signer either way — with
 * no network there is no signature, which is why appends are queued rather
 * than performed inline.
 */

import { decryptCredentialBundle, generateP256KeyPair, getPublicKey } from "@turnkey/crypto";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import type { RawEd25519Signer } from "./originalsSigner";
import {
  normalizeTurnkeySignature,
  turnkeyAddressToMultikey,
} from "./originalsSigner";
import { storageAdapter } from "./storageAdapter";

const TURNKEY_API_BASE_URL = "https://api.turnkey.com";

/**
 * Persisted so a reload keeps signing without a fresh login. This does put a
 * key in local storage, but not the user's key: it is a scoped, expiring,
 * server-revocable API credential, and the Ed25519 key it can ask Turnkey to
 * use never leaves Turnkey. That is the whole difference from the
 * `lisa-cel-ed25519` / `lisa-webvh-ed25519` keys this replaces.
 */
const SESSION_STORAGE_KEY = "boop-turnkey-signing-session";

/**
 * Treat a session expiring within this window as already expired: a signature
 * started at the edge would fail mid-flight.
 */
const EXPIRY_SKEW_MS = 30_000;

/** The credential this browser signs with, until it expires. */
export interface SigningSession {
  /** Compressed P-256 public key (hex) of the session API key. */
  apiPublicKey: string;
  /** P-256 private key (hex). Recovered from the bundle; never leaves here. */
  apiPrivateKey: string;
  /** The sub-org every request is scoped to. */
  subOrgId: string;
  /** Ed25519 account address (Solana format) — what we ask Turnkey to sign with. */
  signingAddress: string;
  expiresAt: number;
}

/** The ephemeral keypair the server encrypts the session bundle to. */
export interface SessionTargetKey {
  /** Uncompressed public key hex — what Turnkey's HPKE expects. */
  targetPublicKey: string;
  targetPrivateKey: string;
}

/**
 * Generate the target key before starting login. Its private half stays in
 * memory, so a bundle intercepted in transit is useless to everyone else.
 */
export function createSessionTargetKey(): SessionTargetKey {
  const keyPair = generateP256KeyPair();
  return {
    targetPublicKey: keyPair.publicKeyUncompressed,
    targetPrivateKey: keyPair.privateKey,
  };
}

/** Open the HPKE bundle the server minted into a usable session credential. */
export function openSigningSession(params: {
  credentialBundle: string;
  targetPrivateKey: string;
  subOrgId: string;
  signingAddress: string;
  expiresAt: number;
}): SigningSession {
  const apiPrivateKey = decryptCredentialBundle(
    params.credentialBundle,
    params.targetPrivateKey
  );

  return {
    apiPrivateKey,
    apiPublicKey: bytesToHex(getPublicKey(apiPrivateKey, true)),
    subOrgId: params.subOrgId,
    signingAddress: params.signingAddress,
    expiresAt: params.expiresAt,
  };
}

/** True when the session is missing, expired, or about to expire. */
export function isSessionExpired(
  session: Pick<SigningSession, "expiresAt"> | null | undefined,
  now: number = Date.now()
): boolean {
  if (!session) return true;
  return session.expiresAt - EXPIRY_SKEW_MS <= now;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function persistSigningSession(session: SigningSession): Promise<void> {
  await storageAdapter.set(SESSION_STORAGE_KEY, JSON.stringify(session));
}

/** Returns null when absent, unparseable, or expired — callers just re-login. */
export async function loadSigningSession(): Promise<SigningSession | null> {
  const stored = await storageAdapter.get(SESSION_STORAGE_KEY);
  if (!stored) return null;

  try {
    const session = JSON.parse(stored) as SigningSession;
    return isSessionExpired(session) ? null : session;
  } catch {
    return null;
  }
}

export async function clearSigningSession(): Promise<void> {
  await storageAdapter.remove(SESSION_STORAGE_KEY);
}

interface SignRawPayloadResponse {
  activity?: {
    result?: {
      signRawPayloadResult?: { r?: string; s?: string };
    };
  };
}

/**
 * A `RawEd25519Signer` backed by a live Turnkey session.
 *
 * `HASH_FUNCTION_NO_OP` is required: Ed25519 hashes its own message, so asking
 * Turnkey to pre-hash yields a signature over the wrong preimage that fails
 * verification with no useful error.
 */
export function createSessionSigner(
  session: SigningSession,
  fetchImpl: typeof fetch = fetch
): RawEd25519Signer {
  const stamper = new ApiKeyStamper({
    apiPublicKey: session.apiPublicKey,
    apiPrivateKey: session.apiPrivateKey,
  });

  return {
    publicKeyMultibase: turnkeyAddressToMultikey(session.signingAddress),

    async signBytes(bytes: Uint8Array): Promise<Uint8Array> {
      if (isSessionExpired(session)) {
        throw new Error("Turnkey signing session has expired");
      }

      const body = JSON.stringify({
        type: "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2",
        timestampMs: Date.now().toString(),
        organizationId: session.subOrgId,
        parameters: {
          signWith: session.signingAddress,
          payload: `0x${bytesToHex(bytes)}`,
          encoding: "PAYLOAD_ENCODING_HEXADECIMAL",
          hashFunction: "HASH_FUNCTION_NO_OP",
        },
      });

      const stamp = await stamper.stamp(body);
      const response = await fetchImpl(
        `${TURNKEY_API_BASE_URL}/public/v1/submit/sign_raw_payload`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [stamp.stampHeaderName]: stamp.stampHeaderValue,
          },
          body,
        }
      );

      if (!response.ok) {
        throw new Error(
          `Turnkey signing failed (${response.status}): ${await response.text()}`
        );
      }

      const result = (await response.json()) as SignRawPayloadResponse;
      const signature = result.activity?.result?.signRawPayloadResult;
      if (!signature?.r || !signature?.s) {
        throw new Error("Turnkey returned no signature");
      }
      return normalizeTurnkeySignature(signature.r + signature.s);
    },
  };
}
