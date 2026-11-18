/** The single writer of action records (#237). Every recorded transition goes
 * through recordActions so individual, batch, template and recurring flows
 * agree, and so a signature is only ever stored over bytes this module built.
 *
 * Signing custody (#286): the author signs on their own device with the
 * assertion key (`#orig-1`) of their did:webvh, through their Turnkey session.
 * The client builds the version-2 payload from the mutation's arguments and
 * sends the signature along (`signed`). Here the payload is rebuilt from the
 * same arguments and this mutation's authenticated actor, the key is read from
 * the author DID log the server serves, and the signature is checked against
 * those bytes. A signature that does not verify is recorded as `failed` with a
 * reason code and never stored; a write never fails because of signing.
 */
import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { ActorCtx } from "./authenticated";
import {
  ACTION_SIGNING_KEY_FRAGMENT,
  actionSubjectKey,
  assertionKeyAt,
  buildActionRecord,
  canonicalize,
  decodeSignature,
  itemEdit,
  parseEd25519PublicKey,
  verifyActionSignature,
  type ActionChange,
  type ActionRecordAttested,
  type ActionSignatureEnvelope,
} from "../../shared/actionRecord";

/** Mutation argument: the author's signatures over the records this call will write. */
export const actionSignatureEnvelope = v.object({
  verificationMethod: v.string(),
  versionId: v.string(),
  signedAt: v.number(),
  signatures: v.array(v.object({ subject: v.string(), signature: v.string() })),
});

/** What the server knows about an action beyond what the author signs. */
type Attested = Omit<ActionRecordAttested, "occurredAt" | "userId" | "credential"> & { listId: Id<"lists">; itemId?: Id<"items"> };
export type RecordedAction = { change: ActionChange; attested: Attested };
export type ListRef = { _id: Id<"lists">; assetDid?: string };

const listContext = (list: ListRef) => ({ listId: list._id, ...(list.assetDid ? { listAssetDid: list.assetDid } : {}) });

export const itemCreated = (list: ListRef, itemId: Id<"items">, name: string, origin?: Extract<ActionRecordAttested["origin"], { kind: "recurrence" | "template" }>): RecordedAction => ({
  change: { action: "item.created", subject: { listId: list._id }, after: { name } },
  attested: { ...listContext(list), itemId, before: null, ...(origin ? { origin } : {}) },
});

export const itemCompleted = (list: ListRef, item: Pick<Doc<"items">, "_id" | "checked">, checkedAt: number): RecordedAction => ({
  change: { action: "item.completed", subject: { itemId: item._id }, after: { checked: true } },
  // checkedAt can be client-supplied; a value JSON cannot carry must not fail the write.
  attested: { ...listContext(list), itemId: item._id, before: { checked: item.checked }, ...(Number.isFinite(checkedAt) ? { checkedAt } : {}) },
});

export const itemReopened = (list: ListRef, item: Pick<Doc<"items">, "_id" | "checked">): RecordedAction => ({
  change: { action: "item.reopened", subject: { itemId: item._id }, after: { checked: false } },
  attested: { ...listContext(list), itemId: item._id, before: { checked: item.checked } },
});

// A new list has no Original yet (its owner mints it later), so the author names it by their creation time.
export const listCreated = (list: ListRef & { name: string; kind?: "note"; createdAt: number }, origin?: Extract<ActionRecordAttested["origin"], { kind: "template" | "copy" }>): RecordedAction => ({
  change: { action: "list.created", subject: { createdAt: list.createdAt }, after: { name: list.name, kind: list.kind ?? "list" } },
  attested: { ...listContext(list), before: null, ...(origin ? { origin } : {}) },
});

export const listRenamed = (list: ListRef & { name: string }, name: string): RecordedAction => ({
  change: { action: "list.renamed", subject: { listId: list._id }, after: { name } },
  attested: { ...listContext(list), before: { name: list.name } },
});

/** Null when the call changes nothing an edit record covers. `args` are updateItem's own. */
export const itemEdited = (list: ListRef, item: Doc<"items">, args: Record<string, unknown>): RecordedAction | null => {
  const after = itemEdit(args);
  if (!after) return null;
  const prior: Record<string, unknown> = itemEdit(item) ?? {};
  const before = Object.fromEntries(Object.keys(after).map(key => [key, prior[key] ?? null]));
  return {
    change: { action: "item.edited", subject: { itemId: item._id }, after },
    attested: { ...listContext(list), itemId: item._id, before },
  };
};

// Carries nothing of the item but its id: the record outlives it. `parentItemId` marks a
// sub-item removed with its parent, which the author did not name (and so did not sign).
export const itemDeleted = (list: ListRef, itemId: Id<"items">, parentItemId?: Id<"items">): RecordedAction => ({
  change: { action: "item.deleted", subject: { itemId }, after: { deleted: true } },
  attested: { ...listContext(list), itemId, ...(parentItemId ? { origin: { kind: "cascade", parentItemId } } : {}) },
});

/** A device that never closes a session (a crash, a closed tab) leaves it open this long before it counts as abandoned. */
export const EDIT_SESSION_ABANDONED_MS = 10 * 60 * 1000;
const MAX_EDIT_SESSION_ID = 100;
export const validEditSession = (editSession: string | undefined): editSession is string =>
  editSession !== undefined && editSession.length > 0 && editSession.length <= MAX_EDIT_SESSION_ID;

type PendingEdit = Doc<"pendingItemEdits">;
const pendingEdits = (ctx: MutationCtx, itemId: Id<"items">, userId: Id<"users">) =>
  ctx.db.query("pendingItemEdits").withIndex("by_item_user", q => q.eq("itemId", itemId).eq("userId", userId)).collect();

/** Writes a session's one record, from what this server applied, and closes the session. */
async function recordPendingEdit(ctx: ActorCtx<MutationCtx>, pending: PendingEdit, signed?: ActionSignatureEnvelope): Promise<void> {
  const list: ListRef = await ctx.db.get(pending.listId) ?? { _id: pending.listId };
  await ctx.db.delete(pending._id);
  await recordActions(ctx, [{
    change: { action: "item.edited", subject: { itemId: pending.itemId }, after: JSON.parse(pending.after) },
    attested: { ...listContext(list), itemId: pending.itemId, before: JSON.parse(pending.before) },
  }], signed);
}

/**
 * Adds one save to the actor's edit session on the item instead of recording
 * it. Later saves win per field in `after`; `before` keeps the value each
 * field had when the session first touched it. A session of the same account
 * on the same item that its device abandoned is recorded here, unsigned, so it
 * is not lost for good.
 */
export async function deferItemEdit(ctx: ActorCtx<MutationCtx>, edited: RecordedAction, editSession: string): Promise<void> {
  const itemId = edited.attested.itemId!;
  const now = Date.now();
  const sessions = await pendingEdits(ctx, itemId, ctx.actor.userId);
  for (const other of sessions) {
    if (other.editSession !== editSession && other.updatedAt < now - EDIT_SESSION_ABANDONED_MS) await recordPendingEdit(ctx, other);
  }
  const open = sessions.find(session => session.editSession === editSession);
  const { after } = edited.change, before = edited.attested.before as Record<string, unknown>;
  if (!open) {
    await ctx.db.insert("pendingItemEdits", {
      itemId, listId: edited.attested.listId, userId: ctx.actor.userId, editSession,
      after: canonicalize(after), before: canonicalize(before), updatedAt: now,
    });
    return;
  }
  await ctx.db.patch(open._id, {
    after: canonicalize({ ...JSON.parse(open.after), ...after }),
    before: canonicalize({ ...before, ...JSON.parse(open.before) }),
    updatedAt: now,
  });
}

/** Closes the actor's edit session with the device's signature over it. False when there is nothing to record. */
export async function recordDeferredItemEdit(ctx: ActorCtx<MutationCtx>, itemId: Id<"items">, editSession: string, signed?: ActionSignatureEnvelope): Promise<boolean> {
  const open = (await pendingEdits(ctx, itemId, ctx.actor.userId)).find(session => session.editSession === editSession);
  if (!open) return false;
  await recordPendingEdit(ctx, open, signed);
  return true;
}

/**
 * Before an item is removed: the remover's own open sessions on it are
 * recorded (unsigned; their device has not signed them), so the edit precedes
 * the deletion in the item's history. Other accounts' open sessions cannot be
 * recorded in their name here and are dropped.
 */
export async function closeItemEditSessions(ctx: ActorCtx<MutationCtx>, itemId: Id<"items">): Promise<void> {
  const sessions = await ctx.db.query("pendingItemEdits").withIndex("by_item_user", q => q.eq("itemId", itemId)).collect();
  for (const session of sessions) {
    if (session.userId === ctx.actor.userId) await recordPendingEdit(ctx, session);
    else await ctx.db.delete(session._id);
  }
}

type Signer = { key: Uint8Array; publicKeyMultibase: string } | { error: string };

/**
 * The key the envelope says signed, if it is this actor's assertion key at a
 * version of the author DID log this server serves. The log was validated when
 * it was stored (convex/lib/authorDidLog.ts), and `author` says every version
 * of it is an author DID.
 */
async function resolveSigner(ctx: ActorCtx<MutationCtx>, envelope: ActionSignatureEnvelope): Promise<Signer> {
  if (!Number.isFinite(envelope.signedAt) || envelope.signatures.length > 1000) return { error: "malformed_envelope" };
  const did = ctx.actor.did;
  if (envelope.verificationMethod !== `${did}#${ACTION_SIGNING_KEY_FRAGMENT}`) return { error: "author_mismatch" };
  const log = await ctx.db.query("didLogs").withIndex("by_user_did", q => q.eq("userDid", did)).first();
  if (!log?.author) return { error: "no_author_did" };
  const key = assertionKeyAt(log.log, { did, verificationMethod: envelope.verificationMethod, versionId: envelope.versionId });
  if ("failure" in key) return { error: key.failure };
  return { key: parseEd25519PublicKey(key.publicKeyMultibase)!, publicKeyMultibase: key.publicKeyMultibase };
}

/**
 * Persists one record per action: the exact canonical payload, the attested
 * context, and a signature only if `signed` carries one for that action that
 * verifies over the rebuilt bytes. Identity comes only from ctx.actor.
 */
export async function recordActions(ctx: ActorCtx<MutationCtx>, actions: RecordedAction[], signed?: ActionSignatureEnvelope): Promise<void> {
  if (actions.length === 0) return;
  const occurredAt = Date.now();
  const did = ctx.actor.did;
  const signer = signed ? await resolveSigner(ctx, signed) : null;
  for (const { change, attested } of actions) {
    const row = {
      attested: canonicalize({ ...attested, occurredAt, userId: ctx.actor.userId, credential: ctx.actor.credential } satisfies ActionRecordAttested),
      listId: attested.listId, itemId: attested.itemId, ownerUserId: ctx.actor.userId, action: change.action,
    };
    const offered = signed?.signatures.find(entry => entry.subject === actionSubjectKey(change));
    if (!signed || !signer || !offered) {
      await ctx.db.insert("actionRecords", { ...buildActionRecord(change, { did }), ...row, status: "unsigned" });
      continue;
    }
    // A record that failed stores no claim about a key or a signing time, only why.
    const failed = (error: string) => ctx.db.insert("actionRecords", { ...buildActionRecord(change, { did }), ...row, status: "failed", error });
    if ("error" in signer) { await failed(signer.error); continue; }
    const signature = decodeSignature(offered.signature);
    if (!signature) { await failed("malformed_signature"); continue; }
    const author = { did, verificationMethod: signed.verificationMethod, versionId: signed.versionId };
    const built = buildActionRecord(change, author, signed.signedAt);
    if (!verifyActionSignature(built.payload, signature, signer.key)) { await failed("bad_signature"); continue; }
    await ctx.db.insert("actionRecords", {
      ...built, ...row, status: "signed", signature: offered.signature,
      verificationMethod: signed.verificationMethod, publicKeyMultibase: signer.publicKeyMultibase, signedAt: signed.signedAt,
    });
  }
}

// Records grow with every toggle, so deletion is bounded per mutation.
export const DELETE_RECORDS_BATCH = 500;

/** A list's records are removed with the list (or its owner's account). An
 * item's records outlive the item: removing an item deletes none of them, so
 * the item target is only reached by continuations scheduled before that
 * changed. Deletes one batch now and schedules the remainder. */
export async function deleteActionRecords(
  ctx: MutationCtx, target: { listId: Id<"lists"> } | { itemId: Id<"items"> },
): Promise<void> {
  const records = "itemId" in target
    ? await ctx.db.query("actionRecords").withIndex("by_item", q => q.eq("itemId", target.itemId)).take(DELETE_RECORDS_BATCH)
    : await ctx.db.query("actionRecords").withIndex("by_list", q => q.eq("listId", target.listId)).take(DELETE_RECORDS_BATCH);
  for (const record of records) await ctx.db.delete(record._id);
  if (records.length === DELETE_RECORDS_BATCH) {
    await ctx.scheduler.runAfter(0, internal.actionRecords.deleteRemaining, { target });
  }
}
