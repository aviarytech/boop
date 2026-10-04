import { resourceUnavailable } from "./authError";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Read the owner in the same transaction as authorization so starting erasure
 * conflicts with concurrent writes, including writes by other published-list users. */
async function ownerIsDeleting(ctx: MutationCtx | QueryCtx, ownerDid: string): Promise<boolean> {
  const owner = await ctx.db.query("users")
    .withIndex("by_did", q => q.eq("did", ownerDid)).first()
    ?? await ctx.db.query("users")
      .withIndex("by_legacy_did", q => q.eq("legacyDid", ownerDid)).first();
  return owner?.deletionRequestedAt !== undefined;
}

export type ListAuthority = "read" | "edit" | "owner";
export type ListRole = "owner" | "editor" | "viewer";

/** Identity comes from the authenticated boundary (or server-owned recipient rows).
 * Grants are bound to account ids, so DID migration never changes the recipient. */
export async function listRole(
  ctx: MutationCtx | QueryCtx, listId: Id<"lists">, userDid: string, legacyDid?: string,
): Promise<ListRole | null> {
  const list = await ctx.db.get(listId);
  if (!list || await ownerIsDeleting(ctx, list.ownerDid)) return null;
  if ([userDid, legacyDid].includes(list.ownerDid)) return "owner";
  const account = await ctx.db.query("users").withIndex("by_did", q => q.eq("did", userDid)).first()
    ?? await ctx.db.query("users").withIndex("by_legacy_did", q => q.eq("legacyDid", userDid)).first();
  if (!account || account.deletionRequestedAt !== undefined) return null;
  const grant = await ctx.db.query("listGrants")
    .withIndex("by_list_recipient", q => q.eq("listId", listId).eq("recipientId", account._id)).unique();
  return grant?.role ?? null;
}

export async function canUserEditList(
  ctx: MutationCtx | QueryCtx, listId: Id<"lists">, userDid: string, legacyDid?: string,
): Promise<boolean> {
  const role = await listRole(ctx, listId, userDid, legacyDid);
  return role === "owner" || role === "editor";
}

export async function canUserViewList(
  ctx: MutationCtx | QueryCtx, listId: Id<"lists">, userDid: string, legacyDid?: string,
): Promise<boolean> {
  if (await listRole(ctx, listId, userDid, legacyDid)) return true;
  const list = await ctx.db.get(listId);
  if (!list || await ownerIsDeleting(ctx, list.ownerDid)) return false;
  const pub = await ctx.db.query("publications").withIndex("by_list", q => q.eq("listId", listId)).first();
  return pub?.status === "active";
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
  authority: ListAuthority = "read",
): Promise<void> {
  for (const accountId of resources.accounts ?? []) {
    if (accountId !== actor.userId) throw resourceUnavailable();
  }
  const listIds = new Set((resources.lists ?? []).filter((id): id is Id<"lists"> => id !== undefined));
  for (const id of new Set(resources.items ?? [])) {
    if (!id) continue;
    const item = await ctx.db.get(id);
    if (!item) throw resourceUnavailable();
    listIds.add(item.listId);
  }
  for (const id of new Set(resources.anchors ?? [])) {
    if (!id) continue;
    const anchor = await ctx.db.get(id);
    if (!anchor || (!anchor.listId && !anchor.itemId)) throw resourceUnavailable();
    if (anchor.listId) listIds.add(anchor.listId);
    if (anchor?.itemId) {
      const item = await ctx.db.get(anchor.itemId);
      if (!item || (anchor.listId && anchor.listId !== item.listId)) throw resourceUnavailable();
      listIds.add(item.listId);
    }
  }
  for (const listId of listIds) {
    const allowed = authority === "read"
      ? await canUserViewList(ctx, listId, actor.did, actor.legacyDid)
      : authority === "edit"
        ? await canUserEditList(ctx, listId, actor.did, actor.legacyDid)
        : await listRole(ctx, listId, actor.did, actor.legacyDid) === "owner";
    if (!allowed) throw resourceUnavailable();
  }
}

/** actorDid is resolved by the authenticated boundary, never supplied by a public caller. */
export async function isResourceOwner(ctx: QueryCtx | MutationCtx, ownerDid: string, actorDid: string): Promise<boolean> {
  if (ownerDid === actorDid) return true;
  const account = await ctx.db.query("users").withIndex("by_did", q => q.eq("did", actorDid)).first();
  return account?.legacyDid === ownerDid;
}
