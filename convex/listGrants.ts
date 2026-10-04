import { chosenPublicDisplayName } from "./lib/publicDisplayName";
import { v } from "convex/values";
import { actorMutation, actorQuery } from "./lib/authenticated";
import { resourceUnavailable } from "./lib/authError";
import { listRole } from "./lib/permissions";

const role = v.union(v.literal("viewer"), v.literal("editor"));

/** Full recipient roster is owner-only. Recipients get only their own role. */
export const { public: getListGrants, internal: getListGrantsInternal } = actorQuery({
  authority: "owner", scope: "lists:read",
  resources: args => ({ lists: [args.listId] }),
  args: { listId: v.id("lists") },
  handler: (ctx, args) => ctx.db.query("listGrants")
    .withIndex("by_list_recipient", q => q.eq("listId", args.listId)).collect(),
});

export const { public: getMyListAccess, internal: getMyListAccessInternal } = actorQuery({
  scope: "lists:read", resources: args => ({ lists: [args.listId] }),
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    return { ownerDid: list!.ownerDid, role: await listRole(ctx, args.listId, ctx.actor.did, ctx.actor.legacyDid) };
  },
});

/** Changes accepted grants only. Does not invite, accept, or transfer ownership. */
export const { public: updateListGrant, internal: updateListGrantInternal } = actorMutation({
  authority: "owner", scope: "*",
  resources: args => ({ lists: [args.listId] }),
  args: { listId: v.id("lists"), grantId: v.id("listGrants"), role },
  handler: async (ctx, args) => {
    const grant = await ctx.db.get(args.grantId);
    if (!grant || grant.listId !== args.listId || grant.recipientId === ctx.actor.userId) throw resourceUnavailable();
    await ctx.db.patch(grant._id, { role: args.role });
  },
});

export const { public: revokeListGrant, internal: revokeListGrantInternal } = actorMutation({
  authority: "owner", scope: "*",
  resources: args => ({ lists: [args.listId] }),
  args: { listId: v.id("lists"), grantId: v.id("listGrants") },
  handler: async (ctx, args) => {
    const grant = await ctx.db.get(args.grantId);
    if (!grant || grant.listId !== args.listId || grant.recipientId === ctx.actor.userId) throw resourceUnavailable();
    const previous = await ctx.db.query("listGrantRevocations")
      .withIndex("by_list_recipient", q => q.eq("listId", args.listId).eq("recipientId", grant.recipientId)).unique();
    if (previous) await ctx.db.patch(previous._id, { revokedAt: Date.now() });
    else await ctx.db.insert("listGrantRevocations", { listId: args.listId, recipientId: grant.recipientId, revokedAt: Date.now() });
    await ctx.db.delete(grant._id);
  },
});

/** Leaving removes only this authenticated recipient's accepted grant. The
 * revocation tombstone prevents an old accepted invitation from restoring it.
 * Publication, ownership and independent copies are deliberately unaffected. */
export const { public: leaveList, internal: leaveListInternal } = actorMutation({
  scope: "*", resources: () => ({}),
  args: { listId: v.id("lists") },
  handler: async (ctx, args) => {
    const grant = await ctx.db.query("listGrants")
      .withIndex("by_list_recipient", q => q.eq("listId", args.listId).eq("recipientId", ctx.actor.userId)).unique();
    if (!grant) return;
    const previous = await ctx.db.query("listGrantRevocations")
      .withIndex("by_list_recipient", q => q.eq("listId", args.listId).eq("recipientId", ctx.actor.userId)).unique();
    if (previous) await ctx.db.patch(previous._id, { revokedAt: Date.now() });
    else await ctx.db.insert("listGrantRevocations", { listId: args.listId, recipientId: ctx.actor.userId, revokedAt: Date.now() });
    await ctx.db.delete(grant._id);
  },
});

/** Recipient-only discovery: explicit projection, never an invitation/email roster. */
export const { public: getSharedWithMe, internal: getSharedWithMeInternal } = actorQuery({
  scope: "lists:read", resources: () => ({}), args: {},
  handler: async (ctx) => {
    const grants = await ctx.db.query("listGrants")
      .withIndex("by_recipient", q => q.eq("recipientId", ctx.actor.userId)).collect();
    const resources = [];
    for (const grant of grants) {
      const list = await ctx.db.get(grant.listId);
      if (!list || list.ownerDid === ctx.actor.did || list.ownerDid === ctx.actor.legacyDid) continue;
      const owner = await ctx.db.query("users").withIndex("by_did", q => q.eq("did", list.ownerDid)).unique()
        ?? await ctx.db.query("users").withIndex("by_legacy_did", q => q.eq("legacyDid", list.ownerDid)).unique();
      const publication = await ctx.db.query("publications").withIndex("by_list", q => q.eq("listId", list._id)).unique();
      resources.push({ listId: list._id, name: list.name, kind: list.kind ?? "list",
        role: grant.role, owner: chosenPublicDisplayName(owner) ?? "Owner",
        published: publication?.status === "active", acceptedAt: grant.acceptedAt });
    }
    return resources.sort((a, b) => b.acceptedAt - a.acceptedAt);
  },
});
