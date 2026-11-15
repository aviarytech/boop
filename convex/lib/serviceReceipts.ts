/**
 * Issuing receipts as the Boop service DID (#286 P3, plans/002 D10/D11).
 *
 * The receipt key lives in the Turnkey PARENT org, where the parent can sign
 * server-side. This is the only place Convex asks Turnkey for a signature, and
 * it always signs as the parent org with the receipt key: nothing here can
 * name a user's sub-org or another key. Users' keys stay usable only through
 * their own sessions (docs/turnkey-custody.md).
 *
 * `ServiceSigner` is the seam: production uses `turnkeyServiceSigner`, tests a
 * local key. Web Crypto and fetch only, so it runs in Convex's V8 isolate.
 */
import { base58Encode, encodeSignature, parseEd25519PublicKey } from "../../shared/actionRecord";
import {
  receiptProofConfig, receiptSigningInput, receiptStatement, verifyReceipt, type ActionRecordReceipt,
} from "../../shared/receipt";
import { currentReceiptKey } from "../../shared/serviceDid";
import { bytesToHex, hexToBytes, turnkeyRequest, type TurnkeyCredentials } from "./turnkeyApi";

/** Signs exactly `message` (no hashing) with the Ed25519 key whose raw public key is `publicKey`. */
export interface ServiceSigner {
  sign(publicKey: Uint8Array, message: Uint8Array): Promise<Uint8Array>;
}

export class ReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptError";
  }
}

/**
 * A receipt for `recordHash` at `receivedAt`, signed by the receipt key of the
 * latest version of `serviceDidLog`. The result is verified against that log
 * before it is returned, so a signer answering with another key's signature
 * (or a wrong one) yields an error, never a receipt.
 */
export async function issueReceipt(
  serviceDidLog: string,
  fields: { recordHash: string; receivedAt: number },
  signer: ServiceSigner,
): Promise<ActionRecordReceipt> {
  const key = currentReceiptKey(serviceDidLog);
  if ("problems" in key) throw new ReceiptError(`The served log is not a Boop service DID: ${key.problems.join("; ")}`);
  const statement = receiptStatement({ ...fields, signer: key.verificationMethod, versionId: key.versionId });
  if (!statement) throw new ReceiptError("recordHash must be a lowercase hex SHA-256 and receivedAt a whole number of milliseconds");
  const proofConfig = receiptProofConfig(statement);
  const signature = await signer.sign(parseEd25519PublicKey(key.publicKeyMultibase)!, receiptSigningInput(statement, proofConfig));
  if (signature.length !== 64) throw new ReceiptError("The signer did not return an Ed25519 signature");
  const receipt: ActionRecordReceipt = { ...statement, proof: { ...proofConfig, proofValue: encodeSignature(signature) } };
  const checked = verifyReceipt(receipt, serviceDidLog, { expected: { recordHash: fields.recordHash, serviceDid: key.did } });
  if (!checked.verified) throw new ReceiptError(`The signed receipt does not verify (${checked.reason})`);
  return receipt;
}

type SignRawPayloadResponse = {
  activity?: { status?: string; result?: { signRawPayloadResult?: { r?: string; s?: string } } };
};

/**
 * Signs with a key of the Turnkey parent org (`credentials.organizationId`).
 * The key is addressed by its Solana-format address, which is the base58
 * public key, so nothing but the DID log says which key to use.
 * UNVALIDATED against the live Turnkey API; issueReceipt checks every
 * signature it gets back, so a wrong assumption fails closed.
 */
export function turnkeyServiceSigner(credentials: TurnkeyCredentials, fetchImpl: typeof fetch = fetch): ServiceSigner {
  return {
    async sign(publicKey, message) {
      const response = await turnkeyRequest<SignRawPayloadResponse>("/public/v1/submit/sign_raw_payload", {
        type: "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2",
        timestampMs: Date.now().toString(),
        organizationId: credentials.organizationId,
        parameters: {
          signWith: base58Encode(publicKey),
          payload: bytesToHex(message),
          encoding: "PAYLOAD_ENCODING_HEXADECIMAL",
          hashFunction: "HASH_FUNCTION_NOT_APPLICABLE",
        },
      }, credentials, fetchImpl);
      const { r, s } = response.activity?.result?.signRawPayloadResult ?? {};
      if (response.activity?.status !== "ACTIVITY_STATUS_COMPLETED" || !r || !s || !/^[0-9a-fA-F]{1,64}$/.test(r) || !/^[0-9a-fA-F]{1,64}$/.test(s)) {
        throw new ReceiptError(`Turnkey did not complete the signature (${response.activity?.status ?? "no activity"})`);
      }
      return hexToBytes(r.padStart(64, "0") + s.padStart(64, "0"));
    },
  };
}

/**
 * The receipt signer's own Turnkey API user: a parent-org user allowed to do
 * one thing, sign with the receipt key (docs/turnkey/boop-receipt-signer-policies.json).
 * Separate from the auth relay's user, which stays unable to sign anything.
 */
export function receiptSignerCredentials(): TurnkeyCredentials {
  const apiPublicKey = process.env.TURNKEY_RECEIPT_API_PUBLIC_KEY;
  const apiPrivateKey = process.env.TURNKEY_RECEIPT_API_PRIVATE_KEY;
  const organizationId = process.env.TURNKEY_ORGANIZATION_ID;
  if (!apiPublicKey || !apiPrivateKey || !organizationId) {
    throw new ReceiptError("Missing TURNKEY_RECEIPT_API_PUBLIC_KEY, TURNKEY_RECEIPT_API_PRIVATE_KEY or TURNKEY_ORGANIZATION_ID");
  }
  return { apiPublicKey, apiPrivateKey, organizationId };
}

/** Receipts are requested only when this Convex env var is exactly "true". Off by default. */
export const receiptsEnabled = () => process.env.ACTION_RECEIPTS_ENABLED === "true";
