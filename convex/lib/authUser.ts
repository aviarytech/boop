import type { ActionCtx } from "../_generated/server";
import { resolveActor, requireScope, type ResolvedActor } from "./actor";
export type AuthenticatedUser = ResolvedActor;
export async function requireAuthenticatedUser(ctx: ActionCtx, request: Request): Promise<AuthenticatedUser> {
  const actor = await resolveActor(ctx, request);
  requireScope(actor, "*");
  return actor;
}
