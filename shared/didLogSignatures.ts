/**
 * Signature and parameter checks for a did:webvh log that boop accepts (#286),
 * shared by the server (convex/lib/authorDidLog.ts) and the client
 * (src/lib/authorDid.ts inspectAuthorDid).
 *
 * didwebvh-ts 2.8 accepts an entry whose `proof` is an empty array, i.e. no
 * signature at all, so this checks every proof itself.
 */
import { multibaseDecode, parseDidKeyVerificationMethod, prepareDataForSigning } from "didwebvh-ts";
import type { DIDLog } from "didwebvh-ts";
import { verifyAsync } from "@noble/ed25519";
import { ALLOWED_LOG_PARAMETERS } from "./authorDid";

export class DidLogRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DidLogRejectedError";
  }
}

const ED25519_MULTIKEY_PREFIX = [0xed, 0x01];

type Entry = { versionId?: string; parameters?: Record<string, unknown>; proof?: unknown };

/**
 * Every entry carries at least one proof, and every proof is an Ed25519
 * signature over the entry by an update key in force for it: the genesis
 * entry's own, then the latest updateKeys before each later entry.
 */
export async function requireSignedByUpdateKeys(log: DIDLog): Promise<void> {
  let updateKeys: string[] = [];
  for (const [index, raw] of (log as Entry[]).entries()) {
    const what = `Entry ${index + 1}`;
    const parameters = raw.parameters ?? {};
    // An allowlist, so a parameter didwebvh-ts acts on (e.g. the legacy
    // `witnesses`, which makes it fetch from the DID's domain) can't slip by.
    for (const name of Object.keys(parameters)) {
      if (!ALLOWED_LOG_PARAMETERS.has(name)) throw new DidLogRejectedError(`${what} sets ${name}, which boop DIDs don't use`);
    }
    // didwebvh-ts writes `witness: {}` for none; anything with members is a witness rule.
    const witness = parameters.witness;
    if (witness !== undefined && witness !== null && (typeof witness !== "object" || Object.keys(witness).length > 0)) {
      throw new DidLogRejectedError(`${what} uses witnesses, which boop DIDs don't`);
    }
    if (Array.isArray(parameters.watchers) && parameters.watchers.length > 0) throw new DidLogRejectedError(`${what} names watchers, which boop DIDs don't use`);
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

