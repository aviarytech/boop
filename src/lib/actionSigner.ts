/**
 * Where mutations pick up the author's action-record signatures (#237).
 *
 * Kept free of the Turnkey stack so the Convex adapter and the offline
 * replayer can import it anywhere; src/main.tsx installs the real signer
 * (src/lib/actionSigning.ts). Without one, mutations go out unsigned and the
 * server records them as such.
 */
import type { ActionSignatureEnvelope } from "../../shared/actionRecord";
import { beginItemEdit, editSessionsEnabled, settleItemEdit } from "./editSessions";

export type ActionSigner = (mutation: string, args: Record<string, unknown>) => Promise<ActionSignatureEnvelope | undefined>;

/** The mutations whose records the author signs (they declare a `signed` argument). */
export const SIGNED_MUTATIONS: ReadonlySet<string> = new Set([
  "addItem", "checkItem", "uncheckItem", "batchCheckItems", "batchUncheckItems", "createList", "renameList",
  "updateItem", "removeItem", "batchDeleteItems",
]);

let signer: ActionSigner | null = null;

export function setActionSigner(next: ActionSigner | null): void {
  signer = next;
}

/** The author's signatures for `mutation` called with `args`, when a signer is installed and can sign now. */
export async function signActionRecords(mutation: string, args: Record<string, unknown>): Promise<ActionSignatureEnvelope | undefined> {
  return signer ? signer(mutation, args) : undefined;
}

/**
 * Sends a mutation with what its action records need. Recorded actions are
 * signed before they are sent. An item save is not signed on its own: it
 * joins the item's edit session, which is signed once when it ends
 * (src/lib/editSessions.ts). Every mutation the app sends goes through here.
 */
export async function sendWithActionRecords<T extends Record<string, unknown>, R>(mutation: string, args: T, send: (args: T) => Promise<R>): Promise<R> {
  const itemId = mutation === "updateItem" && editSessionsEnabled() && args.signed === undefined && args.editSession === undefined
    && typeof args.itemId === "string" ? args.itemId : null;
  if (itemId === null) return send(await withActionSignatures(mutation, args));
  const editSession = beginItemEdit(itemId);
  let saved = false;
  try {
    const result = await send({ ...args, editSession });
    saved = true;
    return result;
  } finally {
    settleItemEdit(itemId, editSession, saved ? args : null);
  }
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
