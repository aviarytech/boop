"use node";

/**
 * What a stored did:webvh log may be replaced with (#286).
 *
 * A did.jsonl is what the world resolves to learn an author's keys, so a write
 * must be a valid continuation of what is already served: the same SCID, the
 * stored entries unchanged, and every entry, new ones included, signed by the
 * update keys in force before it. didwebvh-ts checks that last part while
 * resolving; this module checks the rest and that resolution reached the last
 * entry rather than stopping at a valid prefix.
 *
 * A new SCID is a re-genesis, never a continuation; only /api/user/remintDid
 * accepts one, and only for an account that does not have an author DID yet.
 *
 * Signatures are checked here as well as by didwebvh-ts, which accepts an
 * entry whose `proof` is an empty array (2.8.0 documentStateIsValid), i.e.
 * no signature at all (#300 review). boop's DIDs use neither witnesses nor
 * pre-rotation, so logs with either are refused rather than half-checked.
 *
 * A Node module because didwebvh-ts is (it is only imported by
 * convex/didLogValidation.ts). Pure, so tests import it directly.
 */
import { multibaseDecode, parseDidKeyVerificationMethod, prepareDataForSigning, resolveDIDFromLog } from "didwebvh-ts";
import type { DIDLog } from "didwebvh-ts";
import { verifyAsync } from "@noble/ed25519";
import { authorDidProblems } from "../../shared/authorDid";

export class DidLogRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DidLogRejectedError";
  }
}

export interface CheckedDidLog {
  did: string;
  scid: string;
  versionId: string;
  entries: number;
  /** Empty when the latest version is an author DID (shared/authorDid.ts). */
  authorProblems: string[];
}

const verifier = {
  verify: (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) =>
    verifyAsync(signature, message, publicKey.length === 33 ? publicKey.slice(1) : publicKey),
};

function parse(jsonl: string, what: string): DIDLog {
  const lines = jsonl.split("\n").filter(line => line.trim());
  if (lines.length === 0) throw new DidLogRejectedError(`${what} is empty`);
  try {
    return lines.map(line => JSON.parse(line));
  } catch {
    throw new DidLogRejectedError(`${what} is not JSON Lines`);
  }
}

const scidOf = (log: DIDLog) => String((log[0] as { parameters?: { scid?: unknown } }).parameters?.scid ?? "");

const ED25519_MULTIKEY_PREFIX = [0xed, 0x01];

type Entry = { versionId?: string; parameters?: Record<string, unknown>; proof?: unknown };

/**
 * Every entry carries at least one proof, and every proof is an Ed25519
 * signature over the entry by an update key in force for it: the genesis
 * entry's own, then the latest updateKeys before each later entry.
 */
async function requireSignedByUpdateKeys(log: DIDLog): Promise<void> {
  let updateKeys: string[] = [];
  for (const [index, raw] of (log as Entry[]).entries()) {
    const what = `Entry ${index + 1}`;
    const parameters = raw.parameters ?? {};
    const witness = parameters.witness as { witnesses?: unknown[] } | null | undefined;
    if (witness && Array.isArray(witness.witnesses) && witness.witnesses.length > 0) throw new DidLogRejectedError(`${what} uses witnesses, which boop DIDs don't`);
    if (Array.isArray(parameters.nextKeyHashes) && parameters.nextKeyHashes.length > 0) throw new DidLogRejectedError(`${what} uses pre-rotation, which boop DIDs don't`);
    const authorized = index === 0 ? parameters.updateKeys : updateKeys;
    if (!Array.isArray(authorized) || authorized.length === 0) throw new DidLogRejectedError(`${what} has no update keys to be signed by`);
    const { proof, ...document } = raw as Record<string, unknown>;
    if (!Array.isArray(proof) || proof.length === 0) throw new DidLogRejectedError(`${what} is not signed`);
    for (const item of proof as Array<Record<string, unknown>>) {
      const { proofValue, ...options } = item ?? {};
      let key: string;
      try { key = parseDidKeyVerificationMethod(String(options.verificationMethod)).keyMultibase; }
      catch { throw new DidLogRejectedError(`${what} is signed by something other than a did:key`); }
      if (!authorized.includes(key)) throw new DidLogRejectedError(`${what} is signed by a key that is not an update key`);
      const publicKey = multibaseDecode(key).bytes;
      if (publicKey.length !== 34 || publicKey[0] !== ED25519_MULTIKEY_PREFIX[0] || publicKey[1] !== ED25519_MULTIKEY_PREFIX[1]) {
        throw new DidLogRejectedError(`${what} is signed by a key that is not Ed25519`);
      }
      let valid = false;
      try {
        const data = await prepareDataForSigning(document, options as never);
        valid = await verifyAsync(multibaseDecode(String(proofValue)).bytes, data, publicKey.slice(2));
      } catch { valid = false; }
      if (!valid) throw new DidLogRejectedError(`${what} has a signature that does not verify`);
    }
    if (Array.isArray(parameters.updateKeys)) updateKeys = parameters.updateKeys as string[];
  }
}

export interface CheckOptions {
  /** The only domain a stored DID may name (WEBVH_DOMAIN). */
  domain?: string;
  /** This account's Turnkey keys as Multikeys; the DID is an author DID only if it uses exactly these. */
  keys?: { authorKey?: string; assertionKey?: string };
}

/** Resolve `jsonl` in full, or throw. */
export async function checkDidLog(jsonl: string, options: CheckOptions = {}): Promise<CheckedDidLog> {
  const log = parse(jsonl, "The DID log");
  await requireSignedByUpdateKeys(log);
  let resolved;
  try {
    resolved = await resolveDIDFromLog(log, { verifier });
  } catch (error) {
    throw new DidLogRejectedError(`The DID log does not verify: ${error instanceof Error ? error.message : String(error)}`);
  }
  const last = (log[log.length - 1] as { versionId?: string }).versionId;
  if (resolved.meta.versionId !== last) {
    throw new DidLogRejectedError(`The DID log only verifies up to ${resolved.meta.versionId}`);
  }
  if (resolved.meta.deactivated || !resolved.doc) throw new DidLogRejectedError("The DID is deactivated");
  if (options.domain) {
    const domain = decodeURIComponent(resolved.did.split(":")[3] ?? "");
    if (domain !== options.domain) throw new DidLogRejectedError(`The DID names ${domain}, not ${options.domain}`);
  }
  const keys = options.keys;
  const authorProblems = authorDidProblems(resolved.doc, resolved.meta.updateKeys, keys ?? {});
  // Without both keys pinned, nothing counts as this account's author DID.
  if (!keys?.authorKey || !keys.assertionKey) authorProblems.push("this account's Turnkey keys are unknown");
  return { did: resolved.did, scid: scidOf(log), versionId: resolved.meta.versionId, entries: log.length, authorProblems };
}

/**
 * Check `next` may replace `stored` (null when nothing is served yet).
 * Rewriting history, a different SCID, or an entry not signed by the update
 * keys before it is refused.
 */
export async function checkDidLogWrite(stored: string | null, next: string, options: CheckOptions = {}): Promise<CheckedDidLog> {
  const checked = await checkDidLog(next, options);
  if (stored === null) return checked;
  const before = parse(stored, "The stored DID log");
  const after = parse(next, "The DID log");
  if (scidOf(before) !== checked.scid) {
    throw new DidLogRejectedError("A new SCID is a new DID, not an update to this one");
  }
  if (after.length < before.length) throw new DidLogRejectedError("The DID log drops entries that are already served");
  for (let i = 0; i < before.length; i += 1) {
    if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) {
      throw new DidLogRejectedError(`The DID log rewrites served entry ${i + 1}`);
    }
  }
  return checked;
}
