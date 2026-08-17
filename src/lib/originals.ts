/**
 * Originals SDK wrapper for the Lisa app.
 *
 * Provides a simplified API for:
 * - Asset creation (for lists with did:cel DIDs)
 * - Verifying a persisted asset envelope
 *
 * Note: Credential signing is now handled server-side via Convex actions.
 */

import { OriginalsSDK } from "@originals/sdk";
import type {
  AssetResource,
  DIDDocument,
  VerifiableCredential,
  KeyPair,
  OriginalsConfig,
} from "@originals/sdk";
import { localCelKeyStore, hasCelKey } from "./celKeyStore";

// SDK configuration for testnet/development
const config: OriginalsConfig = {
  network: "signet", // Use signet for development
  defaultKeyType: "Ed25519",
  // Retains each asset's genesis controller key; without it the SDK drops the
  // key after signing genesis and later CEL appends degrade. See celKeyStore.ts.
  keyStore: localCelKeyStore,
};

export interface ListAsset {
  assetDid: string;
  name: string;
  createdBy: string;
  createdAt: string;
  /** Serialized AssetEnvelope — the CEL log is the asset's provenance. */
  envelope: string;
}

/** Lowercase hex SHA-256 — content-addresses the genesis resource. */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build the genesis resource for a list. did:cel genesis requires at least one
 * content-addressed resource, so the list's own metadata is that resource.
 */
export async function buildListResource(
  name: string,
  creatorDid: string,
  createdAt: string
): Promise<AssetResource> {
  const content = JSON.stringify({ name, createdBy: creatorDid, createdAt });
  return {
    id: "list-metadata",
    type: "ListMetadata",
    contentType: "application/json",
    content,
    hash: await sha256Hex(content),
  };
}

/**
 * Creates a new list asset.
 * Each list is represented as a did:cel asset. Genesis is local — it mints a
 * keypair and builds the event log in-process, with no network round-trip — so
 * list creation stays instant and works offline.
 *
 * Returns the serialized envelope alongside the DID. Persist it: the DID alone
 * is an opaque identifier, while the envelope carries the signed event log that
 * makes the asset verifiable.
 *
 * @param name - The name of the list
 * @param creatorDid - The DID of the user creating the list
 * @returns Promise<ListAsset> The created list asset
 */
export async function createListAsset(name: string, creatorDid: string): Promise<ListAsset> {
  const sdk = OriginalsSDK.create(config);
  const createdAt = new Date().toISOString();

  const asset = await sdk.lifecycle.createAsset([
    await buildListResource(name, creatorDid, createdAt),
  ]);

  return {
    assetDid: asset.id,
    name,
    createdBy: creatorDid,
    createdAt,
    envelope: JSON.stringify(asset.serialize()),
  };
}

export interface EnvelopeVerification {
  verified: boolean;
  assetDid?: string;
  warnings: string[];
  error?: string;
}

/**
 * Verify a persisted envelope: replays the signed CEL log, re-checks the
 * resource↔genesis binding and inline content hashes. Fails closed — any
 * tampering surfaces as verified:false rather than throwing at the call site.
 */
export async function verifyListEnvelope(envelope: string): Promise<EnvelopeVerification> {
  const sdk = OriginalsSDK.create(config);
  try {
    const { asset, verification, warnings } = await sdk.lifecycle.loadAsset(envelope);
    return {
      // loadAsset only returns absent `verification` when verification is skipped,
      // which we never request — treat a missing result as unverified, not as pass.
      verified: verification?.verified === true,
      assetDid: asset.id,
      warnings,
    };
  } catch (err) {
    return {
      verified: false,
      warnings: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** A list's published state, as committed to by a version's content hash. */
export interface ListSnapshot {
  name: string;
  items: Array<{ name: string; checked: boolean }>;
}

export interface RecordedVersion {
  /** The asset envelope after the append. Persist it — it is the new log. */
  envelope: string;
  /** 1 is genesis, so a first published version is 2. */
  version: number;
  hash: string;
  /** False when the content matched the current version and nothing was appended. */
  appended: boolean;
}

/**
 * Thrown when a list cannot sign its own events, which is not a bug the user
 * can act on except by copying the list.
 */
export class ListNotAuthorableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ListNotAuthorableError";
  }
}

/**
 * Build the content a published version commits to. Separate from
 * buildListResource because genesis commits to the list's identity while a
 * version commits to what was actually published.
 */
export function buildListSnapshot(
  name: string,
  items: Array<{ name: string; checked: boolean }>
): ListSnapshot {
  return { name, items: items.map(({ name, checked }) => ({ name, checked })) };
}

/**
 * Append a signed snapshot of the list's published state to its CEL log.
 *
 * Publishing used to leave no trace in the chain that exists to record an
 * asset's history — the `publications` row knew, the log did not. This appends
 * a content-addressed `update` event so the published state is verifiable.
 *
 * Stays on did:cel deliberately: publishToWeb would migrate the asset to
 * did:webvh, changing its DID and moving its public URL to a content-addressed
 * key, and boop serves published lists live at a stable path.
 *
 * Signing needs the genesis controller key, which lives in this device's
 * keyStore. Lists re-minted by the celAssetDids migration have no key at all —
 * they get ListNotAuthorableError rather than the SDK's CEL_APPEND_FAILED, so
 * the caller can point at the copy action instead of showing a raw SDK error.
 */
export async function recordPublishedVersion(
  envelope: string,
  snapshot: ListSnapshot,
  changes = "Published to the web"
): Promise<RecordedVersion> {
  const sdk = OriginalsSDK.create(config);
  const { asset } = await sdk.lifecycle.loadAsset(envelope);

  if (!(await canAuthorList(asset.id))) {
    throw new ListNotAuthorableError(
      "This list's signing key isn't on this device, so its history can't be updated."
    );
  }

  const content = JSON.stringify(snapshot);

  try {
    const resource = await asset.addResourceVersion(
      "list-metadata",
      content,
      "application/json",
      changes
    );
    return {
      envelope: JSON.stringify(asset.serialize()),
      version: resource.version ?? 0,
      hash: resource.hash,
      appended: true,
    };
  } catch (err) {
    // Re-publishing an unchanged list is a no-op, not a failure. The SDK
    // refuses a version identical to the current one.
    if (err instanceof Error && /unchanged|identical|same content/i.test(err.message)) {
      const current = asset.resources.find((r) => r.id === "list-metadata");
      return {
        envelope,
        version: current?.version ?? 0,
        hash: current?.hash ?? "",
        appended: false,
      };
    }
    throw err;
  }
}

/**
 * When the genesis event's proof was signed.
 *
 * Distinct from the list's own createdAt: the celAssetDids migration minted
 * genesis for existing lists, so it committed to the list's real creation date
 * while signing the log on the migration's clock. That gap is the only
 * server-observable difference between a migrated list and a client-minted one.
 */
export function genesisSealedAt(envelope: string): number | null {
  try {
    const proof = JSON.parse(envelope)?.eventLog?.events?.[0]?.proof;
    const created = (Array.isArray(proof) ? proof[0] : proof)?.created;
    const ms = created ? Date.parse(created) : NaN;
    return Number.isNaN(ms) ? null : ms;
  } catch {
    return null;
  }
}

/** Genesis sealed this long after list creation counts as a re-genesis. */
const RETROACTIVE_GENESIS_MS = 60_000;

/**
 * True when this list's log was sealed well after the list already existed —
 * i.e. the migration minted it, so no one holds its controller key and it can
 * never author another event. Copying is the only way to get an authorable list.
 */
export function isRetroactiveGenesis(envelope: string, listCreatedAt: number): boolean {
  const sealed = genesisSealedAt(envelope);
  return sealed !== null && sealed - listCreatedAt > RETROACTIVE_GENESIS_MS;
}

/**
 * True when THIS DEVICE holds the list's genesis key. Custody is per-origin
 * localStorage, so a client-minted list is unauthorable from a second device
 * too — which is a different problem from a migrated list, and not one copying
 * should be offered for.
 */
export async function canAuthorList(assetDid: string): Promise<boolean> {
  return hasCelKey(`${assetDid}#key-0`);
}

// Re-export types that consumers might need
export type { DIDDocument, VerifiableCredential, KeyPair };
