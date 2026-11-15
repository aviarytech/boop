/**
 * Which builds are in use (plans/002 D13, #286 P2b). Clients say what they
 * support when they sign in and when they restore a session; this records the
 * latest answer per account and platform, and `adoption` reads it back.
 *
 * Report-only: nothing here, and nothing that calls it, refuses a client or
 * answers it differently. See shared/clientCapabilities.ts.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import { requireSession } from "./lib/session";
import { clientPlatform, declaredCapabilities, DID_CAPABILITY_RELATIONSHIPS, type ClientPlatform } from "../shared/clientCapabilities";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A restore that changes nothing rewrites its row at most this often. */
const REFRESH_MS = 6 * 60 * 60 * 1000;
/** Rows one `adoption` call reads from each table; past it the answer is marked truncated. */
const SCAN_LIMIT = 8000;

async function record(ctx: MutationCtx, subject: string, declared: unknown, platform: unknown) {
  const capabilities = declaredCapabilities(declared);
  const row = { subject, platform: clientPlatform(platform), capabilities, lastSeenAt: Date.now() };
  const existing = await ctx.db.query("clientCapabilityReports")
    .withIndex("by_subject_platform", q => q.eq("subject", subject).eq("platform", row.platform)).first();
  if (!existing) { await ctx.db.insert("clientCapabilityReports", row); return; }
  const unchanged = existing.capabilities.join() === capabilities.join();
  if (unchanged && row.lastSeenAt - existing.lastSeenAt < REFRESH_MS) return;
  await ctx.db.patch(existing._id, { capabilities, lastSeenAt: row.lastSeenAt });
}

const reportArgs = { clientCapabilities: v.array(v.string()), platform: v.optional(v.string()) };

/** A signed-in build saying what it supports. Sent on session restore, so sessions that never sign in again still count. */
export const report = mutation({
  args: { authToken: v.string(), ...reportArgs },
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.authToken);
    await record(ctx, session.turnkeySubOrgId, args.clientCapabilities, args.platform);
    return null;
  },
});

/** /auth/verify, for the account that just signed in. A build that sent no field is recorded with none. */
export const recordInternal = internalMutation({
  args: { subject: v.string(), ...reportArgs },
  handler: async (ctx, args) => {
    await record(ctx, args.subject, args.clientCapabilities, args.platform);
    return null;
  },
});

type Tally = { total: number; withCapability: number; share: number | null };
const tally = (total: number, withCapability: number): Tally =>
  ({ total, withCapability, share: total ? withCapability / total : null });

/**
 * Share of recently seen builds that declare `capability`, over each window.
 *
 * - `installs`: one per account and platform seen in the window.
 * - `accounts`: `withCapability` counts an account only when every platform it
 *   used in the window declares it. This is the number to hold a DID change to.
 * - `persistentSessions`: accounts holding a native session that never
 *   expires, and how many of them have no native report with the capability.
 *   A build from before reporting says nothing unless it signs in again, so
 *   these are the installs the windows can't see.
 *
 * Run: `npx convex run clientCapabilities:adoption` (scripts/client-capability-adoption.mjs).
 */
export const adoption = internalQuery({
  args: { days: v.optional(v.array(v.number())), capability: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const capability = args.capability ?? DID_CAPABILITY_RELATIONSHIPS;
    const now = Date.now();
    const reports = await ctx.db.query("clientCapabilityReports").withIndex("by_last_seen").order("desc").take(SCAN_LIMIT + 1);
    const sessions = await ctx.db.query("accessSessions").withIndex("by_expires_at", q => q.eq("expiresAt", undefined)).take(SCAN_LIMIT + 1);
    const truncated = reports.length > SCAN_LIMIT || sessions.length > SCAN_LIMIT;
    const has = (row: { capabilities: string[] }) => row.capabilities.includes(capability);

    const windows = (args.days ?? [7, 30]).map(days => {
      const seen = reports.slice(0, SCAN_LIMIT).filter(row => row.lastSeenAt >= now - days * DAY_MS);
      const byPlatform: Partial<Record<ClientPlatform, Tally>> = {};
      for (const platform of new Set(seen.map(row => row.platform as ClientPlatform))) {
        const rows = seen.filter(row => row.platform === platform);
        byPlatform[platform] = tally(rows.length, rows.filter(has).length);
      }
      // false once any of the account's platforms lacks the capability.
      const accounts = new Map<string, boolean>();
      for (const row of seen) accounts.set(row.subject, (accounts.get(row.subject) ?? true) && has(row));
      return {
        days,
        installs: tally(seen.length, seen.filter(has).length),
        byPlatform,
        accounts: tally(accounts.size, [...accounts.values()].filter(Boolean).length),
      };
    });

    const nativeReady = new Set(reports.filter(row => row.platform !== "web" && has(row)).map(row => row.subject));
    const persistent = new Set(sessions.slice(0, SCAN_LIMIT).filter(row => row.revokedAt === undefined).map(row => row.subject));
    return {
      capability,
      generatedAt: now,
      truncated,
      windows,
      persistentSessions: {
        accounts: persistent.size,
        withoutCapability: [...persistent].filter(subject => !nativeReady.has(subject)).length,
      },
    };
  },
});
