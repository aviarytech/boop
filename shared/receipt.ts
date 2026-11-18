/** Receipts for action records (#286 P3, plans/002 D10/D11): Boop's signed
 * statement that it accepted the record with a given hash at a given time.
 * Pure (no Convex ctx, no network), like shared/actionRecord.ts, so the server,
 * the browser and outside verifiers share one definition. See
 * docs/action-records.md "Receipts".
 *
 * A receipt is a W3C Data Integrity document secured with `eddsa-jcs-2022`:
 * the proof is an Ed25519 signature over
 *   SHA-256(JCS(proof options)) || SHA-256(JCS(receipt without proof)).
 * Action records use boop's own domain-prefixed form because their payload is
 * a stored string the author's device signs; a receipt is a small JSON object
 * a third party is handed, signed by a service DID, so it uses the standard
 * suite did:webvh logs already use here. Any Data Integrity verifier can check
 * one, and the proof options (type, cryptosuite, purpose) keep these
 * signatures apart from anything else.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import * as ed25519 from "@noble/ed25519";
import {
  assertionKeyAt, canonicalize, decodeSignature, parseEd25519PublicKey,
  type AssertionKeyFailure, type DidLogInput,
} from "./actionRecord";

export const RECEIPT_TYPE = "BoopActionRecordReceipt";
export const RECEIPT_CRYPTOSUITE = "eddsa-jcs-2022";

/** What the service signs: everything in a receipt except its proof. */
export type ReceiptStatement = {
  type: typeof RECEIPT_TYPE;
  /** Lowercase hex SHA-256 of the record's payload: the record's `digest`. */
  recordHash: string;
  /** Boop's clock when it accepted the record, ms since epoch. */
  receivedAt: number;
  /** The service's verification method, `<service DID>#<key>`. */
  signer: string;
  /** The service DID log version `signer`'s key is to be read from. */
  versionId: string;
};

/** The proof options, which are signed too. */
export type ReceiptProofConfig = {
  type: "DataIntegrityProof";
  cryptosuite: typeof RECEIPT_CRYPTOSUITE;
  /** Equals `signer`. */
  verificationMethod: string;
  proofPurpose: "assertionMethod";
  /** `receivedAt` as an ISO 8601 UTC time; a receipt has one clock. */
  created: string;
};

export type ActionRecordReceipt = ReceiptStatement & {
  /** `proofValue` is the multibase base58btc Ed25519 signature. */
  proof: ReceiptProofConfig & { proofValue: string };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasExactly = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));

const STATEMENT_KEYS = ["type", "recordHash", "receivedAt", "signer", "versionId"] as const;
const PROOF_KEYS = ["type", "cryptosuite", "verificationMethod", "proofPurpose", "created", "proofValue"] as const;
// Date can represent ±8.64e15 ms; a receipt time is a non-negative whole number of them.
const MAX_TIME = 8.64e15;

/** `did:webvh:…#fragment`, split; null for anything else. */
export function parseServiceKeyId(signer: string): { did: string; fragment: string } | null {
  const at = signer.indexOf("#");
  if (at <= 0 || at === signer.length - 1 || signer.indexOf("#", at + 1) !== -1) return null;
  const did = signer.slice(0, at);
  return did.startsWith("did:webvh:") ? { did, fragment: signer.slice(at + 1) } : null;
}

/** The statement for these fields, or null when one of them is not well-formed. */
export function receiptStatement(fields: Omit<ReceiptStatement, "type">): ReceiptStatement | null {
  const { recordHash, receivedAt, signer, versionId } = fields;
  if (typeof recordHash !== "string" || !/^[0-9a-f]{64}$/.test(recordHash)) return null;
  if (typeof receivedAt !== "number" || !Number.isInteger(receivedAt) || receivedAt < 0 || receivedAt > MAX_TIME) return null;
  if (typeof signer !== "string" || !parseServiceKeyId(signer)) return null;
  if (typeof versionId !== "string" || versionId.length === 0) return null;
  return { type: RECEIPT_TYPE, recordHash, receivedAt, signer, versionId };
}

/** The proof options for a statement. Nothing in them is free: all follow from the statement. */
export function receiptProofConfig(statement: ReceiptStatement): ReceiptProofConfig {
  return {
    type: "DataIntegrityProof",
    cryptosuite: RECEIPT_CRYPTOSUITE,
    verificationMethod: statement.signer,
    proofPurpose: "assertionMethod",
    created: new Date(statement.receivedAt).toISOString(),
  };
}

/** The 64 bytes an eddsa-jcs-2022 proof signs: SHA-256(JCS(options)) || SHA-256(JCS(statement)). */
export function receiptSigningInput(statement: ReceiptStatement, proofConfig: ReceiptProofConfig = receiptProofConfig(statement)): Uint8Array {
  return concatBytes(sha256(utf8ToBytes(canonicalize(proofConfig))), sha256(utf8ToBytes(canonicalize(statement))));
}

/** Structural check of a receipt: exactly the members above, each well-formed. */
export function parseReceipt(value: unknown): ActionRecordReceipt | null {
  if (!isRecord(value) || !hasExactly(value, [...STATEMENT_KEYS, "proof"]) || value.type !== RECEIPT_TYPE) return null;
  const statement = receiptStatement(value as Omit<ReceiptStatement, "type">);
  const proof = value.proof;
  if (!statement || !isRecord(proof) || !hasExactly(proof, PROOF_KEYS)) return null;
  const expected = receiptProofConfig(statement);
  for (const key of Object.keys(expected) as Array<keyof ReceiptProofConfig>) {
    if (proof[key] !== expected[key]) return null;
  }
  if (typeof proof.proofValue !== "string" || !decodeSignature(proof.proofValue)) return null;
  return { ...statement, proof: { ...expected, proofValue: proof.proofValue } };
}

export type VerifyReceiptOptions = {
  expected?: {
    /** The record the receipt is presented for: its `digest`. */
    recordHash?: string;
    /** The Boop service DID the verifier trusts. Without it, any did:webvh whose log is supplied passes. */
    serviceDid?: string;
  };
};

export type ReceiptFailure = "malformed_receipt" | "binding_mismatch" | "bad_signature" | AssertionKeyFailure;

export type VerifyReceiptResult =
  | { verified: true; receipt: ActionRecordReceipt; serviceDid: string; publicKeyMultibase: string }
  | { verified: false; reason: ReceiptFailure };

/**
 * Checks one receipt against the service's did:webvh log. The key is the one
 * `signer` names as an `assertionMethod` at the log version `versionId` names,
 * so receipts signed before a key rotation keep verifying from the later log.
 *
 * Takes the log as given, as verifyActionRecord does: resolving and validating
 * it (every entry signed by the update keys before it) is the caller's job.
 * Synchronous, so it also runs inside a Convex mutation.
 */
export function verifyReceipt(receipt: unknown, serviceDidLog: DidLogInput, options: VerifyReceiptOptions = {}): VerifyReceiptResult {
  const fail = (reason: ReceiptFailure): VerifyReceiptResult => ({ verified: false, reason });
  const parsed = parseReceipt(receipt);
  if (!parsed) return fail("malformed_receipt");
  const { proof, ...statement } = parsed;
  const serviceDid = parseServiceKeyId(statement.signer)!.did;
  const expected = options.expected ?? {};
  if ((expected.recordHash !== undefined && expected.recordHash !== statement.recordHash)
    || (expected.serviceDid !== undefined && expected.serviceDid !== serviceDid)) return fail("binding_mismatch");

  const key = assertionKeyAt(serviceDidLog, { did: serviceDid, verificationMethod: statement.signer, versionId: statement.versionId });
  if ("failure" in key) return fail(key.failure);
  let valid = false;
  try {
    valid = ed25519.verify(decodeSignature(proof.proofValue)!, receiptSigningInput(statement), parseEd25519PublicKey(key.publicKeyMultibase)!);
  } catch { valid = false; }
  return valid ? { verified: true, receipt: parsed, serviceDid, publicKeyMultibase: key.publicKeyMultibase } : fail("bad_signature");
}
