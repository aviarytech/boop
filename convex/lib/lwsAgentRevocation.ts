/**
 * Ending every LWS agent of an account at once (docs/lws-agent-auth.md).
 * Used when the account's DID is re-minted: the new DID doesn't list the
 * agents' keys, and the agents' rows name the old one.
 */
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/** Revoke the account's agents, delete their access tokens, and expire its pending access requests. */
export async function revokeAllLwsAgents(ctx: MutationCtx, userId: Id<"users">, now = Date.now()): Promise<{ agents: number; tokens: number; requests: number }> {
  let tokens = 0;
  for (const token of await ctx.db.query("lwsAccessTokens").withIndex("by_user", q => q.eq("userId", userId)).collect()) {
    await ctx.db.delete(token._id);
    tokens++;
  }
  let agents = 0;
  for (const agent of await ctx.db.query("lwsAgents").withIndex("by_user", q => q.eq("userId", userId)).collect()) {
    if (agent.revokedAt !== undefined) continue;
    await ctx.db.patch(agent._id, { revokedAt: now });
    agents++;
  }
  let requests = 0;
  for (const row of await ctx.db.query("lwsAccessRequests").withIndex("by_user_status", q => q.eq("userId", userId).eq("status", "pending")).collect()) {
    await ctx.db.patch(row._id, { status: "expired" });
    requests++;
  }
  return { agents, tokens, requests };
}
