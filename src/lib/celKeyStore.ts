/**
 * localStorage-backed KeyStore for did:cel list assets.
 *
 * The v4 wrapper persists each local signer's secret under `<assetId>#key-0`
 * and reconstructs a CelSigner when publishing. The legacy SDK uses the same
 * KeyStore for existing pre-CEL-3 assets.
 *
 * Custody matches the did:webvh keys in webvh.ts: raw hex in localStorage,
 * per-origin, never sent to the server.
 */

import type { KeyStore } from "@originals/sdk";

const KEY_STORAGE_PREFIX = "lisa-cel-ed25519";

function storageKey(verificationMethodId: string): string {
  return `${KEY_STORAGE_PREFIX}:${verificationMethodId}`;
}

/**
 * The legacy SDK registers both the did:key VM and `<did>#key-0`.
 * New v4 assets need only the per-asset entry.
 */
export const localCelKeyStore: KeyStore = {
  async getPrivateKey(verificationMethodId: string): Promise<string | null> {
    try {
      return localStorage.getItem(storageKey(verificationMethodId));
    } catch {
      return null; // private-mode / disabled storage: degrade to verify-only
    }
  },

  async setPrivateKey(verificationMethodId: string, privateKey: string): Promise<void> {
    try {
      localStorage.setItem(storageKey(verificationMethodId), privateKey);
    } catch {
      // Quota or disabled storage. The asset is still created and verifiable;
      // it just cannot author later CEL events from this device.
    }
  },
};

/** True when this device holds the signing key for a verification method. */
export async function hasCelKey(verificationMethodId: string): Promise<boolean> {
  return (await localCelKeyStore.getPrivateKey(verificationMethodId)) !== null;
}
