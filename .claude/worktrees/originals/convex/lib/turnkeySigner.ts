"use node";

/**
 * Local Turnkey signer for Originals SDK.
 *
 * Copied from @originals/auth/server/turnkey-signer to avoid
 * extensionless re-exports that break Convex deploy analysis.
 */

import {
  MultibaseEncoding,
  multibaseEncode,
  prepareDataForSigning,
} from "didwebvh-ts";
import type { SigningInput, SigningOutput } from "didwebvh-ts";
import { sha512 } from "@noble/hashes/sha2.js";
import { concatBytes, bytesToHex } from "@noble/hashes/utils.js";
import * as ed25519 from "@noble/ed25519";

type TurnkeyClientLike = {
  apiClient: () => {
    signRawPayload: (params: {
      organizationId: string;
      signWith: string;
      payload: string;
      encoding: "PAYLOAD_ENCODING_HEXADECIMAL";
      hashFunction: "HASH_FUNCTION_NO_OP";
    }) => Promise<{
      activity?: {
        result?: {
          signRawPayloadResult?: { r?: string; s?: string };
        };
      };
    }>;
  };
};

// Configure @noble/ed25519 with required SHA-512 function.
const sha512Fn = (...msgs: Uint8Array[]) => sha512(concatBytes(...msgs));

function configureEd25519Sha512() {
  const ed25519Module = ed25519 as unknown as {
    utils?: { sha512Sync?: (...msgs: Uint8Array[]) => Uint8Array };
    etc?: { sha512Sync?: (...msgs: Uint8Array[]) => Uint8Array };
  };
  if (ed25519Module.utils) {
    ed25519Module.utils.sha512Sync = sha512Fn;
  }
  if (ed25519Module.etc) {
    ed25519Module.etc.sha512Sync = sha512Fn;
  }
}

try {
  configureEd25519Sha512();
} catch (error) {
  console.warn("Failed to configure ed25519 utils:", error);
}

export class TurnkeyWebVHSigner {
  private subOrgId: string;
  private keyId: string;
  private publicKeyMultibase: string;
  private turnkeyClient: TurnkeyClientLike;
  private verificationMethodId: string;

  constructor(
    subOrgId: string,
    keyId: string,
    publicKeyMultibase: string,
    turnkeyClient: TurnkeyClientLike,
    verificationMethodId: string
  ) {
    this.subOrgId = subOrgId;
    this.keyId = keyId;
    this.publicKeyMultibase = publicKeyMultibase;
    this.turnkeyClient = turnkeyClient;
    this.verificationMethodId = verificationMethodId;
  }

  /**
   * Sign data using Turnkey's API.
   */
  async sign(input: SigningInput): Promise<SigningOutput> {
    try {
      const dataToSign = await prepareDataForSigning(
        input.document as Record<string, unknown>,
        input.proof
      );
      const dataHex = `0x${bytesToHex(dataToSign)}`;

      const result = await this.turnkeyClient.apiClient().signRawPayload({
        organizationId: this.subOrgId,
        signWith: this.keyId,
        payload: dataHex,
        encoding: "PAYLOAD_ENCODING_HEXADECIMAL",
        hashFunction: "HASH_FUNCTION_NO_OP",
      });

      const signRawResult = result.activity?.result?.signRawPayloadResult;
      if (!signRawResult?.r || !signRawResult?.s) {
        throw new Error("No signature returned from Turnkey");
      }

      const signature = signRawResult.r + signRawResult.s;
      const cleanSig = signature.startsWith("0x")
        ? signature.slice(2)
        : signature;
      let signatureBytes = Buffer.from(cleanSig, "hex");

      if (signatureBytes.length === 65) {
        signatureBytes = signatureBytes.slice(0, 64);
      } else if (signatureBytes.length !== 64) {
        throw new Error(
          `Invalid Ed25519 signature length: ${signatureBytes.length} (expected 64 bytes)`
        );
      }

      const proofValue = multibaseEncode(
        signatureBytes,
        MultibaseEncoding.BASE58_BTC
      );
      return { proofValue };
    } catch (error) {
      console.error("Error signing with Turnkey:", error);
      throw new Error(
        `Failed to sign with Turnkey: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Verify a signature.
   */
  async verify(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array
  ): Promise<boolean> {
    try {
      let ed25519PublicKey = publicKey;
      if (publicKey.length === 33) {
        ed25519PublicKey = publicKey.slice(1);
      } else if (publicKey.length !== 32) {
        return false;
      }

      configureEd25519Sha512();

      return await ed25519.verifyAsync(signature, message, ed25519PublicKey);
    } catch (error) {
      console.error("Error verifying signature:", error);
      return false;
    }
  }

  getVerificationMethodId() {
    return this.verificationMethodId;
  }

  getPublicKeyMultibase() {
    return this.publicKeyMultibase;
  }
}
