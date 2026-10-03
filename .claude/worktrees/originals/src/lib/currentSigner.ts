/**
 * The signer for the logged-in user, if they currently have one.
 *
 * Returns null rather than throwing when there is no live Turnkey session —
 * expired, never minted, or offline. Callers must handle that: it is the normal
 * state on a plane or in a shop with no signal, and losing the user's edit is
 * never the right answer. Queue the work and sign it when a session returns.
 */

import type { RawEd25519Signer } from "./originalsSigner";
import { createSessionSigner, loadSigningSession } from "./turnkeySession";

export async function getCurrentSigner(): Promise<RawEd25519Signer | null> {
  const session = await loadSigningSession();
  return session ? createSessionSigner(session) : null;
}

/** For paths that genuinely cannot proceed unsigned. */
export async function requireSigner(): Promise<RawEd25519Signer> {
  const signer = await getCurrentSigner();
  if (!signer) {
    throw new Error(
      "No Turnkey signing session — sign in again to create verifiable assets"
    );
  }
  return signer;
}
