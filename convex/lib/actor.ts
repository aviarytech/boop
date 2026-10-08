import { requireSession } from "./session";
/** The credential boundary shared by reactive browser calls and HTTP actions. */
import type { ActionCtx, QueryCtx, MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { AuthError } from "./auth";
import { extractTokenFromRequest } from "./jwt";
import { hasScope, hashApiKey, type Scope } from "./apiKeyHelpers";

export type Credentials = { authToken?: string; apiKey?: string };
export type ResolvedActor = {
  did: string;
  userId: import("../_generated/dataModel").Id<"users">;
  legacyDid?: string;
  turnkeySubOrgId?: string;
  scopes: string[];
  viaApiKey: boolean;
  /** Authenticated credential identity, separate from the account authorizing it. */
  credential: { kind: "session" | "apiKey"; id: string };
};

/** The credential behind an actor-wrapped operation, for audit rows written by shared
 * helpers. Server-originated work (crons, migrations) has none. */
export function actingCredential(ctx: object): ResolvedActor["credential"] | undefined {
  return "actor" in ctx ? (ctx.actor as ResolvedActor).credential : undefined;
}

export function requestCredentials(request: Request): Credentials {
  return {
    authToken: extractTokenFromRequest(request) ?? undefined,
    apiKey: request.headers.get("X-API-Key") ?? undefined,
  };
}

export async function authenticate(
  ctx: QueryCtx | MutationCtx,
  credentials: Credentials,
  allowDeletingAccount = false,
): Promise<ResolvedActor> {
  if (credentials.apiKey !== undefined) {
    const keyHash = await hashApiKey(credentials.apiKey);
    const key = await ctx.db.query("agentApiKeys")
      .withIndex("by_hash", q => q.eq("keyHash", keyHash)).first();
    if (!key || key.revokedAt !== undefined) throw new AuthError("Invalid API key", "INVALID_TOKEN");
    // Resolve the account on every operation, including keys minted before a DID migration.
    const user = await ctx.db.query("users").withIndex("by_did", q => q.eq("did", key.ownerDid)).first()
      ?? await ctx.db.query("users").withIndex("by_legacy_did", q => q.eq("legacyDid", key.ownerDid)).first();
    if (!user?.did || (!allowDeletingAccount && user.deletionRequestedAt !== undefined)) throw new AuthError("User unavailable", "UNAUTHORIZED");
    return { userId: user._id, did: user.did, legacyDid: user.legacyDid, scopes: key.scopes, viaApiKey: true, credential: { kind: "apiKey", id: key._id } };
  }
  const session = await requireSession(ctx, credentials.authToken);
  const user = await ctx.db.query("users")
    .withIndex("by_turnkey_id", q => q.eq("turnkeySubOrgId", session.turnkeySubOrgId)).first();
  if (!user?.did || (!allowDeletingAccount && user.deletionRequestedAt !== undefined)) throw new AuthError("User unavailable", "UNAUTHORIZED");
  return { userId: user._id, did: user.did, legacyDid: user.legacyDid, turnkeySubOrgId: session.turnkeySubOrgId, scopes: ["*"], viaApiKey: false, credential: { kind: "session", id: session.accessSessionId } };
}

export async function resolveActor(ctx: ActionCtx, request: Request): Promise<ResolvedActor> {
  return ctx.runQuery(internal.actorSession.resolve, await authenticatedRequest(ctx, request));
}

export function requireScope(actor: ResolvedActor, scope: Scope): void {
  if (!hasScope(actor.scopes, scope)) throw new AuthError(`Missing scope: ${scope}`, "FORBIDDEN");
}

/** Compatibility for existing HTTP JWT clients: register verified sessions lazily. */
export async function authenticatedRequest(ctx: ActionCtx, request: Request): Promise<Credentials> {
  const credentials = requestCredentials(request);
  if (credentials.apiKey === undefined && credentials.authToken) {
    await ctx.runMutation(internal.actorSession.establishInternal, { authToken: credentials.authToken });
  }
  return credentials;
}
