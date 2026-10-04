import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { resourceUnavailable } from "./authError";

/** Internal transactional seam for #257. Not a callable Convex function.
 * The invitation acceptance mutation MUST verify current invitation state,
 * expiry, verified email/account match and explicit acceptance in this SAME
 * transaction before calling this helper. Never call from invitation creation,
 * a public generic grant endpoint, or a historical-collaborator migration.
 * Repeated acceptance must be handled by the invitation state machine; this
 * helper rejects existing grants rather than restoring an obsolete role.
 */
export async function recordAcceptedListGrant(
  ctx: MutationCtx,
  args: { listId: Id<"lists">; ownerId: Id<"users">; recipientId: Id<"users">; role: "viewer" | "editor" },
) {
  const [list, owner, recipient] = await Promise.all([
    ctx.db.get(args.listId), ctx.db.get(args.ownerId), ctx.db.get(args.recipientId),
  ]);
  if (!list || !owner?.did || !recipient?.did || owner.deletionRequestedAt !== undefined
    || recipient.deletionRequestedAt !== undefined || owner._id === recipient._id
    || ![owner.did, owner.legacyDid].includes(list.ownerDid)) throw resourceUnavailable();
  const existing = await ctx.db.query("listGrants")
    .withIndex("by_list_recipient", q => q.eq("listId", args.listId).eq("recipientId", args.recipientId)).unique();
  if (existing) throw resourceUnavailable();
  return ctx.db.insert("listGrants", {
    listId: args.listId, recipientId: args.recipientId, role: args.role, acceptedAt: Date.now(),
  });
}
