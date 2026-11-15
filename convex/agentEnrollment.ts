/**
 * One-time agent enrollment codes (plans/002 D14, docs/agent-enrollment-codes.md).
 *
 * The owner mints a short-lived code in Settings and gives it to an agent. P5
 * will require the code in the agent's access request, so only an agent the
 * owner started can ask for access. Nothing redeems a code yet.
 *
 * Only signed-in sessions mint, list or revoke: an API key or other delegated
 * credential can't enroll another agent. The plaintext code is returned once,
 * by the mint, and only its hash is stored.
 */
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { actorAction, actorMutation, actorQuery, type ActorCtx } from "./lib/authenticated";
import { resourceUnavailable } from "./lib/authError";
import { consumeRateLimit } from "./rateLimits";
import {
  cleanEnrollmentLabel,
  constantTimeEqual,
  ENROLLMENT_CODE_TTL_MS,
  generateEnrollmentCode,
  hashEnrollmentCode,
  MAX_ACTIVE_ENROLLMENT_CODES,
} from "../shared/enrollmentCode";

/** Expired and redeemed rows are kept this long after expiry, then deleted. */
export const ENROLLMENT_CODE_RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH = 200;

export type EnrollmentErrorCode = "DISABLED" | "TOO_MANY_ACTIVE" | "RATE_LIMITED";
function enrollmentError(code: EnrollmentErrorCode, message: string, retryAfterMs?: number) {
  return new ConvexError({ kind: "enrollment" as const, code, message, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) });
}

/** Off unless the deployment sets AGENT_ENROLLMENT_CODES=true. */
function mintingEnabled(): boolean {
  return process.env.AGENT_ENROLLMENT_CODES === "true";
}

function requireOwnerSession(ctx: ActorCtx<QueryCtx | MutationCtx>): void {
  if (ctx.actor.viaApiKey || ctx.actor.credential.kind !== "session") throw resourceUnavailable();
}

/** The owner's codes that can still be redeemed, soonest to expire first. */
async function activeCodes(ctx: QueryCtx | MutationCtx, ownerId: Id<"users">, now: number) {
  const unexpired = await ctx.db.query("agentEnrollmentCodes")
    .withIndex("by_owner_expires", q => q.eq("ownerId", ownerId).gt("expiresAt", now))
    .collect();
  return unexpired.filter(row => row.redeemedAt === undefined);
}

/**
 * Mint a code. An action, so the code comes from the runtime's CSPRNG and not
 * from a mutation's seeded randomness. The stored row is written by
 * `storeEnrollmentCodeInternal`, which authenticates again in its transaction.
 */
export const { public: mintEnrollmentCode, internal: mintEnrollmentCodeInternal } = actorAction({
  resources: () => ({}),
  scope: "*",
  args: { label: v.optional(v.string()) },
  handler: async (ctx, { label }): Promise<{ id: Id<"agentEnrollmentCodes">; code: string; label: string | null; createdAt: number; expiresAt: number }> => {
    if (ctx.actor.viaApiKey) throw resourceUnavailable();
    if (!mintingEnabled()) throw enrollmentError("DISABLED", "Agent enrollment isn't available yet.");
    const code = generateEnrollmentCode();
    const codeHash = await hashEnrollmentCode(code);
    if (codeHash === null) throw new Error("Generated enrollment code is malformed");
    const stored = await ctx.runMutation(internal.agentEnrollment.storeEnrollmentCodeInternal, { ...ctx.credentials, codeHash, label });
    return { ...stored, code };
  },
});

/** Store a minted code's hash, within the cap and the mint budget. Internal only. */
export const { internal: storeEnrollmentCodeInternal } = actorMutation({
  resources: () => ({}),
  scope: "*",
  args: { codeHash: v.string(), label: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireOwnerSession(ctx);
    if (!mintingEnabled()) throw enrollmentError("DISABLED", "Agent enrollment isn't available yet.");
    if (!/^[0-9a-f]{64}$/.test(args.codeHash)) throw new Error("Invalid enrollment code hash");
    const now = Date.now();
    const ownerId = ctx.actor.userId;
    if ((await activeCodes(ctx, ownerId, now)).length >= MAX_ACTIVE_ENROLLMENT_CODES) {
      throw enrollmentError("TOO_MANY_ACTIVE", `You have ${MAX_ACTIVE_ENROLLMENT_CODES} unused codes. Revoke one or wait for it to expire.`);
    }
    // A refused mint throws, which rolls back its own count: only stored codes
    // spend the budget.
    const limit = await consumeRateLimit(ctx, `user:${ownerId}`, "enrollmentCodeMint");
    if (!limit.allowed) throw enrollmentError("RATE_LIMITED", "Too many codes created. Try again later.", limit.retryAfterMs);
    const label = cleanEnrollmentLabel(args.label);
    const createdAt = now;
    const expiresAt = now + ENROLLMENT_CODE_TTL_MS;
    const id = await ctx.db.insert("agentEnrollmentCodes", {
      ownerId, codeHash: args.codeHash, createdAt, expiresAt, ...(label === undefined ? {} : { label }),
    });
    return { id, label: label ?? null, createdAt, expiresAt };
  },
});

/** The caller's redeemable codes. Never returns a code or its hash. */
export const { public: listEnrollmentCodes, internal: listEnrollmentCodesInternal } = actorQuery({
  resources: () => ({}),
  scope: "*",
  args: {},
  handler: async (ctx) => {
    requireOwnerSession(ctx);
    const rows = await activeCodes(ctx, ctx.actor.userId, Date.now());
    return rows.map(row => ({ id: row._id, label: row.label ?? null, createdAt: row.createdAt, expiresAt: row.expiresAt }));
  },
});

/** Revoke one of the caller's unredeemed codes. It can't be redeemed afterwards. */
export const { public: revokeEnrollmentCode, internal: revokeEnrollmentCodeInternal } = actorMutation({
  resources: () => ({}),
  scope: "*",
  args: { codeId: v.id("agentEnrollmentCodes") },
  handler: async (ctx, { codeId }): Promise<null> => {
    requireOwnerSession(ctx);
    const row = await ctx.db.get(codeId);
    // Same answer for a missing code, someone else's, and one already redeemed.
    if (!row || row.ownerId !== ctx.actor.userId || row.redeemedAt !== undefined) throw resourceUnavailable();
    await ctx.db.delete(codeId);
    return null;
  },
});

/**
 * Redeem a code: check that it exists, hasn't expired and hasn't been redeemed,
 * mark it redeemed, and return its owner. One transaction, so two redemptions
 * of the same code can't both succeed. Every failure returns null, so a caller
 * can't tell a wrong code from an expired, revoked or used one.
 *
 * Internal: P5's access-request endpoint is the intended caller. That endpoint
 * is unauthenticated and must rate-limit attempts itself.
 */
export const redeemEnrollmentCode = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<{ ownerId: Id<"users">; ownerDid: string; codeId: Id<"agentEnrollmentCodes">; label: string | null } | null> => {
    const codeHash = await hashEnrollmentCode(code);
    if (codeHash === null) return null;
    const row = await ctx.db.query("agentEnrollmentCodes")
      .withIndex("by_hash", q => q.eq("codeHash", codeHash)).first();
    if (!row || !constantTimeEqual(row.codeHash, codeHash)) return null;
    const now = Date.now();
    if (row.redeemedAt !== undefined || row.expiresAt <= now) return null;
    // The owner's current DID, so a code minted before a DID re-mint still names them.
    const owner = await ctx.db.get(row.ownerId);
    if (!owner?.did || owner.deletionRequestedAt !== undefined) return null;
    await ctx.db.patch(row._id, { redeemedAt: now });
    return { ownerId: owner._id, ownerDid: owner.did, codeId: row._id, label: row.label ?? null };
  },
});

/** Delete codes a day past expiry, redeemed or not. Run hourly by the cron. */
export const cleanupEnrollmentCodes = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const stale = await ctx.db.query("agentEnrollmentCodes")
      .withIndex("by_expires", q => q.lt("expiresAt", Date.now() - ENROLLMENT_CODE_RETENTION_MS))
      .take(CLEANUP_BATCH);
    for (const row of stale) await ctx.db.delete(row._id);
    if (stale.length === CLEANUP_BATCH) await ctx.scheduler.runAfter(0, internal.agentEnrollment.cleanupEnrollmentCodes, {});
    return stale.length;
  },
});
