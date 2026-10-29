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
import { resolveDIDFromLog } from "didwebvh-ts";
import type { DIDLog } from "didwebvh-ts";
import { verifyAsync } from "@noble/ed25519";
import { authorLogProblems } from "../../shared/authorDid";
import { DidLogRejectedError, parseCanonicalDidLog, requireSignedByUpdateKeys } from "../../shared/didLogSignatures";

export { DidLogRejectedError };

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

const parse = (jsonl: string, what: string): DIDLog => parseCanonicalDidLog(jsonl, what);

const scidOf = (log: DIDLog) => String((log[0] as { parameters?: { scid?: unknown } }).parameters?.scid ?? "");

export interface CheckOptions {
  /** The only domain a stored DID may name (WEBVH_DOMAIN). */
  domain?: string;
  /** This account's Turnkey keys as Multikeys; the DID is an author DID only if it uses exactly these. */
  keys?: { authorKey?: string; assertionKey?: string };
}

/** Resolve `jsonl` in full, or throw. */
export async function checkDidLog(jsonl: string, options: CheckOptions = {}): Promise<CheckedDidLog> {
  const log = parse(jsonl, "The DID log");
  // Before anything resolves (or fetches): every version names a DID on our domain.
  if (options.domain) {
    for (const [index, entry] of (log as Array<{ state?: { id?: unknown } }>).entries()) {
      let domain: string;
      try { domain = decodeURIComponent(String(entry.state?.id ?? "").split(":")[3] ?? ""); }
      catch { throw new DidLogRejectedError(`Entry ${index + 1} names a malformed domain`); }
      if (domain !== options.domain) throw new DidLogRejectedError(`Entry ${index + 1} names ${domain || "no DID"}, not ${options.domain}`);
    }
  }
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
  const keys = options.keys;
  // Every version, not just the latest: a key in any version could have signed as the author.
  const authorProblems = authorLogProblems(log as never, keys ?? {});
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
  // Byte for byte: served bytes are what readers hold, and they must not change.
  const servedBytes = stored.endsWith("\n") ? stored.slice(0, -1) : stored;
  const nextBytes = next.endsWith("\n") ? next.slice(0, -1) : next;
  if (nextBytes !== servedBytes && !nextBytes.startsWith(`${servedBytes}\n`)) {
    throw new DidLogRejectedError("The DID log rewrites entries that are already served");
  }
  return checked;
}
