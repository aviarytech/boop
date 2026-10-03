import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Check if a user can edit a list.
 * Owner can always edit. If the list has an active publication, anyone can edit.
 */
export async function canUserEditList(
  ctx: MutationCtx | QueryCtx,
  listId: Id<"lists">,
  userDid: string,
  legacyDid?: string
): Promise<boolean> {
  const list = await ctx.db.get(listId);
  if (!list) return false;

  const didsToCheck = [userDid, ...(legacyDid ? [legacyDid] : [])];
  if (didsToCheck.includes(list.ownerDid)) return true;

  const pub = await ctx.db
    .query("publications")
    .withIndex("by_list", (q) => q.eq("listId", listId))
    .first();

  return !!pub && pub.status === "active";
}

/**
 * Check if a user can view a list. In the current model view access equals
 * edit access — a list is either private (owner only) or actively published
 * (public). Kept separate so read/write rules can diverge later.
 */
export async function canUserViewList(
  ctx: MutationCtx | QueryCtx,
  listId: Id<"lists">,
  userDid: string,
  legacyDid?: string
): Promise<boolean> {
  return canUserEditList(ctx, listId, userDid, legacyDid);
}
