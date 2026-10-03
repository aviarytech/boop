import { createDID, MultibaseEncoding, multibaseEncode, prepareDataForSigning } from "didwebvh-ts";
import type { DIDLog, SigningInput, SigningOutput } from "didwebvh-ts";
import { getPublicKeyAsync, signAsync, utils, verifyAsync } from "@noble/ed25519";
import { Capacitor } from '@capacitor/core';

const KEY_STORAGE_PREFIX = "lisa-webvh-ed25519";
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);

/** DID log stored locally for updates (serialized as JSON in localStorage) */
const DID_LOG_STORAGE_KEY = "lisa-webvh-did-log";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

class BrowserWebVHSigner {
  private readonly privateKey: Uint8Array;
  private readonly publicKeyMultibase: string;

  constructor(privateKey: Uint8Array, publicKeyMultibase: string) {
    this.privateKey = privateKey;
    this.publicKeyMultibase = publicKeyMultibase;
  }

  async sign(input: SigningInput): Promise<SigningOutput> {
    const payload = await prepareDataForSigning(
      input.document as Record<string, unknown>,
      input.proof
    );
    const signature = await signAsync(payload, this.privateKey);
    return {
      proofValue: multibaseEncode(signature, MultibaseEncoding.BASE58_BTC),
    };
  }

  async verify(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array
  ): Promise<boolean> {
    const key = publicKey.length === 33 ? publicKey.slice(1) : publicKey;
    return verifyAsync(signature, message, key);
  }

  getVerificationMethodId() {
    return `did:key:${this.publicKeyMultibase}`;
  }
}

async function getOrCreateKeyPair(subOrgId: string) {
  const storageKey = `${KEY_STORAGE_PREFIX}:${subOrgId}`;
  const existingPrivateKey = localStorage.getItem(storageKey);
  const privateKey = existingPrivateKey
    ? hexToBytes(existingPrivateKey)
    : utils.randomSecretKey();

  if (!existingPrivateKey) {
    localStorage.setItem(storageKey, bytesToHex(privateKey));
  }

  const publicKey = await getPublicKeyAsync(privateKey);
  const multikeyBytes = new Uint8Array(
    ED25519_MULTICODEC_PREFIX.length + publicKey.length
  );
  multikeyBytes.set(ED25519_MULTICODEC_PREFIX, 0);
  multikeyBytes.set(publicKey, ED25519_MULTICODEC_PREFIX.length);
  const publicKeyMultibase = multibaseEncode(multikeyBytes, MultibaseEncoding.BASE58_BTC);
  return { privateKey, publicKeyMultibase };
}

function toUserSlug(_email: string, subOrgId: string) {
  return `user-${subOrgId.slice(0, 16)}`;
}

/**
 * Serialize a DID log array to JSONL format (one JSON object per line).
 */
export function serializeDidLog(log: DIDLog): string {
  return log.map((entry) => JSON.stringify(entry)).join("\n");
}

/**
 * Deserialize a JSONL string back to a DID log array.
 */
export function deserializeDidLog(jsonl: string): DIDLog {
  return jsonl
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/**
 * Store the DID log locally for future updateDID operations.
 */
function storeDidLogLocally(subOrgId: string, log: DIDLog) {
  localStorage.setItem(`${DID_LOG_STORAGE_KEY}:${subOrgId}`, JSON.stringify(log));
}

/**
 * Retrieve the locally stored DID log.
 */
export function getStoredDidLog(subOrgId: string): DIDLog | null {
  const stored = localStorage.getItem(`${DID_LOG_STORAGE_KEY}:${subOrgId}`);
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
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

export async function createUserWebVHDid(params: {
  email: string;
  subOrgId: string;
  domain?: string;
}) {
  const { privateKey, publicKeyMultibase } = await getOrCreateKeyPair(params.subOrgId);
  const signer = new BrowserWebVHSigner(privateKey, publicKeyMultibase);
  const domain = params.domain || currentWebvhDomain();

  const userSlug = toUserSlug(params.email, params.subOrgId);

  const result = await createDID({
    domain,
    signer,
    verifier: signer,
    // Bare multibase, NOT the did:key URI. didwebvh-ts 2.8's isKeyAuthorized
    // parses the proof's verificationMethod down to its keyMultibase and
    // compares by exact equality, so a `did:key:z6Mk…` entry never matches and
    // every mint fails with "Key … is not authorized to update".
    updateKeys: [publicKeyMultibase],
    verificationMethods: [
      {
        id: "#key-0",
        type: "Multikey",
        controller: "",
        publicKeyMultibase,
      },
      {
        id: "#key-1",
        type: "Multikey",
        controller: "",
        publicKeyMultibase,
      },
    ],
    paths: [userSlug],
    portable: false,
    authentication: ["#key-0"],
    assertionMethod: ["#key-1"],
  });

  // Store log locally for future updates
  storeDidLogLocally(params.subOrgId, result.log);

  return {
    did: result.did,
    didDocument: result.doc,
    didLog: result.log,
    didLogJsonl: serializeDidLog(result.log),
    path: userSlug,
  };
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
