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
 * A Node module because didwebvh-ts is (it is only imported by
 * convex/didLogValidation.ts). Pure, so tests import it directly.
 */
import { resolveDIDFromLog } from "didwebvh-ts";
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

/** Resolve `jsonl` in full, or throw. */
export async function checkDidLog(jsonl: string): Promise<CheckedDidLog> {
  const log = parse(jsonl, "The DID log");
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
  return {
    did: resolved.did,
    scid: scidOf(log),
    versionId: resolved.meta.versionId,
    entries: log.length,
    authorProblems: authorDidProblems(resolved.doc, resolved.meta.updateKeys),
  };
}

/**
 * Check `next` may replace `stored` (null when nothing is served yet).
 * Rewriting history, a different SCID, or an entry not signed by the update
 * keys before it is refused.
 */
export async function checkDidLogWrite(stored: string | null, next: string): Promise<CheckedDidLog> {
  const checked = await checkDidLog(next);
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
