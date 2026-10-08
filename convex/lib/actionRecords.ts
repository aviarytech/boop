/** The single writer of action records. Every recorded transition goes through
 * recordActions so individual, batch, template and recurring flows agree. */
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { ActorCtx } from "./authenticated";
import { buildActionRecord, type ActionChange } from "../../shared/actionRecord";

type RecordedChange = ActionChange & { subject: { listId: Id<"lists">; itemId?: Id<"items"> } };
export type ListRef = { _id: Id<"lists">; assetDid?: string };
type Origin<A extends "item.created" | "list.created"> = NonNullable<Extract<ActionChange, { action: A }>["origin"]>;

const subject = (list: ListRef) => ({ listId: list._id, ...(list.assetDid ? { listAssetDid: list.assetDid } : {}) });

export const itemCreated = (list: ListRef, itemId: Id<"items">, name: string, origin?: Origin<"item.created">): RecordedChange => ({
  action: "item.created", subject: { ...subject(list), itemId }, before: null, after: { name, checked: false },
  ...(origin ? { origin } : {}),
});

export const itemCompleted = (list: ListRef, item: Pick<Doc<"items">, "_id" | "checked">, checkedAt: number): RecordedChange => ({
  action: "item.completed", subject: { ...subject(list), itemId: item._id },
  // checkedAt can be client-supplied; a value JSON cannot carry must not fail the write.
  before: { checked: item.checked }, after: { checked: true, checkedAt: Number.isFinite(checkedAt) ? checkedAt : null },
});

export const itemReopened = (list: ListRef, item: Pick<Doc<"items">, "_id" | "checked">): RecordedChange => ({
  action: "item.reopened", subject: { ...subject(list), itemId: item._id },
  before: { checked: item.checked }, after: { checked: false },
});

export const listCreated = (list: ListRef & { name: string; kind?: "note" }, origin?: Origin<"list.created">): RecordedChange => ({
  action: "list.created", subject: subject(list), before: null, after: { name: list.name, kind: list.kind ?? "list" },
  ...(origin ? { origin } : {}),
});

export const listRenamed = (list: ListRef & { name: string }, name: string): RecordedChange => ({
  action: "list.renamed", subject: subject(list), before: { name: list.name }, after: { name },
});

/**
 * Persists the exact canonical payloads for this mutation's actions and queues
 * one signer run for them. Never signs inline: Turnkey is Node/network-only, so
 * a signing outage cannot fail the write. Identity comes only from ctx.actor.
 */
export async function recordActions(ctx: ActorCtx<MutationCtx>, changes: RecordedChange[]): Promise<void> {
  if (changes.length === 0) return;
  const owner = await ctx.db.get(ctx.actor.userId);
  const status = owner?.turnkeySubOrgId ? "pending" as const : "unsigned" as const;
  const occurredAt = Date.now();
  const recordIds: Id<"actionRecords">[] = [];
  for (const change of changes) {
    const { payload, digest } = buildActionRecord(change, {
      occurredAt,
      owner: { did: ctx.actor.did, userId: ctx.actor.userId },
      credential: ctx.actor.credential,
    });
    recordIds.push(await ctx.db.insert("actionRecords", {
      payload, digest, listId: change.subject.listId, itemId: change.subject.itemId,
      ownerUserId: ctx.actor.userId, status, attempts: 0,
    }));
  }
  if (status === "pending") {
    await ctx.scheduler.runAfter(0, internal.actionRecordSigning.sign, { recordIds });
  }
}

/** Records name their subject, so they are removed with it like vcProofs were. */
export async function deleteActionRecords(
  ctx: MutationCtx, target: { listId: Id<"lists"> } | { itemId: Id<"items"> },
): Promise<void> {
  const records = "itemId" in target
    ? await ctx.db.query("actionRecords").withIndex("by_item", q => q.eq("itemId", target.itemId)).collect()
    : await ctx.db.query("actionRecords").withIndex("by_list", q => q.eq("listId", target.listId)).collect();
  for (const record of records) await ctx.db.delete(record._id);
}
