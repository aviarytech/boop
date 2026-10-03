/**
 * The one seam between boop and whatever holds the signing key.
 *
 * Everything that signs — CEL event logs, did:webvh DID logs, credentials —
 * goes through `RawEd25519Signer`. Today that is a Turnkey session
 * (see turnkeySession.ts); in tests it is a local key. Nothing else in the app
 * should know which.
 *
 * Kept deliberately narrow so the eventual move to a signer-injecting
 * LifecycleManager (upstream: github.com/onionoriginals/sdk) is a change here
 * and nowhere else. The SDK's own KeyStore can't be used: it requires handing
 * back a raw private key, which Turnkey never exports.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { multikey } from "@originals/sdk";
import { canonicalizeEvent } from "@originals/sdk/cel/canonicalize";
import type { DataIntegrityProof } from "@originals/sdk";
import {
  MultibaseEncoding,
  multibaseEncode,
  prepareDataForSigning,
} from "didwebvh-ts";
import type { SigningInput, SigningOutput } from "didwebvh-ts";

const ED25519_PUBLIC_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;

/**
 * An Ed25519 key we can sign with but never extract.
 *
 * `signBytes` receives the exact bytes to sign — no hashing, no
 * canonicalization. Callers own the preimage, because CEL and did:webvh
 * disagree about what it is.
 */
export interface RawEd25519Signer {
  /** Multibase Multikey (`z6Mk…`) of the public key. */
  publicKeyMultibase: string;
  /** Sign exactly these bytes; resolves to the raw 64-byte signature. */
  signBytes(bytes: Uint8Array): Promise<Uint8Array>;
}

/** Raw Ed25519 public key → Multikey (`z` + base58btc of 0xed01 ‖ key). */
export function multikeyFromEd25519PublicKey(publicKey: Uint8Array): string {
  if (publicKey.length !== ED25519_PUBLIC_KEY_BYTES) {
    throw new Error(
      `Ed25519 public keys are 32 bytes; got ${publicKey.length}`
    );
  }
  return multikey.encodePublicKey(publicKey, "Ed25519");
}

/** Multikey → the raw 32-byte public key. */
export function decodeMultikey(publicKeyMultibase: string): Uint8Array {
  const { key, type } = multikey.decodePublicKey(publicKeyMultibase);
  if (type !== "Ed25519") {
    throw new Error(`Expected an Ed25519 Multikey; got ${type}`);
  }
  return key;
}

/** Base58 (bitcoin alphabet), for Turnkey's Solana-format addresses. */
export function base58Encode(bytes: Uint8Array): string {
  return base58.encode(bytes);
}

/**
 * Turnkey creates CURVE_ED25519 accounts with ADDRESS_FORMAT_SOLANA, so the
 * account's `address` is the base58 raw public key — not the Multikey a DID
 * needs. Converting is the whole difference between a DID that resolves and
 * one that silently fails every signature check.
 */
export function turnkeyAddressToMultikey(address: string): string {
  let decoded: Uint8Array;
  try {
    decoded = base58.decode(address);
  } catch {
    throw new Error(`Turnkey address is not valid base58: ${address}`);
  }
  return multikeyFromEd25519PublicKey(decoded);
}

/** The holder's key DID. Distinct from any asset's did:cel. */
export function controllerDid(signer: RawEd25519Signer): string {
  return `did:key:${signer.publicKeyMultibase}`;
}

/** CEL's canonical did:key verification method: `<did>#<key>`. */
export function verificationMethodId(signer: RawEd25519Signer): string {
  return `${controllerDid(signer)}#${signer.publicKeyMultibase}`;
}

/**
 * Turnkey returns a signature as `r` ‖ `s` hex. Ed25519 has no recovery byte,
 * but the API sometimes appends one anyway — drop it rather than handing 65
 * bytes to a verifier that expects 64.
 */
export function normalizeTurnkeySignature(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-f]*$/i.test(clean) || clean.length % 2 !== 0) {
    throw new Error("Turnkey signature is not valid hex");
  }

  const bytes = Uint8Array.from(
    clean.match(/.{2}/g)?.map((byte) => parseInt(byte, 16)) ?? []
  );

  if (bytes.length === ED25519_SIGNATURE_BYTES + 1) {
    return bytes.slice(0, ED25519_SIGNATURE_BYTES);
  }
  if (bytes.length !== ED25519_SIGNATURE_BYTES) {
    throw new Error(
      `Invalid Ed25519 signature length: ${bytes.length} (expected 64 bytes)`
    );
  }
  return bytes;
}

/**
 * A CelSigner for `OriginalsCel` — signs the JCS bytes of the event and returns
 * an eddsa-jcs-2022 DataIntegrityProof.
 *
 * The preimage must be `canonicalizeEvent(data)` exactly; the SDK verifier
 * reconstructs it the same way, so any other serialization (notably
 * `JSON.stringify` with a sorted-key replacer array, which drops nested keys)
 * produces proofs that never verify.
 */
export function createCelSigner(
  signer: RawEd25519Signer
): (data: unknown) => Promise<DataIntegrityProof> {
  const verificationMethod = verificationMethodId(signer);

  return async (data: unknown): Promise<DataIntegrityProof> => {
    const signature = await signer.signBytes(canonicalizeEvent(data));
    return {
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-jcs-2022",
      created: new Date().toISOString(),
      verificationMethod,
      proofPurpose: "assertionMethod",
      proofValue: multikey.encodeMultibase(signature),
    };
  };
}

/**
 * The didwebvh-ts ExternalSigner — used for minting and updating did:webvh
 * logs, and accepted directly by the SDK's `publishToWeb`.
 *
 * Note the different preimage: didwebvh-ts canonicalizes with JCS over
 * `{document, proof}` via `prepareDataForSigning`, not `canonicalizeEvent`.
 */
export function createWebVHSigner(signer: RawEd25519Signer) {
  return {
    async sign(input: SigningInput): Promise<SigningOutput> {
      const payload = await prepareDataForSigning(
        input.document as Record<string, unknown>,
        input.proof
      );
      const signature = await signer.signBytes(payload);
      return {
        proofValue: multibaseEncode(signature, MultibaseEncoding.BASE58_BTC),
      };
    },

    async verify(
      signature: Uint8Array,
      message: Uint8Array,
      publicKey: Uint8Array
    ): Promise<boolean> {
      // Multikey-prefixed keys arrive 33 bytes; strip the header byte.
      const key =
        publicKey.length === ED25519_PUBLIC_KEY_BYTES + 1
          ? publicKey.slice(1)
          : publicKey;
      if (key.length !== ED25519_PUBLIC_KEY_BYTES) return false;
      try {
        return ed25519.verify(signature, message, key);
      } catch {
        return false;
      }
    },

    /** didwebvh-ts matches signers by did:key, without the fragment. */
    getVerificationMethodId(): string {
      return controllerDid(signer);
    },
  };
}
