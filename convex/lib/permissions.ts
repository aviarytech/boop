import { AuthError } from "./authError";
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

export type ListResources = {
  accounts?: Array<Id<"users"> | undefined>;
  lists?: Array<Id<"lists"> | undefined>;
  items?: Array<Id<"items"> | undefined>;
  anchors?: Array<Id<"bitcoinAnchors"> | undefined>;
};

/** Each operation explicitly selects its resources; argument names confer no access. */
export async function authorizeResources(
  ctx: MutationCtx | QueryCtx,
  actor: import("./actor").ResolvedActor,
  resources: ListResources,
): Promise<void> {
  for (const accountId of resources.accounts ?? []) {
    if (accountId !== actor.userId) throw new AuthError("Not authorized to access this account", "UNAUTHORIZED");
  }
  const listIds = new Set((resources.lists ?? []).filter((id): id is Id<"lists"> => id !== undefined));
  for (const id of new Set(resources.items ?? [])) {
    if (!id) continue;
    const item = await ctx.db.get(id);
    if (!item) throw new Error("Item not found");
    listIds.add(item.listId);
  }
  for (const id of new Set(resources.anchors ?? [])) {
    if (!id) continue;
    const anchor = await ctx.db.get(id);
    if (!anchor) throw new Error("Anchor not found");
    if (anchor.listId) listIds.add(anchor.listId);
    if (anchor?.itemId) {
      const item = await ctx.db.get(anchor.itemId);
      if (!item) throw new Error("Item not found");
    listIds.add(item.listId);
    }
  }
  for (const listId of listIds) {
    const list = await ctx.db.get(listId);
    if (!list) throw new Error("List not found");
    if ([actor.did, actor.legacyDid].includes(list.ownerDid)) continue;
    const publication = await ctx.db.query("publications").withIndex("by_list", q => q.eq("listId", listId)).first();
    if (publication?.status !== "active") throw new AuthError("Not authorized to access this list", "UNAUTHORIZED");
  }
}

/** actorDid is resolved by the authenticated boundary, never supplied by a public caller. */
export async function isResourceOwner(ctx: QueryCtx | MutationCtx, ownerDid: string, actorDid: string): Promise<boolean> {
  if (ownerDid === actorDid) return true;
  const account = await ctx.db.query("users").withIndex("by_did", q => q.eq("did", actorDid)).first();
  return account?.legacyDid === ownerDid;
}
