/**
 * LWS agents (docs/lws-agent-auth.md): access requests, the owner's decisions
 * on them, and the token exchange. HTTP adapters are in lwsHttp.ts.
 *
 * Everything an agent reaches is internal and re-verifies the agent's JWT in
 * its own transaction, so the jti is consumed atomically with what it buys.
 * Owner operations take a signed-in session only: scope `*`, and refused for
 * every delegated credential (API keys and agents) even if one held `*`.
 *
 * Random values (request ids, fragments, access tokens) are drawn by the HTTP
 * action and passed in: mutations run with a seeded random source.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { actorMutation, actorQuery } from "./lib/authenticated";
import type { ResolvedActor } from "./lib/actor";
import { resourceUnavailable } from "./lib/authError";
import { hashApiKey } from "./lib/apiKeyHelpers";
import { latestDidState, LwsJwtError, selectAgentMethod, unverifiedSubject, verifyAgentJwt, verifyDidKeyJwt, type VerifiedClaims } from "./lib/lwsJwt";
import { accessRequestDocument, canonicalActions, narrowActions, narrowActionsByScope, parseActions, parseAgentName, scopesForActions } from "./lib/lwsAccess";
import { accessRequestsUri, accessRequestUri, lwsBaseUrl, storageUri, USER_PATH_PATTERN } from "./lib/lwsUrls";
import {
  ACCESS_REQUEST_ID_PATTERN,
  LWS_ACCESS_REQUEST_TTL_MS,
  LWS_ACCESS_TOKEN_PREFIX,
  LWS_ACCESS_TOKEN_TTL_MS,
  MAX_PENDING_ACCESS_REQUESTS,
} from "./lib/lwsTokens";
import { isAgentFragment, MAX_AGENT_METHODS } from "../shared/authorDid";

type Failure = { ok: false; status: number; title: string; detail?: string; location?: string };
const failure = (status: number, title: string, detail?: string, location?: string): Failure => ({ ok: false, status, title, detail, location });

/** Record a verified credential's jti; false if it was already used. */
async function consumeJti(ctx: MutationCtx, claims: VerifiedClaims): Promise<boolean> {
  const jtiHash = await hashApiKey(claims.replayKey);
  const seen = await ctx.db.query("lwsJtis").withIndex("by_hash", q => q.eq("jtiHash", jtiHash)).first();
  if (seen) return false;
  await ctx.db.insert("lwsJtis", { jtiHash, expiresAt: claims.replayUntil });
  return true;
}

/** The account a storage path belongs to, only while it serves an author DID that account holds. */
export async function storageAccount(ctx: QueryCtx, userPath: string) {
  const log = await ctx.db.query("didLogs").withIndex("by_path", q => q.eq("path", userPath)).first();
  if (!log?.author) return null;
  const user = await ctx.db.query("users").withIndex("by_did", q => q.eq("did", log.userDid)).first();
  if (!user?.did || user.did !== log.userDid || user.deletionRequestedAt !== undefined) return null;
  return { user: user as Doc<"users"> & { did: string }, log };
}

/** Mark a pending request expired if its time is up. Returns the row as it now stands. */
async function settleExpiry(ctx: MutationCtx, row: Doc<"lwsAccessRequests">, now: number): Promise<Doc<"lwsAccessRequests">> {
  if (row.status !== "pending" || row.expiresAt > now) return row;
  await ctx.db.patch(row._id, { status: "expired" });
  return { ...row, status: "expired" };
}

const view = (row: Doc<"lwsAccessRequests">) => ({
  requestId: row.requestId, storage: row.storage, agentDidKey: row.agentDidKey, name: row.name, actions: row.actions,
  status: row.status, createdAt: row.createdAt, expiresAt: row.expiresAt, decidedAt: row.decidedAt,
});

// ---------------------------------------------------------------------------
// Agent side (internal; lwsHttp.ts)
// ---------------------------------------------------------------------------

/** POST B/lws-access/requests: the request, proven by a JWT signed by the assignee's did:key. */
export const createAccessRequestInternal = internalMutation({
  args: {
    jwt: v.string(),
    request: v.object({
      userPath: v.string(),
      assignee: v.string(),
      actions: v.array(v.string()),
      name: v.string(),
    }),
    requestId: v.string(),
    /** Candidate fragments; the first one not already used for this account is assigned. */
    fragments: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true; created: boolean; location: string; document: unknown } | Failure> => {
    const now = Date.now();
    const base = lwsBaseUrl();
    let claims;
    try { claims = verifyDidKeyJwt(args.jwt, { audience: accessRequestsUri(base), now }); }
    catch (error) {
      if (error instanceof LwsJwtError) return failure(401, "Invalid credential", error.message);
      throw error;
    }
    if (claims.didKey !== args.request.assignee) return failure(403, "The credential is not the assignee's");
    if (!ACCESS_REQUEST_ID_PATTERN.test(args.requestId) || !args.fragments.every(isAgentFragment)) throw new Error("Invalid identifiers");
    // lwsHttp.ts parsed the body (lib/lwsAccess.ts parseAccessRequest); its parts are checked again here.
    const actions = parseActions(args.request.actions);
    const name = parseAgentName(args.request.name);
    if (!actions || name === null || !USER_PATH_PATTERN.test(args.request.userPath)) return failure(400, "Invalid access request");
    const account = await storageAccount(ctx, args.request.userPath);
    if (!account) return failure(404, "No such storage");
    if (!await consumeJti(ctx, claims)) return failure(401, "Invalid credential", "This jti was already used");
    const { user } = account;

    // The same key, again: an active agent is a conflict; a pending request is
    // returned to the key's holder (a retry after a lost response).
    const agents = await ctx.db.query("lwsAgents").withIndex("by_user", q => q.eq("userId", user._id)).collect();
    const active = agents.filter(agent => agent.revokedAt === undefined);
    if (active.some(agent => agent.publicKeyMultibase === claims.publicKeyMultibase)) {
      return failure(409, "This key is already an agent of this storage");
    }
    if (active.length >= MAX_AGENT_METHODS) return failure(409, "This storage has as many agents as it can");
    const pending: Doc<"lwsAccessRequests">[] = [];
    for (const row of await ctx.db.query("lwsAccessRequests").withIndex("by_user_status", q => q.eq("userId", user._id).eq("status", "pending")).collect()) {
      if ((await settleExpiry(ctx, row, now)).status === "pending") pending.push(row);
    }
    const existing = pending.find(row => row.agentDidKey === claims.didKey);
    if (existing) {
      return { ok: true, created: false, location: accessRequestUri(existing.requestId, base), document: accessRequestDocument(view(existing), accessRequestUri(existing.requestId, base)) };
    }
    // The key is still an agent method of the DID, but no active agent or
    // pending request holds it: a revoked agent's key whose removal failed.
    // Approving it again would need a second method with the same key, which
    // the author DID rule refuses, so say what to do instead.
    const didState = latestDidState(account.log.log);
    const leftover = (didState?.verificationMethod ?? []).find(vm =>
      vm.publicKeyMultibase === claims.publicKeyMultibase && isAgentFragment((vm.id ?? "").split("#").pop() ?? ""));
    if (leftover) {
      return failure(409, "This key is still in the owner's DID",
        `A revoked agent's key is still listed in this storage's DID as #${(leftover.id ?? "").split("#").pop()}. The owner must remove it first (Settings → Agents, "Remove key from DID"), then this key can ask again.`);
    }
    // At the cap, the oldest pending request makes way: refusing new ones would
    // let anyone fill the queue and lock the owner's real agents out for a day.
    // The owner tells requests apart by the key fingerprint their agent printed.
    const evicted = [...pending].sort((a, b) => a.createdAt - b.createdAt).slice(0, Math.max(0, pending.length - MAX_PENDING_ACCESS_REQUESTS + 1));
    for (const row of evicted) await ctx.db.patch(row._id, { status: "expired" as const });
    if (await ctx.db.query("lwsAccessRequests").withIndex("by_request_id", q => q.eq("requestId", args.requestId)).first()) throw new Error("Request id collision");

    // A fragment no method of this DID has, nor any request or agent of this account.
    const used = new Set([
      ...agents.map(agent => agent.fragment),
      ...pending.map(row => row.fragment),
      ...(latestDidState(account.log.log)?.verificationMethod ?? []).map(vm => (vm.id ?? "").split("#").pop() ?? ""),
    ]);
    const fragment = args.fragments.find(candidate => !used.has(candidate));
    if (!fragment) throw new Error("No free agent fragment");

    const row = {
      requestId: args.requestId,
      storage: storageUri(args.request.userPath, base),
      userId: user._id,
      ownerDid: user.did,
      agentDidKey: claims.didKey,
      agentPublicKeyMultibase: claims.publicKeyMultibase,
      fragment,
      name,
      actions,
      status: "pending" as const,
      createdAt: now,
      expiresAt: now + LWS_ACCESS_REQUEST_TTL_MS,
    };
    await ctx.db.insert("lwsAccessRequests", row);
    const location = accessRequestUri(args.requestId, base);
    return { ok: true, created: true, location, document: accessRequestDocument(row, location) };
  },
});

/** GET B/lws-access/requests/{id}: the request's status, and its grant once approved, for its assignee only. */
export const pollAccessRequestInternal = internalMutation({
  args: { jwt: v.string(), requestId: v.string() },
  handler: async (ctx, args): Promise<{ ok: true; document: unknown } | Failure> => {
    const now = Date.now();
    const base = lwsBaseUrl();
    const url = accessRequestUri(args.requestId, base);
    let claims;
    try { claims = verifyDidKeyJwt(args.jwt, { audience: [accessRequestsUri(base), url], now }); }
    catch (error) {
      if (error instanceof LwsJwtError) return failure(401, "Invalid credential", error.message);
      throw error;
    }
    const found = await ctx.db.query("lwsAccessRequests").withIndex("by_request_id", q => q.eq("requestId", args.requestId)).first();
    // Someone else's request reads exactly like a missing one. Neither writes
    // anything, not even the jti: only a request's own assignee can make a row.
    if (!found || found.agentDidKey !== claims.didKey) return failure(404, "No such access request");
    if (!await consumeJti(ctx, claims)) return failure(401, "Invalid credential", "This jti was already used");
    const row = await settleExpiry(ctx, found, now);
    let grant;
    if (row.status === "approved" && row.agentId) {
      const agent = await ctx.db.get(row.agentId);
      grant = agent ? { vmId: agent.vmId, actions: agent.actions, revoked: agent.revokedAt !== undefined } : undefined;
    }
    return { ok: true, document: accessRequestDocument(view(row), url, grant) };
  },
});

/**
 * POST B/oauth/token (RFC 8693): an agent's JWT, signed as the user with its
 * agent method, for an access token to the user's storage.
 */
export const exchangeTokenInternal = internalMutation({
  args: {
    subjectToken: v.string(),
    resource: v.string(),
    /** Space-separated actions or scopes; narrows the agent's actions when present. */
    scope: v.optional(v.string()),
    /** The `lwsat_` token to issue, drawn by the caller. */
    accessToken: v.string(),
  },
  handler: async (ctx, args): Promise<
    | { ok: true; accessToken: string; expiresIn: number; scope: string }
    | { ok: false; error: "invalid_request" | "invalid_target" | "invalid_scope"; description: string }
  > => {
    const now = Date.now();
    const base = lwsBaseUrl();
    // RFC 8693 2.2.2: an invalid or unacceptable subject token is invalid_request.
    const invalid = (description: string) => ({ ok: false as const, error: "invalid_request" as const, description });
    if (!args.accessToken.startsWith(LWS_ACCESS_TOKEN_PREFIX) || args.accessToken.length < 40) throw new Error("Invalid access token");

    // Find the key: the stored, write-verified log of the DID the JWT claims.
    const subject = unverifiedSubject(args.subjectToken);
    if (!subject?.startsWith("did:webvh:")) return invalid("The subject token's sub is not a did:webvh");
    const log = await ctx.db.query("didLogs").withIndex("by_user_did", q => q.eq("userDid", subject)).first();
    const document = log?.author ? latestDidState(log.log) : null;
    if (!log || !document || document.id !== subject) return invalid("The subject is not an author DID served here");
    let claims;
    try { claims = verifyAgentJwt(args.subjectToken, { audience: base, now, document }); }
    catch (error) {
      if (error instanceof LwsJwtError) return invalid(error.message);
      throw error;
    }
    if (args.resource !== storageUri(log.path, base)) return { ok: false, error: "invalid_target", description: "resource is not the subject's storage" };

    const user = await ctx.db.query("users").withIndex("by_did", q => q.eq("did", subject)).first();
    if (!user || user.deletionRequestedAt !== undefined) return invalid("The subject's account is unavailable");
    // The DID listing the key is not enough: the owner approved it, and hasn't revoked it.
    const agents = await ctx.db.query("lwsAgents").withIndex("by_vm", q => q.eq("vmId", claims.kid)).collect();
    const agent = agents.find(row => row.revokedAt === undefined);
    if (!agent || agent.userId !== user._id || agent.ownerDid !== subject || agent.publicKeyMultibase !== claims.publicKeyMultibase) {
      return invalid("The agent is not approved");
    }
    // The token carries the agent's actions, or fewer when `scope` narrows
    // them (lib/lwsAccess.ts narrowActionsByScope); its scopes follow.
    const actions = args.scope === undefined ? canonicalActions(agent.actions) : narrowActionsByScope(agent.actions, args.scope);
    if (!actions || actions.length === 0) return { ok: false, error: "invalid_scope", description: "scope must name some of the agent's actions (read, create, update, delete)" };
    const scopes = scopesForActions(actions).filter(scope => agent.scopes.includes(scope));
    if (!await consumeJti(ctx, claims)) return invalid("This jti was already used");

    const expiresAt = now + LWS_ACCESS_TOKEN_TTL_MS;
    const id = await ctx.db.insert("lwsAccessTokens", {
      tokenHash: await hashApiKey(args.accessToken), agentId: agent._id, userId: user._id, storage: args.resource, scopes, actions, expiresAt,
    });
    await ctx.scheduler.runAt(expiresAt, internal.lwsAccess.deleteAccessToken, { id });
    await ctx.db.patch(agent._id, { lastUsedAt: now });
    return { ok: true, accessToken: args.accessToken, expiresIn: Math.floor(LWS_ACCESS_TOKEN_TTL_MS / 1000), scope: actions.join(" ") };
  },
});

export const deleteAccessToken = internalMutation({
  args: { id: v.id("lwsAccessTokens") },
  handler: async (ctx, { id }) => {
    const token = await ctx.db.get(id);
    if (token && token.expiresAt <= Date.now()) await ctx.db.delete(id);
  },
});

/** Decided and expired access requests are kept this long after they expire, then deleted. */
const DECIDED_REQUEST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CLEANUP_BATCH = 200;

/**
 * Cron: expire undecided requests; delete decided and expired requests a
 * month old, spent jtis, and expired tokens a scheduled delete missed. Each
 * run does a bounded batch of each and, while any batch was full, schedules
 * itself again at once, so a backlog drains without waiting for the cron.
 */
export const cleanupInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const requests = await ctx.db.query("lwsAccessRequests").withIndex("by_status_expires", q => q.eq("status", "pending").lte("expiresAt", now)).take(CLEANUP_BATCH);
    for (const row of requests) await ctx.db.patch(row._id, { status: "expired" });
    let old = 0;
    let full = requests.length === CLEANUP_BATCH;
    for (const status of ["approved", "denied", "expired"] as const) {
      const rows = await ctx.db.query("lwsAccessRequests").withIndex("by_status_expires", q => q.eq("status", status).lte("expiresAt", now - DECIDED_REQUEST_RETENTION_MS)).take(CLEANUP_BATCH);
      for (const row of rows) await ctx.db.delete(row._id);
      old += rows.length;
      full ||= rows.length === CLEANUP_BATCH;
    }
    const jtis = await ctx.db.query("lwsJtis").withIndex("by_expires_at", q => q.lte("expiresAt", now)).take(CLEANUP_BATCH);
    for (const row of jtis) await ctx.db.delete(row._id);
    const tokens = await ctx.db.query("lwsAccessTokens").withIndex("by_expires_at", q => q.lte("expiresAt", now)).take(CLEANUP_BATCH);
    for (const row of tokens) await ctx.db.delete(row._id);
    full ||= jtis.length === CLEANUP_BATCH || tokens.length === CLEANUP_BATCH;
    if (full) await ctx.scheduler.runAfter(0, internal.lwsAccess.cleanupInternal, {});
    return { requests: requests.length, old, jtis: jtis.length, tokens: tokens.length, more: full };
  },
});

// ---------------------------------------------------------------------------
// Owner side
// ---------------------------------------------------------------------------

/** A signed-in person only: never an API key or an agent, whatever its scopes. */
function requireSessionActor(actor: ResolvedActor): void {
  if (actor.viaApiKey || actor.credential.kind !== "session") throw resourceUnavailable();
}

async function pendingFor(ctx: QueryCtx, userId: Id<"users">) {
  const now = Date.now();
  const rows = await ctx.db.query("lwsAccessRequests").withIndex("by_user_status", q => q.eq("userId", userId).eq("status", "pending")).collect();
  return rows.filter(row => row.expiresAt > now).map(row => ({
    requestId: row.requestId,
    name: row.name,
    actions: row.actions,
    scopes: scopesForActions(row.actions),
    fragment: row.fragment,
    agentDidKey: row.agentDidKey,
    agentPublicKeyMultibase: row.agentPublicKeyMultibase,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  }));
}

async function activeFor(ctx: QueryCtx, userId: Id<"users">) {
  const rows = await ctx.db.query("lwsAgents").withIndex("by_user", q => q.eq("userId", userId)).collect();
  return rows.filter(row => row.revokedAt === undefined).map(row => ({
    agentId: row._id,
    name: row.name,
    fragment: row.fragment,
    vmId: row.vmId,
    publicKeyMultibase: row.publicKeyMultibase,
    actions: row.actions,
    scopes: row.scopes,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  }));
}

async function pendingRequestOf(ctx: MutationCtx, userId: Id<"users">, requestId: string) {
  const row = await ctx.db.query("lwsAccessRequests").withIndex("by_request_id", q => q.eq("requestId", requestId)).first();
  if (!row || row.userId !== userId) throw resourceUnavailable();
  const settled = await settleExpiry(ctx, row, Date.now());
  if (settled.status !== "pending") throw new ConvexError(`This access request is ${settled.status}`);
  return settled;
}

/**
 * Approve after the DID update: the stored log (verified on write) must now
 * list exactly the requested key at `#<fragment>` in `authentication`.
 */
async function approve(ctx: MutationCtx, userId: Id<"users">, requestId: string, narrowed: string[] | undefined) {
  const row = await pendingRequestOf(ctx, userId, requestId);
  const user = await ctx.db.get(userId);
  if (!user?.did || user.deletionRequestedAt !== undefined) throw resourceUnavailable();
  if (user.did !== row.ownerDid) throw new ConvexError("This account's DID changed since the request was made");
  const actions = narrowActions(row.actions, narrowed);
  if (!actions) throw new ConvexError("Approved actions can only narrow the requested ones");
  const log = await ctx.db.query("didLogs").withIndex("by_user_did", q => q.eq("userDid", user.did!)).first();
  const document = log?.author ? latestDidState(log.log) : null;
  if (!document || document.id !== user.did) throw new ConvexError("This account's DID is not an author DID");
  const vmId = `${user.did}#${row.fragment}`;
  let method;
  try { method = selectAgentMethod(document, vmId); }
  catch { throw new ConvexError(`The DID does not list #${row.fragment} yet: publish the DID update first`); }
  if (method.publicKeyMultibase !== row.agentPublicKeyMultibase) throw new ConvexError(`#${row.fragment} in the DID is not the requested key`);
  const existing = await ctx.db.query("lwsAgents").withIndex("by_vm", q => q.eq("vmId", vmId)).collect();
  if (existing.some(agent => agent.revokedAt === undefined)) throw new ConvexError(`#${row.fragment} is already an agent`);
  const now = Date.now();
  const agentId = await ctx.db.insert("lwsAgents", {
    userId, ownerDid: user.did, fragment: row.fragment, vmId, publicKeyMultibase: row.agentPublicKeyMultibase,
    name: row.name, actions, scopes: scopesForActions(actions), requestId: row.requestId, createdAt: now,
  });
  await ctx.db.patch(row._id, { status: "approved", decidedAt: now, agentId });
  return { agentId, vmId };
}

async function deny(ctx: MutationCtx, userId: Id<"users">, requestId: string) {
  const row = await pendingRequestOf(ctx, userId, requestId);
  await ctx.db.patch(row._id, { status: "denied", decidedAt: Date.now() });
  return null;
}

/** Revoke whether or not the DID still lists the key: tokens and the token endpoint check this row. */
async function revoke(ctx: MutationCtx, userId: Id<"users">, agentId: Id<"lwsAgents">) {
  const agent = await ctx.db.get(agentId);
  if (!agent || agent.userId !== userId) throw resourceUnavailable();
  if (agent.revokedAt === undefined) await ctx.db.patch(agentId, { revokedAt: Date.now() });
  for (const token of await ctx.db.query("lwsAccessTokens").withIndex("by_agent", q => q.eq("agentId", agentId)).collect()) {
    await ctx.db.delete(token._id);
  }
  return { fragment: agent.fragment, vmId: agent.vmId };
}

export const { public: pendingAccessRequests, internal: pendingAccessRequestsInternal } = actorQuery({
  resources: () => ({}), scope: "*", args: {},
  handler: async (ctx) => { requireSessionActor(ctx.actor); return pendingFor(ctx, ctx.actor.userId); },
});

export const { public: activeAgents, internal: activeAgentsInternal } = actorQuery({
  resources: () => ({}), scope: "*", args: {},
  handler: async (ctx) => { requireSessionActor(ctx.actor); return activeFor(ctx, ctx.actor.userId); },
});

export const { public: approveAccessRequest, internal: approveAccessRequestInternal } = actorMutation({
  resources: () => ({}), scope: "*", authority: "owner",
  args: { requestId: v.string(), actions: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => { requireSessionActor(ctx.actor); return approve(ctx, ctx.actor.userId, args.requestId, args.actions); },
});

export const { public: denyAccessRequest, internal: denyAccessRequestInternal } = actorMutation({
  resources: () => ({}), scope: "*", authority: "owner",
  args: { requestId: v.string() },
  handler: async (ctx, args) => { requireSessionActor(ctx.actor); return deny(ctx, ctx.actor.userId, args.requestId); },
});

export const { public: revokeAgent, internal: revokeAgentInternal } = actorMutation({
  resources: () => ({}), scope: "*", authority: "owner",
  args: { agentId: v.id("lwsAgents") },
  handler: async (ctx, args) => { requireSessionActor(ctx.actor); return revoke(ctx, ctx.actor.userId, args.agentId); },
});

// Dev e2e (`npx convex run lwsAccess:<name> '{"userId": …}'`): the same
// operations for a named account, with no credential. Internal only.
export const pendingAccessRequestsForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: (ctx, { userId }) => pendingFor(ctx, userId),
});
export const activeAgentsForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: (ctx, { userId }) => activeFor(ctx, userId),
});
export const approveAccessRequestForUser = internalMutation({
  args: { userId: v.id("users"), requestId: v.string(), actions: v.optional(v.array(v.string())) },
  handler: (ctx, args) => approve(ctx, args.userId, args.requestId, args.actions),
});
export const denyAccessRequestForUser = internalMutation({
  args: { userId: v.id("users"), requestId: v.string() },
  handler: (ctx, args) => deny(ctx, args.userId, args.requestId),
});
export const revokeAgentForUser = internalMutation({
  args: { userId: v.id("users"), agentId: v.id("lwsAgents") },
  handler: (ctx, args) => revoke(ctx, args.userId, args.agentId),
});
