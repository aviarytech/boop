/**
 * Whether a list's provenance is "legacy" — sealed by the celAssetDids
 * migration rather than minted by its owner.
 *
 * Those lists got their genesis server-side with an ephemeral controller, so
 * nobody holds the signing key and they can never record another CEL event.
 * The only server-observable signal is the gap between when the genesis proof
 * was signed and when the list itself was created: a client mint signs within
 * seconds, a migration signs months later.
 *
 * Mirrors isRetroactiveGenesis in src/lib/originals.ts. Duplicated because
 * Convex modules cannot import from src/ — the test asserts they agree.
 */

/** Genesis sealed more than this long after list creation is a re-genesis. */
export const RETROACTIVE_GENESIS_MS = 60_000;

/** When the genesis event's proof was signed, or null if unreadable. */
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

export function isLegacyGenesis(sealedAt: number | null, listCreatedAt: number): boolean {
  return sealedAt !== null && sealedAt - listCreatedAt > RETROACTIVE_GENESIS_MS;
}
