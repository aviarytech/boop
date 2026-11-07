import { requireSession } from "./session";
/** The credential boundary shared by reactive browser calls and HTTP actions. */
import type { ActionCtx, QueryCtx, MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { AuthError } from "./auth";
import { extractTokenFromRequest } from "./jwt";
import { hasScope, hashApiKey, type Scope } from "./apiKeyHelpers";
import { LWS_ACCESS_TOKEN_PREFIX, bearerToken } from "./lwsTokens";

/** `agentToken` is an LWS access token (`lwsat_…`, convex/lwsToken.ts), never a session JWT. */
export type Credentials = { authToken?: string; apiKey?: string; agentToken?: string };
export type ResolvedActor = {
  did: string;
  userId: import("../_generated/dataModel").Id<"users">;
  legacyDid?: string;
  turnkeySubOrgId?: string;
  scopes: string[];
  /** True for every delegated credential (API keys and LWS agents): never a signed-in person. */
  viaApiKey: boolean;
  /** Authenticated credential identity, separate from the account authorizing it. */
  credential: { kind: "session" | "apiKey" | "agent"; id: string };
};

/** The credential behind an actor-wrapped operation, for audit rows written by shared
 * helpers. Server-originated work (crons, migrations) has none. */
export function actingCredential(ctx: object): ResolvedActor["credential"] | undefined {
  return "actor" in ctx ? (ctx.actor as ResolvedActor).credential : undefined;
}

/** Read projection: credential row IDs are stored for audit, never returned to readers
 * (published lists are readable by any signed-in account). */
export function withoutCredential<T extends { credential?: unknown }>(row: T): Omit<T, "credential"> {
  const { credential: _credential, ...rest } = row;
  void _credential;
  return rest;
}

export function requestCredentials(request: Request): Credentials {
  // An LWS access token is only ever an agentToken; extractTokenFromRequest skips it.
  const bearer = bearerToken(request);
  return {
    authToken: extractTokenFromRequest(request) ?? undefined,
    apiKey: request.headers.get("X-API-Key") ?? undefined,
    agentToken: bearer?.startsWith(LWS_ACCESS_TOKEN_PREFIX) ? bearer : undefined,
  };
}

/** Find the account a delegated credential acts for, by its owner DID (current or pre-migration). */
async function delegatingUser(ctx: QueryCtx | MutationCtx, ownerDid: string, allowDeletingAccount: boolean) {
  const user = await ctx.db.query("users").withIndex("by_did", q => q.eq("did", ownerDid)).first()
    ?? await ctx.db.query("users").withIndex("by_legacy_did", q => q.eq("legacyDid", ownerDid)).first();
  if (!user?.did || (!allowDeletingAccount && user.deletionRequestedAt !== undefined)) throw new AuthError("User unavailable", "UNAUTHORIZED");
  return user as typeof user & { did: string };
}

export async function authenticate(
  ctx: QueryCtx | MutationCtx,
  credentials: Credentials,
  allowDeletingAccount = false,
): Promise<ResolvedActor> {
  if (credentials.agentToken !== undefined) {
    // One credential per call: an agent token never combines with another.
    if (credentials.apiKey !== undefined || credentials.authToken !== undefined) throw new AuthError("Invalid access token", "INVALID_TOKEN");
    if (!credentials.agentToken.startsWith(LWS_ACCESS_TOKEN_PREFIX)) throw new AuthError("Invalid access token", "INVALID_TOKEN");
    const tokenHash = await hashApiKey(credentials.agentToken);
    const token = await ctx.db.query("lwsAccessTokens").withIndex("by_hash", q => q.eq("tokenHash", tokenHash)).first();
    if (!token || token.expiresAt <= Date.now()) throw new AuthError("Invalid access token", "INVALID_TOKEN");
    const agent = await ctx.db.get(token.agentId);
    if (!agent || agent.revokedAt !== undefined || agent.userId !== token.userId) throw new AuthError("Invalid access token", "INVALID_TOKEN");
    // The account is found by the agent's DID on every call, as for API keys,
    // and must still be the account the agent was approved for.
    const user = await delegatingUser(ctx, agent.ownerDid, allowDeletingAccount);
    if (user._id !== agent.userId) throw new AuthError("User unavailable", "UNAUTHORIZED");
    // The token's scopes were the agent's when issued; never more than the agent's now.
    const scopes = agent.scopes.filter(scope => token.scopes.includes(scope));
    return { userId: user._id, did: user.did, legacyDid: user.legacyDid, scopes, viaApiKey: true, credential: { kind: "agent", id: agent._id } };
  }
  if (credentials.apiKey !== undefined) {
    const keyHash = await hashApiKey(credentials.apiKey);
    const key = await ctx.db.query("agentApiKeys")
      .withIndex("by_hash", q => q.eq("keyHash", keyHash)).first();
    if (!key || key.revokedAt !== undefined) throw new AuthError("Invalid API key", "INVALID_TOKEN");
    // Resolve the account on every operation, including keys minted before a DID migration.
    const user = await delegatingUser(ctx, key.ownerDid, allowDeletingAccount);
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
  if (credentials.apiKey === undefined && credentials.agentToken === undefined && credentials.authToken) {
    await ctx.runMutation(internal.actorSession.establishInternal, { authToken: credentials.authToken });
  }
  return credentials;
}
