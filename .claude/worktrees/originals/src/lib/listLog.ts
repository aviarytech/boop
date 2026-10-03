/**
 * A list's asset log — the record of everything on it.
 *
 * The list is the asset. An item is not an asset; it is a claim recorded on the
 * list's log. That keeps authority in one place: the list's controller can act
 * on every item, including ones other people added, and never waits on anyone
 * to finalise their own list.
 *
 * CEL is single-writer, so a collaborator cannot append. They sign an
 * ItemClaimCredential and the list's controller folds it in on next sync — the
 * controller's signature attests the event happened on their asset, the
 * embedded credential attests who actually did it. A guest's action is
 * therefore provable immediately but reaches the log only once the owner syncs.
 *
 * The action vocabulary is closed (see ITEM_ACTIONS). One log carries both
 * content and control events, so an open vocabulary would let a content write
 * forge a control event — the same reason the SDK reserves its migration fields
 * and refuses them in ordinary updates.
 */

import { deriveDidCel } from "@originals/sdk";
import { currentControllerVm } from "@originals/sdk/cel/signerAdapter";
import type { VerifiableCredential } from "@originals/sdk";
import type { RawEd25519Signer } from "./originalsSigner";
import { verificationMethodId } from "./originalsSigner";
import { appendAssetEvent, parseStoredLog } from "./originals";
import { isItemAction, issueItemClaim, verifyCredential } from "./credentials";
import type { ItemAction } from "./credentials";

/** State of one item, folded from the list's log. */
export interface ItemState {
  itemId: string;
  name?: string;
  checked: boolean;
  checkedBy?: string;
  checkedAt?: string;
  removed: boolean;
  addedBy?: string;
}

interface ItemEventData {
  action?: string;
  itemId?: string;
  itemName?: string;
  by?: string;
  at?: string;
  /** Present when the controller relayed someone else's signed claim. */
  credential?: VerifiableCredential;
}

export type RecordResult =
  /** The actor controls the list; the event is on the log already. */
  | { kind: "appended"; eventLog: string }
  /** The actor cannot append; this signed claim awaits the controller. */
  | { kind: "claimed"; credential: VerifiableCredential };

export interface RecordParams {
  storedLog: string;
  itemId: string;
  action: ItemAction;
  actorDid: string;
  signer: RawEd25519Signer;
  itemName?: string;
  at?: string;
}

/** The VC data model allows `issuer` as either a DID string or an object. */
function issuerDid(credential: VerifiableCredential): string | undefined {
  const issuer = credential.issuer as string | { id?: string } | undefined;
  return typeof issuer === "string" ? issuer : issuer?.id;
}

/** True when this signer may append to the list's log. */
export function isController(storedLog: string, signer: RawEd25519Signer): boolean {
  try {
    return currentControllerVm(parseStoredLog(storedLog)) === verificationMethodId(signer);
  } catch {
    return false;
  }
}

/**
 * Record an item action.
 *
 * `appended` for the list's controller, `claimed` for everyone else — callers
 * must handle both, because the same tap produces a different artifact
 * depending on whose list it is.
 */
export async function recordItemAction(params: RecordParams): Promise<RecordResult> {
  if (!isItemAction(params.action)) {
    throw new Error(`Unknown item action: ${String(params.action)}`);
  }

  const at = params.at ?? new Date().toISOString();

  if (isController(params.storedLog, params.signer)) {
    const data: ItemEventData = {
      action: params.action,
      itemId: params.itemId,
      by: params.actorDid,
      at,
    };
    if (params.itemName !== undefined) data.itemName = params.itemName;

    return {
      kind: "appended",
      eventLog: await appendAssetEvent(params.storedLog, data, params.signer),
    };
  }

  return {
    kind: "claimed",
    credential: await issueItemClaim({
      listDid: deriveDidCel(parseStoredLog(params.storedLog)),
      itemId: params.itemId,
      action: params.action,
      actorDid: params.actorDid,
      itemName: params.itemName,
      signer: params.signer,
      issuedAt: at,
    }),
  };
}

/**
 * Fold a collaborator's signed claim into the list's log.
 *
 * Verified and subject-bound before it is appended: the controller's signature
 * would otherwise launder a forged claim — or a genuine claim about a different
 * list — into this asset's history, where no later reader could tell.
 *
 * The list DID is DERIVED, never read off the genesis event. A did:cel is the
 * hash of that event, so the DID is deliberately not inside it; reading it from
 * the event data yields undefined and silently disables the check.
 */
export async function foldInClaim(
  storedLog: string,
  credential: VerifiableCredential,
  signer: RawEd25519Signer
): Promise<string> {
  const subject = credential.credentialSubject as {
    id?: unknown;
    itemId?: unknown;
    action?: unknown;
    itemName?: unknown;
  };

  const expectedDid = deriveDidCel(parseStoredLog(storedLog));
  if (typeof subject?.id !== "string") {
    throw new Error("Claim has no subject to bind to this list");
  }
  if (subject.id !== expectedDid) {
    throw new Error(`Claim subject ${subject.id} does not name this list`);
  }
  if (typeof subject.itemId !== "string") {
    throw new Error("Claim does not name an item");
  }
  if (!isItemAction(subject.action)) {
    throw new Error(`Claim carries an unknown item action: ${String(subject.action)}`);
  }
  if (!(await verifyCredential(credential))) {
    throw new Error("Refusing to fold in a claim that does not verify");
  }

  const data: ItemEventData = {
    action: subject.action,
    itemId: subject.itemId,
    by: issuerDid(credential),
    at: credential.issuanceDate,
    credential,
  };
  if (typeof subject.itemName === "string") data.itemName = subject.itemName;

  return appendAssetEvent(storedLog, data, signer);
}

/**
 * Replay the log to the current state of every item.
 *
 * Last action wins; a folded-in claim credits its issuer, not the controller
 * who relayed it. Pure — signatures are not checked here, so callers needing
 * authenticity must verify the log separately.
 */
export function foldListState(storedLog: string): Map<string, ItemState> {
  const log = parseStoredLog(storedLog);
  const items = new Map<string, ItemState>();

  for (const event of log.events.slice(1)) {
    const data = event.data as ItemEventData;
    const itemId = data?.itemId;
    if (typeof itemId !== "string" || !isItemAction(data.action)) continue;

    const item = items.get(itemId) ?? {
      itemId,
      checked: false,
      removed: false,
    };

    switch (data.action) {
      case "added":
        item.name = data.itemName ?? item.name;
        item.addedBy = data.by;
        item.removed = false;
        break;
      case "renamed":
        item.name = data.itemName ?? item.name;
        break;
      case "checked":
        item.checked = true;
        item.checkedBy = data.by;
        item.checkedAt = data.at;
        break;
      case "unchecked":
        item.checked = false;
        item.checkedBy = undefined;
        item.checkedAt = undefined;
        break;
      case "removed":
        item.removed = true;
        break;
    }

    items.set(itemId, item);
  }

  return items;
}

/** The items still on the list, in insertion order. */
export function liveItems(storedLog: string): ItemState[] {
  return [...foldListState(storedLog).values()].filter((item) => !item.removed);
}
