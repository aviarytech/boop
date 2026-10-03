/**
 * Shared upsert for a list's serialized Originals AssetEnvelope.
 *
 * One envelope row per list, keyed by the by_list index. Callers pass the
 * envelope the client produced; the server never mints one on the create path,
 * because only the client holds the genesis key.
 */

import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

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
    });
    return;
  }

  await ctx.db.insert("listEnvelopes", {
    listId,
    assetDid,
    envelope,
    updatedAt: Date.now(),
  });
}
