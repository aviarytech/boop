import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { actorMutation, actorQuery, type ActorCtx } from "./lib/authenticated";
import { resourceUnavailable } from "./lib/authError";
import { requireSession } from "./lib/session";
import { listRole } from "./lib/permissions";
import { recordAcceptedListGrant } from "./lib/listGrants";
import { hashApiKey } from "./lib/apiKeyHelpers";

const role = v.union(v.literal("viewer"), v.literal("editor"));
const handle = { invitationId: v.id("listInvitations"), version: v.number() };
const ownerHandle = { listId: v.id("lists"), ...handle };
const WEEK = 7 * 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const ownerResources = (args: { listId: Id<"lists"> }) => ({ lists: [args.listId] });
const noResources = () => ({});
function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("Invalid email");
  return normalized;
}
async function verifiedEmail(ctx: ActorCtx<QueryCtx | MutationCtx>) {
  // API keys and user-supplied profile email are not proof of mailbox control.
  if (ctx.actor.viaApiKey) throw resourceUnavailable();
  const session = await requireSession(ctx, ctx.credentials.authToken);
  return normalizeEmail(session.email);
}
async function live(ctx: QueryCtx | MutationCtx, invite: Doc<"listInvitations">) {
  const owner = await ctx.db.get(invite.ownerId);
  return !!owner?.did && owner.deletionRequestedAt === undefined
    && await listRole(ctx, invite.listId, owner.did, owner.legacyDid) === "owner";
}
async function predatesRevocation(ctx: QueryCtx | MutationCtx, invite: Doc<"listInvitations">, recipientId: Id<"users">) {
  const revocation = await ctx.db.query("listGrantRevocations")
    .withIndex("by_list_recipient", q => q.eq("listId", invite.listId).eq("recipientId", recipientId)).unique();
  // Same-millisecond ambiguity fails closed; resend on a later clock tick is explicit new authority.
  return !!revocation && revocation.revokedAt >= invite.issuedAt;
}
function pending(invite: Doc<"listInvitations">) {
  return invite.status === "pending" && invite.expiresAt > Date.now();
}
function result(invite: Doc<"listInvitations">) {
  return { invitationId: invite._id, version: invite.version };
}
async function owned(ctx: MutationCtx, args: { listId: Id<"lists">; invitationId: Id<"listInvitations">; version: number }) {
  const invite = await ctx.db.get(args.invitationId);
  if (!invite || invite.listId !== args.listId || invite.version !== args.version) throw resourceUnavailable();
  return invite;
}
async function receipt(ctx: MutationCtx, ownerId: Id<"users">, requestId: string, fingerprint: string) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(requestId)) throw new Error("Invalid requestId");
  const previous = await ctx.db.query("invitationRequests").withIndex("by_owner_request", q => q.eq("ownerId", ownerId).eq("requestId", requestId)).unique();
  if (previous && previous.fingerprint !== fingerprint) throw new Error("requestId already used");
  return previous ? { invitationId: previous.invitationId, version: previous.version } : null;
}
async function remember(ctx: MutationCtx, ownerId: Id<"users">, requestId: string, fingerprint: string, value: { invitationId: Id<"listInvitations">; version: number }) {
  await ctx.db.insert("invitationRequests", { ownerId, requestId, fingerprint, ...value });
  return value;
}
async function budget(ctx: MutationCtx, key: string, max: number, windowMs: number) {
  const now = Date.now();
  const row = await ctx.db.query("rateLimits").withIndex("by_key_endpoint", q => q.eq("key", key).eq("endpoint", "private-invitation")).unique();
  if (row && now < row.windowStart + windowMs) {
    if (row.attempts >= max) throw new Error("Invitation rate limit reached. Try again later.");
    await ctx.db.patch(row._id, { attempts: row.attempts + 1 });
  } else {
    const value = { key, endpoint: "private-invitation", attempts: 1, windowStart: now, expiresAt: now + windowMs * 2 };
    if (row) await ctx.db.patch(row._id, value);
    else await ctx.db.insert("rateLimits", value);
  }
}
async function send(ctx: MutationCtx, ownerId: Id<"users">, email: string, invitationId: Id<"listInvitations">, version: number) {
  await budget(ctx, `inviter:${ownerId}`, 30, HOUR);
  await budget(ctx, `inviter-recipient:${ownerId}:${await hashApiKey(email)}`, 3, HOUR);
  await budget(ctx, `invitation-recipient:${await hashApiKey(email)}`, 10, 24 * HOUR);
  await ctx.scheduler.runAfter(0, internal.invitationMail.deliver, { invitationId, version });
}

/** No recipient account lookup: existing and future accounts have identical results. */
export const { public: createInvitation, internal: createInvitationInternal } = actorMutation({
  authority: "owner", scope: "*", resources: ownerResources,
  args: { listId: v.id("lists"), email: v.string(), role: v.optional(role), requestId: v.string() },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    const intendedRole = args.role ?? "viewer";
    const fingerprint = await hashApiKey(JSON.stringify(["create", args.listId, email, intendedRole]));
    const previous = await receipt(ctx, ctx.actor.userId, args.requestId, fingerprint);
    if (previous) return previous;
    await budget(ctx, `invitation-request:${ctx.actor.userId}`, 120, HOUR);
    const existing = await ctx.db.query("listInvitations").withIndex("by_list_email", q => q.eq("listId", args.listId).eq("email", email)).unique();
    // Creating again never resends, revives or changes permissions. Use explicit management operations.
    if (existing) return remember(ctx, ctx.actor.userId, args.requestId, fingerprint, result(existing));
    const now = Date.now();
    const invitationId = await ctx.db.insert("listInvitations", {
      listId: args.listId, ownerId: ctx.actor.userId, email, role: intendedRole,
      version: 1, createdAt: now, issuedAt: now, expiresAt: now + WEEK, status: "pending", delivery: "queued",
    });
    await send(ctx, ctx.actor.userId, email, invitationId, 1);
    await ctx.scheduler.runAt(now + WEEK, internal.invitations.expireInvitation, { invitationId, version: 1 });
    return remember(ctx, ctx.actor.userId, args.requestId, fingerprint, { invitationId, version: 1 });
  },
});

export const { public: resendInvitation, internal: resendInvitationInternal } = actorMutation({
  authority: "owner", scope: "*", resources: ownerResources,
  args: { ...ownerHandle, requestId: v.string() },
  handler: async (ctx, args) => {
    const fingerprint = await hashApiKey(JSON.stringify(["resend", args.listId, args.invitationId, args.version]));
    const previous = await receipt(ctx, ctx.actor.userId, args.requestId, fingerprint);
    if (previous) return previous;
    await budget(ctx, `invitation-request:${ctx.actor.userId}`, 120, HOUR);
    const invite = await owned(ctx, args);
    if (invite.status === "accepted" && invite.grantId && await ctx.db.get(invite.grantId)) throw resourceUnavailable();
    const version = invite.version + 1;
    await send(ctx, ctx.actor.userId, invite.email, invite._id, version);
    const issuedAt = Date.now();
    const expiresAt = issuedAt + WEEK;
    await ctx.scheduler.runAt(expiresAt, internal.invitations.expireInvitation, { invitationId: invite._id, version });
    await ctx.db.patch(invite._id, { version, status: "pending", issuedAt, expiresAt, delivery: "queued", recipientId: undefined, grantId: undefined });
    return remember(ctx, ctx.actor.userId, args.requestId, fingerprint, { invitationId: invite._id, version });
  },
});

export const { public: revokeInvitation, internal: revokeInvitationInternal } = actorMutation({
  authority: "owner", scope: "*", resources: ownerResources, args: ownerHandle,
  handler: async (ctx, args) => {
    const invite = await owned(ctx, args);
    // Accepted account grants are managed by listGrants, never by a historical email link.
    if (invite.status === "accepted") throw resourceUnavailable();
    await ctx.db.patch(invite._id, { status: "revoked" });
  },
});
export const { public: updateInvitationRole, internal: updateInvitationRoleInternal } = actorMutation({
  authority: "owner", scope: "*", resources: ownerResources, args: { ...ownerHandle, role },
  handler: async (ctx, args) => {
    const invite = await owned(ctx, args);
    if (!pending(invite)) throw resourceUnavailable();
    await ctx.db.patch(invite._id, { role: args.role });
  },
});
export const { public: getListInvitations, internal: getListInvitationsInternal } = actorQuery({
  authority: "owner", scope: "lists:read", resources: ownerResources, args: { listId: v.id("lists") },
  handler: async (ctx, args) => (await ctx.db.query("listInvitations").withIndex("by_list_email", q => q.eq("listId", args.listId)).collect())
    .map(invite => ({ ...result(invite), email: invite.email, role: invite.role,
      status: invite.status === "pending" && !pending(invite) ? "expired" : invite.status,
      expiresAt: invite.expiresAt, delivery: invite.delivery, grantId: invite.grantId })),
});
async function preview(ctx: QueryCtx, invite: Doc<"listInvitations">) {
  const owner = await ctx.db.get(invite.ownerId);
  return { ...result(invite), inviter: owner!.displayName, role: invite.role, expiresAt: invite.expiresAt };
}
export const { public: getPendingInvitations, internal: getPendingInvitationsInternal } = actorQuery({
  scope: "lists:read", resources: noResources, args: {},
  handler: async (ctx) => {
    const email = await verifiedEmail(ctx);
    const invitations = await ctx.db.query("listInvitations").withIndex("by_email_status", q => q.eq("email", email).eq("status", "pending")).collect();
    const visible = [];
    for (const invite of invitations) if (pending(invite) && await live(ctx, invite) && !await predatesRevocation(ctx, invite, ctx.actor.userId)) visible.push(await preview(ctx, invite));
    return visible;
  },
});
export const { public: getInvitation, internal: getInvitationInternal } = actorQuery({
  scope: "lists:read", resources: noResources, args: { invitationId: v.string(), version: v.number() },
  handler: async (ctx, args) => {
    const email = await verifiedEmail(ctx);
    const id = ctx.db.normalizeId("listInvitations", args.invitationId);
    const invite = id ? await ctx.db.get(id) : null;
    if (!invite || invite.email !== email || invite.version !== args.version || !pending(invite) || !await live(ctx, invite) || await predatesRevocation(ctx, invite, ctx.actor.userId)) return null;
    return preview(ctx, invite);
  },
});
export const { public: acceptInvitation, internal: acceptInvitationInternal } = actorMutation({
  scope: "*", resources: noResources, args: { ...handle, accept: v.literal(true) },
  handler: async (ctx, args) => {
    if (args.accept !== true) throw resourceUnavailable();
    const email = await verifiedEmail(ctx);
    const invite = await ctx.db.get(args.invitationId);
    if (!invite || invite.email !== email || invite.version !== args.version || !await live(ctx, invite)) throw resourceUnavailable();
    if (invite.status === "accepted") {
      const grant = invite.grantId ? await ctx.db.get(invite.grantId) : null;
      if (invite.recipientId !== ctx.actor.userId || !grant) throw resourceUnavailable();
      return { listId: grant.listId, grantId: grant._id, role: grant.role };
    }
    if (!pending(invite) || await predatesRevocation(ctx, invite, ctx.actor.userId)) throw resourceUnavailable();
    const existing = await ctx.db.query("listGrants").withIndex("by_list_recipient", q => q.eq("listId", invite.listId).eq("recipientId", ctx.actor.userId)).unique();
    const grantId = existing?._id ?? await recordAcceptedListGrant(ctx, {
      listId: invite.listId, ownerId: invite.ownerId, recipientId: ctx.actor.userId, role: invite.role,
    });
    await ctx.db.patch(invite._id, { status: "accepted", recipientId: ctx.actor.userId, grantId });
    return { listId: invite.listId, grantId, role: existing?.role ?? invite.role };
  },
});

/** Scheduled mail reads only current pending versions. No resource metadata leaves this seam. */
export const deliveryPayload = internalQuery({
  args: handle,
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.invitationId);
    if (!invite || invite.version !== args.version || !pending(invite) || !await live(ctx, invite) || invite.delivery !== "queued") return null;
    const owner = await ctx.db.get(invite.ownerId);
    return { email: invite.email, inviter: owner!.displayName };
  },
});
export const deliveryResult = internalMutation({
  args: { ...handle, delivery: v.union(v.literal("sent"), v.literal("failed")) },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.invitationId);
    if (invite?.version === args.version && invite.delivery === "queued") await ctx.db.patch(invite._id, { delivery: args.delivery });
  },
});

/** Persist expiry so reactive pending/owner subscriptions rerun at the deadline.
 * Acceptance also checks the clock, so scheduler delay never extends authority. */
export const expireInvitation = internalMutation({
  args: handle,
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.invitationId);
    if (invite?.version === args.version && invite.status === "pending" && invite.expiresAt <= Date.now()) {
      await ctx.db.patch(invite._id, { status: "expired" });
    }
  },
});
