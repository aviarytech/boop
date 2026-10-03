/**
 * Signed claims about assets.
 *
 * CEL is single-writer: only an asset's controller can append to its log. So
 * anything one user asserts about ANOTHER user's asset — checking off an item,
 * assigning it — cannot be a log event. It is a Verifiable Credential, signed
 * with the claimant's own key and naming the asset's did:cel as its subject.
 *
 * This replaces the `vcProofs` placeholders in convex/items.ts, whose `proof`
 * was the credential re-serialized rather than a signature. The shape was
 * always right; only the proof was missing.
 */

import { CredentialManager, DIDManager } from "@originals/sdk";
import { EdDSACryptosuiteManager } from "@originals/sdk/vc/cryptosuites/eddsa";
import { createDocumentLoader } from "@originals/sdk/vc/documentLoader";
import type { OriginalsConfig, VerifiableCredential } from "@originals/sdk";
import type { RawEd25519Signer } from "./originalsSigner";
import { verificationMethodId } from "./originalsSigner";

/**
 * The Originals context is what makes our claim terms (`listDid`, `action`,
 * `retracts`, …) legal JSON-LD: it carries an `@vocab`, so RDF canonicalization
 * maps them instead of dropping them. Without it, jsonld safe mode rejects the
 * credential outright rather than silently signing a document with the custom
 * fields stripped. All three are bundled with the SDK, so signing works offline.
 */
const CREDENTIAL_CONTEXT = [
  "https://www.w3.org/2018/credentials/v1",
  "https://w3id.org/security/data-integrity/v2",
  "https://originals.build/context",
];

/** Verification and signing need no network or Bitcoin config. */
const config: OriginalsConfig = {
  network: "signet",
  defaultKeyType: "Ed25519",
};

// The DIDManager is what routes verification to the Data Integrity verifier;
// without it CredentialManager falls back to a legacy digest that no
// eddsa-rdfc-2022 proof can satisfy.
const didManager = new DIDManager(config);
const credentialManager = new CredentialManager(config, didManager);

// RDFC canonicalization resolves every @context. The SDK's loader serves the
// credential and data-integrity contexts from bundled copies, so signing works
// offline and cannot be broken by a remote context changing under us.
const documentLoader = createDocumentLoader(didManager);

function buildCredential(
  type: string,
  issuer: string,
  issuanceDate: string,
  credentialSubject: Record<string, unknown>
): VerifiableCredential {
  return {
    "@context": CREDENTIAL_CONTEXT,
    id: `urn:uuid:${crypto.randomUUID()}`,
    type: ["VerifiableCredential", type],
    issuer,
    issuanceDate,
    credentialSubject,
  } as VerifiableCredential;
}

/**
 * Sign with the cryptosuite the verifier actually implements.
 *
 * NOT `CredentialManager.signCredentialWithExternalSigner`, despite its docs
 * naming Turnkey: it labels the proof `eddsa-rdfc-2022` but delegates
 * canonicalization to the signer, and didwebvh-ts-shaped signers canonicalize
 * with JCS. The result is a proof whose bytes disagree with its own label, and
 * the SDK's verifier — which supports only eddsa-rdfc-2022 — rejects every one.
 *
 * `computeSigningInput` exists for exactly this case: the SDK canonicalizes and
 * hashes, we sign those bytes, and the proofConfig is emitted verbatim so
 * verification reconstructs identical input.
 */
async function sign(
  credential: VerifiableCredential,
  signer: RawEd25519Signer
): Promise<VerifiableCredential> {
  const { hashData, proofConfig } = await EdDSACryptosuiteManager.computeSigningInput(
    credential,
    {
      cryptosuite: "eddsa-rdfc-2022",
      verificationMethod: verificationMethodId(signer),
      proofPurpose: "assertionMethod",
      created: new Date().toISOString(),
      documentLoader,
    }
  );

  const signature = await signer.signBytes(hashData);
  delete proofConfig["@context"];

  return {
    ...credential,
    proof: {
      ...proofConfig,
      proofValue: EdDSACryptosuiteManager.encodeProofValue(signature),
    },
  } as VerifiableCredential;
}

/**
 * The closed vocabulary of item actions. Anything outside this set is refused
 * rather than signed — one log now carries both content and control events, and
 * an open vocabulary would let a content write forge a control event. The SDK
 * takes the same precaution with RESERVED_MIGRATION_FIELDS.
 */
export const ITEM_ACTIONS = ["added", "checked", "unchecked", "renamed", "removed"] as const;
export type ItemAction = (typeof ITEM_ACTIONS)[number];

export function isItemAction(value: unknown): value is ItemAction {
  return typeof value === "string" && (ITEM_ACTIONS as readonly string[]).includes(value);
}

interface ItemClaimParams {
  /** The asset the claim is about: the list. Items are claims on it, not assets. */
  listDid: string;
  /** Stable identifier for the item within the list. */
  itemId: string;
  action: ItemAction;
  /** The claimant. Need not control the list. */
  actorDid: string;
  signer: RawEd25519Signer;
  itemName?: string;
  /** For `unchecked`: the completion claim this undoes. */
  retracts?: string;
  issuedAt?: string;
}

/**
 * A signed claim about an item on someone else's list.
 *
 * Only needed when the claimant does not control the list — the list's
 * controller writes events to its log directly. See listLog.ts.
 */
export async function issueItemClaim(
  params: ItemClaimParams
): Promise<VerifiableCredential> {
  if (!isItemAction(params.action)) {
    throw new Error(`Refusing to sign unknown item action: ${String(params.action)}`);
  }

  const subject: Record<string, unknown> = {
    id: params.listDid,
    itemId: params.itemId,
    action: params.action,
  };
  if (params.itemName !== undefined) subject.itemName = params.itemName;
  if (params.retracts !== undefined) subject.retracts = params.retracts;

  return sign(
    buildCredential(
      "ItemClaimCredential",
      params.actorDid,
      params.issuedAt ?? new Date().toISOString(),
      subject
    ),
    params.signer
  );
}

/** Checks the proof. Returns false rather than throwing on a malformed input. */
export async function verifyCredential(
  credential: VerifiableCredential
): Promise<boolean> {
  try {
    return await credentialManager.verifyCredential(credential);
  } catch {
    return false;
  }
}
