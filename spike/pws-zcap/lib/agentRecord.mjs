// THROWAWAY spike code (#286). Gate 3: sketch of an agent-signed action record
// (author = agent did:key, onBehalfOf = owner DID, delegation = the zCap) and
// two offline verifiers for it: one on the zcap libraries, one on nothing but
// @noble and boop's own canonicalize. Neither touches the network.
//
// Record version 3 (sketch). `payload` is what the agent signs:
//
//   { schema: "boop.action-record", version: 3,
//     action, subject, after,                      // as version 2
//     author:     { did: "did:key:z6Mk…", verificationMethod: "did:key:z6Mk…#z6Mk…" },
//     onBehalfOf: { did: "did:webvh:…" },          // the owner who delegated
//     delegation: { id: "urn:uuid:…", digest: "<sha256 hex of JCS(zCap)>" },
//     signedAt }                                   // the agent's clock, ms
//
// Stored beside it, unsigned by the agent:
//
//   signature        agent's Ed25519 over SHA-256("boop.action-record/v3") || SHA-256(payload)
//   delegation[]     the zCap chain after the root, tail last (one zCap: owner -> agent)
//   receipt          { payload, signature }: Boop's service DID states it received
//                    the record with this digest at `receivedAt` (P3 owns the real shape)
import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";
import jsigs from "@interop/jsonld-signatures";
import { CapabilityDelegation } from "@interop/zcap";
import { DataIntegrityProof } from "@interop/data-integrity-proof";
import { createVerifyCryptosuite } from "@interop/ed25519-signature/eddsa-jcs-2022";
import { canonicalize } from "../../../shared/actionRecord.ts";
import { staticDidLoader, rootZcap, rootZcapId, multikeyBytes, absolutizeDidDocument } from "./common.mjs";

ed.hashes.sha512 ??= sha512;

export const SCHEMA = "boop.action-record";
export const VERSION = 3;
export const RECEIPT_SCHEMA = "boop.action-receipt";
export const MAX_DELEGATION_TTL_MS = 31 * 24 * 3600 * 1000; // D12: 30 days, plus slack
const SKEW_MS = 5 * 60 * 1000;

const digestHex = text => bytesToHex(sha256(utf8ToBytes(text)));
const signingInput = (domain, payload) => concatBytes(sha256(utf8ToBytes(domain)), sha256(utf8ToBytes(payload)));
const sig = bytes => `z${base58.encode(bytes)}`;
const unsig = text => { try { return base58.decode(text.slice(1)); } catch { return null; } };

/**
 * The root every delegation by `ownerDid` hangs from. A root zCap is implied,
 * not signed: in PWS the server knows who controls a target. Offline nobody
 * does, so the target has to name its controller. Here it is the owner's DID
 * as one path segment, and the verifier derives the root controller from it.
 */
export const ownerRootTarget = (origin, ownerDid) => `${origin}/lws/${encodeURIComponent(ownerDid)}/`;
function ownerOfRootTarget(target) {
  const match = /^https?:\/\/[^/]+\/lws\/([^/]+)\/$/.exec(target);
  return match ? decodeURIComponent(match[1]) : null;
}

export const zcapDigest = zcap => digestHex(canonicalize(zcap));

export function buildAgentRecord({ change, agentDid, ownerDid, zcap, signedAt }) {
  const payload = canonicalize({
    schema: SCHEMA, version: VERSION,
    action: change.action, subject: change.subject, after: change.after,
    author: { did: agentDid, verificationMethod: `${agentDid}#${agentDid.slice("did:key:".length)}` },
    onBehalfOf: { did: ownerDid },
    delegation: { id: zcap.id, digest: zcapDigest(zcap) },
    signedAt,
  });
  return { payload, digest: digestHex(payload) };
}

export async function signAgentRecord(built, zcap, signBytes) {
  return { ...built, status: "signed", signature: sig(await signBytes(signingInput(`${SCHEMA}/v${VERSION}`, built.payload))), delegation: [zcap] };
}

/** Stand-in for P3's `signReceipt(recordHash, receivedAt)`. */
export function signReceipt({ recordDigest, receivedAt, service }) {
  const payload = canonicalize({ schema: RECEIPT_SCHEMA, version: 1, recordDigest, receivedAt, signer: service.verificationMethod });
  return { payload, signature: sig(ed.sign(signingInput(`${RECEIPT_SCHEMA}/v1`, payload), service.secretKey)) };
}

// ---------------------------------------------------------------------------
// Owner DID state at a point in time, from a did:webvh log the caller resolved.

/** The log entry in force at `atMs`: the last one whose versionTime is not after it. */
export function didStateAt(log, atMs) {
  let state = null;
  for (const entry of log) {
    if (Date.parse(entry.versionTime) > atMs) break;
    state = entry.state;
  }
  return state ? absolutizeDidDocument(state) : null;
}

/** `verificationMethod`'s Ed25519 key if `document` lists it under `relationship`. */
function keyUnder(document, relationship, verificationMethod) {
  if (!(document[relationship] ?? []).includes(verificationMethod)) return null;
  const method = (document.verificationMethod ?? []).find(vm => vm.id === verificationMethod);
  return method?.type === "Multikey" && typeof method.publicKeyMultibase === "string" ? multikeyBytes(method.publicKeyMultibase) : null;
}

// ---------------------------------------------------------------------------
// The checks both verifiers share: everything except the zCap's own proof.

/**
 * @param record   { payload, digest, signature, delegation: [zcap], receipt? }
 * @param options  { resolveDidLog(did) -> parsed did.jsonl entries (validated by the caller),
 *                   serviceKeys: { [verificationMethod]: Uint8Array },   Boop service keys the caller trusts
 *                   revokedAt?: { [zcapId]: ms }                         revocations the caller knows of
 *                   verifyDelegationProof(zcap, ownerDocument, rootTarget, atMs) -> true | string }
 */
async function verifyRecord(record, options) {
  const fail = reason => ({ verified: false, reason });
  let payload;
  try { payload = JSON.parse(record.payload); } catch { return fail("malformed_payload"); }
  if (payload?.schema !== SCHEMA || payload.version !== VERSION) return fail("unsupported_version");
  if (canonicalize(payload) !== record.payload) return fail("non_canonical_payload");
  if (digestHex(record.payload) !== record.digest) return fail("digest_mismatch");

  // 1. The agent signed it. A did:key is its own key; nothing to resolve.
  const { author, onBehalfOf, delegation } = payload;
  if (typeof author?.did !== "string" || !author.did.startsWith("did:key:z6Mk")
    || author.verificationMethod !== `${author.did}#${author.did.slice(8)}`) return fail("malformed_author");
  const signature = unsig(record.signature ?? "");
  if (signature?.length !== 64) return fail("not_signed");
  if (!ed.verify(signature, signingInput(`${SCHEMA}/v${VERSION}`, record.payload), multikeyBytes(author.did.slice(8)))) return fail("bad_signature");

  // 2. The delegation it names is the one supplied, and it is for this agent, this owner, this action.
  const zcap = record.delegation?.[0];
  if (!zcap || record.delegation.length !== 1) return fail("no_delegation");
  if (zcap.id !== delegation?.id || zcapDigest(zcap) !== delegation?.digest) return fail("delegation_mismatch");
  if (zcap.controller !== author.did) return fail("delegation_not_for_author");
  const rootTarget = decodeURIComponent(String(zcap.parentCapability).replace(/^urn:zcap:root:/, ""));
  if (zcap.parentCapability !== rootZcapId(rootTarget) || ownerOfRootTarget(rootTarget) !== onBehalfOf?.did) return fail("delegation_not_from_owner");
  if (!String(zcap.invocationTarget).startsWith(rootTarget)) return fail("delegation_target_outside_root");
  const allowed = [zcap.allowedAction ?? []].flat();
  if (!allowed.includes(payload.action)) return fail("action_not_delegated");

  // 3. Boop's receipt places the record in time (D10). The agent's own signedAt is not trusted for this.
  if (!record.receipt) return fail("no_receipt");
  let receipt;
  try { receipt = JSON.parse(record.receipt.payload); } catch { return fail("malformed_receipt"); }
  const serviceKey = options.serviceKeys?.[receipt?.signer];
  const receiptSignature = unsig(record.receipt.signature ?? "");
  if (receipt?.schema !== RECEIPT_SCHEMA || canonicalize(receipt) !== record.receipt.payload || !serviceKey || receiptSignature?.length !== 64
    || !ed.verify(receiptSignature, signingInput(`${RECEIPT_SCHEMA}/v1`, record.receipt.payload), serviceKey)) return fail("bad_receipt");
  if (receipt.recordDigest !== record.digest) return fail("receipt_for_another_record");
  const receivedAt = receipt.receivedAt;

  // 4. The delegation was in force when Boop received the record: not expired, not yet revoked.
  const created = Date.parse(zcap.proof?.created ?? "");
  const expires = Date.parse(zcap.expires ?? "");
  if (!Number.isFinite(created) || !Number.isFinite(expires) || expires < created) return fail("malformed_delegation");
  if (expires - created > MAX_DELEGATION_TTL_MS) return fail("delegation_too_long");
  if (receivedAt < created - SKEW_MS) return fail("received_before_delegation");
  if (receivedAt > expires) return fail("received_after_expiry");
  const revokedAt = options.revokedAt?.[zcap.id];
  if (revokedAt !== undefined && receivedAt >= revokedAt) return fail("received_after_revocation");

  // 5. The owner's DID, as it stood when Boop received the record, let this key delegate.
  const log = await options.resolveDidLog(onBehalfOf.did);
  const ownerDocument = log ? didStateAt(log, receivedAt) : null;
  if (!ownerDocument || ownerDocument.id !== onBehalfOf.did) return fail("unknown_owner_did");
  const proofCheck = await options.verifyDelegationProof(zcap, ownerDocument, rootTarget, receivedAt);
  if (proofCheck !== true) return fail(proofCheck);

  return { verified: true, agent: author.did, onBehalfOf: onBehalfOf.did, action: payload.action, receivedAt, delegation: { id: zcap.id, expires: zcap.expires, delegatedBy: zcap.proof.verificationMethod } };
}

// ---------------------------------------------------------------------------
// Verifier A: the zCap's proof and chain rules checked by @interop/zcap.

export function verifyAgentRecordWithLibs(record, options) {
  return verifyRecord(record, {
    ...options,
    async verifyDelegationProof(zcap, ownerDocument, rootTarget, atMs) {
      const suite = () => new DataIntegrityProof({ cryptosuite: createVerifyCryptosuite() });
      const result = await jsigs.verify(zcap, {
        suite: suite(),
        purpose: new CapabilityDelegation({
          suite: suite(), expectedRootCapability: rootZcapId(rootTarget), allowTargetAttenuation: true,
          date: new Date(atMs), // "as of the receipt", not now: this is what lets an expired zCap still verify
          maxChainLength: 2, maxDelegationTtl: MAX_DELEGATION_TTL_MS,
        }),
        documentLoader: staticDidLoader({ [ownerDocument.id]: ownerDocument }, { [rootZcapId(rootTarget)]: rootZcap(rootTarget, ownerDocument.id) }, { absolutize: false }),
      });
      return result.verified ? true : `delegation_proof: ${result.error?.errors?.[0]?.message ?? result.error?.message ?? result.error}`;
    },
  });
}

// ---------------------------------------------------------------------------
// Verifier B: the same proof checked by hand. eddsa-jcs-2022 is
// sha256(JCS(proof options)) || sha256(JCS(document)), Ed25519-signed; the
// chain rules for a one-link chain are the checks in verifyRecord.

export function verifyAgentRecordMinimal(record, options) {
  return verifyRecord(record, {
    ...options,
    verifyDelegationProof(zcap, ownerDocument, rootTarget) {
      const { proof, ...document } = zcap;
      if (!proof || Array.isArray(proof) || proof.type !== "DataIntegrityProof" || proof.cryptosuite !== "eddsa-jcs-2022"
        || proof.proofPurpose !== "capabilityDelegation") return "delegation_proof: not an eddsa-jcs-2022 capabilityDelegation proof";
      if (!Array.isArray(proof.capabilityChain) || proof.capabilityChain.length !== 1 || proof.capabilityChain[0] !== rootZcapId(rootTarget)) return "delegation_proof: chain is not root -> agent";
      if (canonicalize(proof["@context"] ?? null) !== canonicalize(document["@context"] ?? null)) return "delegation_proof: proof context differs from the document's";
      if (typeof proof.verificationMethod !== "string" || !proof.verificationMethod.startsWith(`${ownerDocument.id}#`)) return "delegation_proof: not signed by the owner";
      const key = keyUnder(ownerDocument, "capabilityDelegation", proof.verificationMethod);
      if (!key) return `delegation_proof: ${proof.verificationMethod} is not a capabilityDelegation key of the owner`;
      const { proofValue, ...proofOptions } = proof;
      const signature = unsig(String(proofValue));
      const hashData = concatBytes(sha256(utf8ToBytes(canonicalize(proofOptions))), sha256(utf8ToBytes(canonicalize(document))));
      return signature?.length === 64 && ed.verify(signature, hashData, key) ? true : "delegation_proof: Invalid signature.";
    },
  });
}
