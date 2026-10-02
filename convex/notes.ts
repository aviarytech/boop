import { v } from "convex/values";
import { actorMutation, actorQuery } from "./lib/authenticated";
import { resourceUnavailable } from "./lib/authError";
import { canUserEditList, canUserViewList } from "./lib/permissions";
import { MAX_NOTE_LENGTH, excerpt, isNote, wordCount, type NoteCardSummary } from "./lib/noteBody";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

async function getBodyRow(ctx: QueryCtx, listId: Id<"lists">) {
  return ctx.db
    .query("noteBodies")
    .withIndex("by_list", (q) => q.eq("listId", listId))
    .first();
}

/**
 * Card summaries for the notes among `listIds`; lists and unviewable ids are
 * skipped. Checks access per id rather than via `resources`, so one list
 * deleted mid-subscription drops out instead of failing the whole index.
 */
export const { public: getNoteCards, internal: getNoteCardsInternal } = actorQuery({
  resources: () => ({}),
  scope: "lists:read",
  args: { listIds: v.array(v.id("lists")) },
  handler: async (ctx, args): Promise<NoteCardSummary[]> => {
    // Legacy fallback callers must batch: even 50 maximum-size UTF-8 bodies
    // stay below the transaction read limit. New clients use stored summaries.
    if (args.listIds.length > 50) throw new Error("Request at most 50 note summaries");
    const summaries: NoteCardSummary[] = [];
    for (const listId of args.listIds) {
      const list = await ctx.db.get(listId);
      if (!list || !isNote(list)) continue;
      if (!await canUserViewList(ctx, listId, ctx.actor.did, ctx.actor.legacyDid)) continue;
      if (list.noteSummary) {
        summaries.push({ listId, ...list.noteSummary });
        continue;
      }
      const row = await getBodyRow(ctx, listId);
      const body = row?.body ?? "";
      summaries.push({
        listId,
        excerpt: excerpt(body),
        wordCount: wordCount(body),
        updatedAt: row?.updatedAt ?? list.createdAt,
      });
    }
    return summaries;
  },
});

export const { public: getNoteBody, internal: getNoteBodyInternal } = actorQuery({
  resources: () => ({}),
  scope: "lists:read",
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list || !isNote(list)) return null;
    if (!await canUserViewList(ctx, args.listId, ctx.actor.did, ctx.actor.legacyDid)) return null;
    const row = await getBodyRow(ctx, args.listId);
    return {
      body: row?.body ?? "",
      updatedAt: row?.updatedAt ?? list.createdAt,
      canEdit: await canUserEditList(ctx, args.listId, ctx.actor.did, ctx.actor.legacyDid),
    };
  },
});

export const { public: updateNoteBody, internal: updateNoteBodyInternal } = actorMutation({
  resources: (args) => ({ lists: [args.listId] }),
  scope: "items:write",
  args: { listId: v.id("lists"), body: v.string() },
  handler: async (ctx, args) => {
    if (args.body.length > MAX_NOTE_LENGTH) {
      throw new Error(`Note cannot exceed ${MAX_NOTE_LENGTH} characters`);
    }
    const list = await ctx.db.get(args.listId);
    if (!list || !isNote(list)) throw resourceUnavailable();
    if (!await canUserEditList(ctx, args.listId, ctx.actor.did, ctx.actor.legacyDid)) {
      throw resourceUnavailable();
    }
    const row = await getBodyRow(ctx, args.listId);
    const updatedAt = Date.now();
    await ctx.db.patch(args.listId, {
      noteSummary: { excerpt: excerpt(args.body), wordCount: wordCount(args.body), updatedAt },
    });
    if (row) await ctx.db.patch(row._id, { body: args.body, updatedAt });
    else await ctx.db.insert("noteBodies", { listId: args.listId, body: args.body, updatedAt });
  },
});
