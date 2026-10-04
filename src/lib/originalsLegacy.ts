/** Compatibility for saved pre-CEL-3 histories. Never use this SDK for new assets. */
import { OriginalsSDK } from "@originals/sdk-legacy";
import { localCelKeyStore } from "./celKeyStore";
import { canAuthorList, ListNotAuthorableError } from "./originals";
import type { EnvelopeVerification, ListSnapshot, RecordedVersion } from "./originals";
const config = { network: "signet" as const, defaultKeyType: "Ed25519" as const, keyStore: localCelKeyStore };

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
