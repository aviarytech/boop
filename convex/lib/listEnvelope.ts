/**
 * Shared upsert for a list's serialized Originals AssetEnvelope.
 *
 * One envelope row per list, keyed by the by_list index. Callers pass the
 * envelope the client produced; the server never mints one on the create path,
 * because only the client holds the genesis key.
 */

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { genesisSealedAt } from "./legacyList";

export async function upsertListEnvelope(
  ctx: MutationCtx,
  listId: Id<"lists">,
  assetDid: string,
  envelope: string
): Promise<void> {
  const existing = await ctx.db
    .query("listEnvelopes")
    .withIndex("by_list", (q) => q.eq("listId", listId))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      assetDid,
      envelope,
      updatedAt: Date.now(),
      // events[0] never changes, so this is written once and then only
      // repaired if an older row is missing it.
      genesisSealedAt: existing.genesisSealedAt ?? genesisSealedAt(envelope) ?? undefined,
    });
    return;
  }

  await ctx.db.insert("listEnvelopes", {
    listId,
    assetDid,
    envelope,
    updatedAt: Date.now(),
    genesisSealedAt: genesisSealedAt(envelope) ?? undefined,
  });
}
