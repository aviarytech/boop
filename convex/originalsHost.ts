/**
 * Convex as the shared host for list Originals (Originals SDK 6, P6.4–P6.8).
 *
 * Every device signs entries itself — boop never signs for anyone — and
 * submits them here. The host appends an entry only when it extends the
 * accepted head and verifies under the profile against it, judged with the
 * author's did:webvh history from `didLogs`, the copy boop itself serves. A
 * byte-identical retry is acknowledged; any other entry on a moved head is a
 * stale-parent conflict. The host never re-signs, rebases or merges.
 *
 * Verification runs in the action; the commit is a mutation that compares and
 * swaps the head, so two devices racing on one head get exactly one append.
 *
 * A list's log written under Originals 5 no longer verifies, so the host
 * treats that list as having no Original: it is legacy, its owner re-mints it,
 * and the old row stays beside the new one as history (like listEnvelopes).
 */

import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { actorAction, actorQuery } from "./lib/authenticated";
import { isCurrentOriginalLog, judgeSubmission, type HostAnswer } from "./lib/originalsSubmission";

/** The list's Original under Originals 6, ignoring any earlier log kept as history. */
async function currentOriginal(ctx: Pick<QueryCtx, "db">, listId: Id<"lists">): Promise<Doc<"originalLogs"> | null> {
  const rows = await ctx.db.query("originalLogs").withIndex("by_list", (q) => q.eq("listId", listId)).collect();
  return rows.find((row) => isCurrentOriginalLog(row.log)) ?? null;
}

/** True when a list has a log written before Originals 6, which must be re-minted. */
async function hasEarlierOriginal(ctx: Pick<QueryCtx, "db">, listId: Id<"lists">): Promise<boolean> {
  const rows = await ctx.db.query("originalLogs").withIndex("by_list", (q) => q.eq("listId", listId)).collect();
  return rows.some((row) => !isCurrentOriginalLog(row.log));
}

export const hostState = internalQuery({
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) return null;
    const row = await currentOriginal(ctx, args.listId);
    const didLog = await ctx.db.query("didLogs").withIndex("by_user_did", (q) => q.eq("userDid", list.ownerDid)).first();
    return {
      ownerDid: list.ownerDid,
      original: row ? { did: row.did, log: row.log, head: row.head } : null,
      authorLog: didLog?.log ?? null,
    };
  },
});

/**
 * The commit point. Resource bytes go in first; the log replace is
 * conditional on the head the action verified against, so a concurrent append
 * turns this one into a stale-parent conflict rather than a fork.
 */
export const commitEntry = internalMutation({
  args: {
    listId: v.id("lists"),
    did: v.string(),
    expectedHead: v.union(v.string(), v.null()),
    log: v.string(),
    head: v.string(),
    resources: v.array(v.object({ digest: v.string(), bytes: v.bytes() })),
  },
  handler: async (ctx, args): Promise<{ committed: true } | { committed: false; head: string | null }> => {
    const row = await currentOriginal(ctx, args.listId);
    if (args.expectedHead === null) {
      // Two devices minting at once: the first genesis stands.
      if (row) return { committed: false, head: row.head };
    } else if (!row || row.did !== args.did || row.head !== args.expectedHead) {
      return { committed: false, head: row?.head ?? null };
    }
    for (const r of args.resources) {
      const existing = await ctx.db.query("originalResources")
        .withIndex("by_did_digest", (q) => q.eq("did", args.did).eq("digest", r.digest)).first();
      if (!existing) await ctx.db.insert("originalResources", { did: args.did, digest: r.digest, bytes: r.bytes });
    }
    const now = Date.now();
    if (row) {
      await ctx.db.patch(row._id, { log: args.log, head: args.head, updatedAt: now });
    } else {
      await ctx.db.insert("originalLogs", { listId: args.listId, did: args.did, log: args.log, head: args.head, updatedAt: now });
      // Genesis names the list's Original. A legacy did:cel or Originals 5
      // value is replaced: that is the re-mint, and the old envelope or log
      // row stays as history.
      await ctx.db.patch(args.listId, { assetDid: args.did });
    }
    return { committed: true };
  },
});

/**
 * Submit one signed entry (SharedHost.submit). Only the list owner may submit:
 * lists have no editor grants yet, so the author is the only valid signer.
 */
export const { public: submitEntry, internal: submitEntryInternal } = actorAction({
  authority: "owner",
  resources: (args) => ({ lists: [args.listId] }),
  scope: "items:write",
  args: {
    listId: v.id("lists"),
    original: v.string(),
    entry: v.string(),
    resources: v.array(v.object({ digest: v.string(), bytes: v.bytes() })),
  },
  handler: async (ctx, args): Promise<HostAnswer> => {
    const state = await ctx.runQuery(internal.originalsHost.hostState, { listId: args.listId });
    if (!state) throw new Error("List not found");
    const judged = await judgeSubmission(state, args, Date.now());
    if ("answer" in judged) return judged.answer;
    const { log, head, expectedHead } = judged.commit;

    const result = await ctx.runMutation(internal.originalsHost.commitEntry, {
      listId: args.listId,
      did: args.original,
      expectedHead,
      log,
      head,
      resources: args.resources,
    });
    if (!result.committed) {
      if (result.head === null) throw new Error("The Original changed while saving; try again");
      return { status: "stale-parent", head: result.head };
    }
    return { status: "accepted", checkpoint: head, head };
  },
});

/**
 * The accepted log with what verifying it needs (SharedHost.accepted): the
 * author's DID history and every resource's bytes. Null for a list that has no
 * Original yet. The client verifies all of it; nothing here is trusted.
 */
export const { public: getAccepted, internal: getAcceptedInternal } = actorQuery({
  resources: (args) => ({ lists: [args.listId] }),
  scope: "lists:read",
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const row = await currentOriginal(ctx, args.listId);
    if (!row) return null;
    const list = await ctx.db.get(args.listId);
    const didLog = list
      ? await ctx.db.query("didLogs").withIndex("by_user_did", (q) => q.eq("userDid", list.ownerDid)).first()
      : null;
    const resources = await ctx.db.query("originalResources")
      .withIndex("by_did_digest", (q) => q.eq("did", row.did)).collect();
    return {
      did: row.did,
      log: row.log,
      head: row.head,
      author: list && didLog ? { did: list.ownerDid, log: didLog.log } : null,
      resources: resources.map((r) => ({ digest: r.digest, bytes: r.bytes })),
    };
  },
});

/** Which of these lists have no Original under Originals 6, and which of those had an earlier one (CEL or Originals 5). */
export const { public: getOriginalStatus, internal: getOriginalStatusInternal } = actorQuery({
  resources: (args) => ({ lists: [...args.listIds] }),
  scope: "lists:read",
  args: { listIds: v.array(v.id("lists")) },
  handler: async (ctx, args) => {
    const unminted: Id<"lists">[] = [];
    const legacy: Id<"lists">[] = [];
    for (const listId of args.listIds) {
      const list = await ctx.db.get(listId);
      if (!list) continue;
      if (await currentOriginal(ctx, listId)) continue;
      // An earlier Original (CEL in assetDid, or an Originals 5 log) is legacy.
      (list.assetDid || await hasEarlierOriginal(ctx, listId) ? legacy : unminted).push(listId);
    }
    return { unminted, legacy };
  },
});
