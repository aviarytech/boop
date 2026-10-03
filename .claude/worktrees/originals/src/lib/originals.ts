/**
 * Originals assets for the Lisa app.
 *
 * A list is an asset with its own did:cel, genesis-signed by the user's Turnkey
 * key. Items are NOT assets — they are claims recorded on their list's log (see
 * listLog.ts), which keeps authority with the list's controller so an owner is
 * never blocked by a collaborator on their own list.
 *
 * Built on `OriginalsCel` rather than `LifecycleManager`: the latter requires a
 * KeyStore that hands back a raw private key, and Turnkey never exports one.
 * See originalsSigner.ts for the seam.
 */

import {
  OriginalsCel,
  createExternalReference,
  deriveDidCel,
  verifyEventLog,
} from "@originals/sdk";
import { parseEventLogJson, serializeEventLogJson } from "@originals/sdk/cel/serialization/json";
import type { EventLog } from "@originals/sdk";
import type { RawEd25519Signer } from "./originalsSigner";
import { createCelSigner, verificationMethodId } from "./originalsSigner";

/** An asset's genesis output: the DID plus the log that proves it. */
export interface OriginalsAssetRecord {
  assetDid: string;
  /** Serialized CEL EventLog — the asset's provenance. */
  eventLog: string;
}

export interface ListAsset extends OriginalsAssetRecord {
  name: string;
  createdBy: string;
  createdAt: string;
}

function celFor(signer: RawEd25519Signer): OriginalsCel {
  return new OriginalsCel({
    layer: "peer",
    signer: createCelSigner(signer),
    config: { peer: { verificationMethod: verificationMethodId(signer) } },
  });
}

/**
 * did:cel genesis requires at least one content-addressed resource, so an
 * asset's own metadata is that resource.
 */
function metadataReference(metadata: Record<string, unknown>) {
  return createExternalReference(
    new TextEncoder().encode(JSON.stringify(metadata)),
    "application/json"
  );
}

/**
 * Create a list asset.
 *
 * Requires a live signing session: unlike the old localStorage-key genesis this
 * makes a network call to Turnkey, so it can fail offline. Callers must be able
 * to defer or surface that rather than losing the list.
 */
export async function createListAsset(
  name: string,
  creatorDid: string,
  signer: RawEd25519Signer
): Promise<ListAsset> {
  const createdAt = new Date().toISOString();
  const { log, did } = await celFor(signer).create(name, [
    metadataReference({ name, createdBy: creatorDid, createdAt }),
  ]);

  return {
    assetDid: did,
    name,
    createdBy: creatorDid,
    createdAt,
    eventLog: serializeEventLogJson(log),
  };
}

/** Append a signed event to an asset's log. Only its controller can. */
export async function appendAssetEvent(
  storedLog: string,
  data: unknown,
  signer: RawEd25519Signer
): Promise<string> {
  const updated = await celFor(signer).update(parseStoredLog(storedLog), data);
  return serializeEventLogJson(updated);
}

/**
 * Read a stored log.
 *
 * Accepts both the current EventLog form and the AssetEnvelope written before
 * Turnkey custody — the envelope embeds the log verbatim, so pre-migration
 * lists stay readable and verifiable. They are not authorable: their genesis
 * key is a localStorage key that only ever existed on one device.
 */
export function parseStoredLog(stored: string): EventLog {
  const parsed = JSON.parse(stored) as { eventLog?: unknown; events?: unknown };
  if (parsed.eventLog) {
    return parseEventLogJson(JSON.stringify(parsed.eventLog));
  }
  return parseEventLogJson(stored);
}

export interface LogVerification {
  verified: boolean;
  assetDid?: string;
  errors: string[];
}

/**
 * Replay a stored log and check every signature and chain link. Fails closed —
 * tampering surfaces as verified:false rather than throwing at the call site.
 *
 * Takes no signer: verification is a pure read, so anyone can check anyone
 * else's asset without holding a key.
 */
export async function verifyAssetLog(stored: string): Promise<LogVerification> {
  try {
    const log = parseStoredLog(stored);
    const result = await verifyEventLog(log);
    return {
      verified: result.verified === true,
      assetDid: deriveDidCel(log),
      errors: result.errors ?? [],
    };
  } catch (err) {
    return {
      verified: false,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}
