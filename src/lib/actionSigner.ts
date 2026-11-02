/**
 * Where mutations pick up the author's action-record signatures (#237).
 *
 * Kept free of the Turnkey stack so the Convex adapter and the offline
 * replayer can import it anywhere; src/main.tsx installs the real signer
 * (src/lib/actionSigning.ts). Without one, mutations go out unsigned and the
 * server records them as such.
 */
import type { ActionSignatureEnvelope } from "../../shared/actionRecord";

export type ActionSigner = (mutation: string, args: Record<string, unknown>) => Promise<ActionSignatureEnvelope | undefined>;

/** The mutations whose records the author signs (they declare a `signed` argument). */
export const SIGNED_MUTATIONS: ReadonlySet<string> = new Set([
  "addItem", "checkItem", "uncheckItem", "batchCheckItems", "batchUncheckItems", "createList", "renameList",
]);

let signer: ActionSigner | null = null;

export function setActionSigner(next: ActionSigner | null): void {
  signer = next;
}

/**
 * `args` with the author's signatures attached when `mutation` records
 * actions and a signer is installed. Signing never fails the call: a signer
 * that cannot sign now returns undefined and the record is written unsigned.
 */
export async function withActionSignatures<T extends Record<string, unknown>>(mutation: string, args: T): Promise<T> {
  if (!signer || !SIGNED_MUTATIONS.has(mutation) || args.signed !== undefined) return args;
  const signed = await signer(mutation, args);
  return signed ? { ...args, signed } : args;
}
