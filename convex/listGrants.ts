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
