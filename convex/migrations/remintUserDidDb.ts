/**
 * Database half of the user did:webvh re-mint.
 *
 * Called from /api/user/remintDid (convex/userHttp.ts), for stale-domain
 * repairs and for the #286 author DID re-genesis.
 *
 * A did:webvh encodes its domain in the identifier and these DIDs are minted
 * `portable: false` (src/lib/webvh.ts), so a domain change is a NEW DID, not an
 * update. Every row keyed to the old DID has to move with it or it is orphaned:
 * lists become invisible to their owner, assignments point at nobody.
 *
 * The rewrite surface is declared as data below rather than written out as 17
 * hand-rolled blocks, so it can be read against schema.ts field by field.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Tables holding a user DID by value, as (table -> exact-match fields).
 * Deliberately excludes:
 *  - lists.assetDid / listEnvelopes.assetDid — did:cel asset ids, not user DIDs
 *  - sites.did — the site's own did:webvh
 *  - users.did / users.legacyDid — handled separately, they ARE the identity
 *  - actionRecords — signed bytes naming the DID at action time; never rewritten
 */
const EXACT_MATCH_FIELDS: Record<string, string[]> = {
  didLogs: ["userDid"],
  agentApiKeys: ["ownerDid", "agentDid"],
  categories: ["ownerDid"],
  bookmarks: ["userDid"],
  lists: ["ownerDid"],
  items: ["createdByDid", "checkedByDid", "assigneeDid"],
  itemAssignees: ["assigneeDid", "assignedByDid"],
  activities: ["actorDid"],
  presence: ["userDid"],
  tags: ["createdByDid"],
  listTemplates: ["ownerDid"],
  pushSubscriptions: ["userDid"],
  pushTokens: ["userDid"],
  publications: ["publishedByDid"],
  sites: ["ownerDid"],
  comments: ["userDid"],
  bitcoinAnchors: ["requestedByDid"],
};

/**
 * publications.webvhDid is `{userDid}/resources/list-{id}` — the DID is a prefix,
 * not the whole value, so it needs a prefix swap rather than an equality swap.
 */
const PREFIX_MATCH_FIELDS: Record<string, string[]> = {
  publications: ["webvhDid"],
};

type Row = Record<string, unknown> & { _id: string };

/** Rewrites nested DID-bearing objects the flat field map can't reach. */
function rewriteNested(table: string, row: Row, oldDid: string, newDid: string): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};

  if (table === "lists" && row.vcProof) {
    const vc = row.vcProof as {
      issuer: string;
      credentialSubject: { id: string; ownerDid: string };
      proof?: string;
    };
    const next = {
      ...vc,
      issuer: vc.issuer === oldDid ? newDid : vc.issuer,
      credentialSubject: {
        ...vc.credentialSubject,
        ownerDid:
          vc.credentialSubject.ownerDid === oldDid ? newDid : vc.credentialSubject.ownerDid,
      },
      // The serialized credential embeds the DID in JSON; swap every occurrence.
      ...(vc.proof ? { proof: vc.proof.split(oldDid).join(newDid) } : {}),
    };
    if (JSON.stringify(next) !== JSON.stringify(vc)) patch.vcProof = next;
  }

  if (table === "items" && Array.isArray(row.vcProofs)) {
    const proofs = row.vcProofs as Array<{ issuer: string; actorDid: string; proof?: string }>;
    const next = proofs.map((p) => ({
      ...p,
      issuer: p.issuer === oldDid ? newDid : p.issuer,
      actorDid: p.actorDid === oldDid ? newDid : p.actorDid,
      ...(p.proof ? { proof: p.proof.split(oldDid).join(newDid) } : {}),
    }));
    if (JSON.stringify(next) !== JSON.stringify(proofs)) patch.vcProofs = next;
  }

  if (table === "activities" && row.metadata) {
    const meta = row.metadata as { assigneeDid?: string };
    if (meta.assigneeDid === oldDid) {
      patch.metadata = { ...meta, assigneeDid: newDid };
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export const findUserByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();
    if (!user || !user.did) return null;
    return {
      _id: user._id,
      did: user.did,
      email: user.email,
      turnkeySubOrgId: user.turnkeySubOrgId,
    };
  },
});

/** Resolves the account from a JWT-verified Turnkey sub-org, never from a body field. */
export const findUserBySubOrg = internalQuery({
  args: { turnkeySubOrgId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_turnkey_id", (q) => q.eq("turnkeySubOrgId", args.turnkeySubOrgId))
      .first();
    return user ? { _id: user._id, did: user.did ?? null, email: user.email } : null;
  },
});

export const findUserByDid = internalQuery({
  args: { did: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_did", (q) => q.eq("did", args.did))
      .first();
    return user ? { _id: user._id, did: user.did!, email: user.email } : null;
  },
});

/** The stored did.jsonl for a DID — the authorization anchor for a re-mint. */
export const getDidLogFor = internalQuery({
  args: { userDid: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("didLogs")
      .withIndex("by_user_did", (q) => q.eq("userDid", args.userDid))
      .first();
    return row ? { log: row.log, path: row.path } : null;
  },
});

/** Users whose DID sits on a domain other than the one we mint on today. */
export const listUsersOnDomain = internalQuery({
  args: { domain: v.string() },
  handler: async (ctx, args) => {
    const users = await ctx.db.query("users").collect();
    return users
      .filter((u) => {
        if (!u.did) return false;
        const parts = u.did.split(":");
        // did:webvh:{scid}:{domain}:{path...} — domain is percent-encoded.
        return parts.length >= 5 && decodeURIComponent(parts[3]) === args.domain;
      })
      .map((u) => ({
        _id: u._id,
        did: u.did!,
        email: u.email,
        turnkeySubOrgId: u.turnkeySubOrgId,
      }));
  },
});

/** Counts every row that would move, without changing anything. */
export const previewRemint = internalQuery({
  args: { oldDid: v.string() },
  handler: async (ctx, args) => {
    const counts: Record<string, number> = {};

    for (const [table, fields] of Object.entries(EXACT_MATCH_FIELDS)) {
      const rows = (await ctx.db.query(table as never).collect()) as unknown as Row[];
      const n = rows.filter((r) => fields.some((f) => r[f] === args.oldDid)).length;
      if (n > 0) counts[table] = n;
    }

    for (const [table, fields] of Object.entries(PREFIX_MATCH_FIELDS)) {
      const rows = (await ctx.db.query(table as never).collect()) as unknown as Row[];
      const n = rows.filter((r) =>
        fields.some((f) => typeof r[f] === "string" && (r[f] as string).startsWith(args.oldDid))
      ).length;
      if (n > 0) counts[`${table}.prefix`] = n;
    }

    return counts;
  },
});

/** Every table a re-mint rewrites, in the order it rewrites them. */
export const REMINT_TABLES = [...new Set([...Object.keys(EXACT_MATCH_FIELDS), ...Object.keys(PREFIX_MATCH_FIELDS)])];

/** The account, or "skipped" when it has already moved off `oldDid`. Throws if it may not move to `newDid`. */
async function remintable(ctx: MutationCtx, userId: Id<"users">, oldDid: string, newDid: string) {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error(`User ${userId} not found`);
  if (user.deletionRequestedAt !== undefined) throw new Error("Account deletion is in progress");
  // Someone already re-minted this user; don't rewrite a second time.
  if (user.did !== oldDid) return "skipped" as const;
  // Never move an account onto an identity another account holds: ownership is
  // DID-based, so that would hand over the other account's lists and keys.
  const holder = await ctx.db.query("users").withIndex("by_did", (q) => q.eq("did", newDid)).first()
    ?? await ctx.db.query("users").withIndex("by_legacy_did", (q) => q.eq("legacyDid", newDid)).first();
  if (holder && holder._id !== user._id) throw new Error("DID is already in use by another account");
  return user;
}

/** Move one row off `oldDid`. Returns whether it changed. */
async function rewriteRow(ctx: MutationCtx, table: string, row: Row, oldDid: string, newDid: string): Promise<boolean> {
  const patch: Record<string, unknown> = {};
  for (const field of EXACT_MATCH_FIELDS[table] ?? []) {
    if (row[field] === oldDid) patch[field] = newDid;
  }
  const nested = rewriteNested(table, row, oldDid, newDid);
  if (nested) Object.assign(patch, nested);
  for (const field of PREFIX_MATCH_FIELDS[table] ?? []) {
    const value = row[field];
    // Whole-DID prefix only: `{oldDid}/...`, never a longer DID sharing its characters.
    if (typeof value === "string" && value.startsWith(`${oldDid}/`)) patch[field] = newDid + value.slice(oldDid.length);
  }
  if (Object.keys(patch).length === 0) return false;
  await ctx.db.patch(row._id as never, patch as never);
  // Row-only/secondary assignment changes must invalidate offline edits.
  // Keep collision rows: their original attribution is historical evidence.
  if (table === "itemAssignees" && patch.assigneeDid) {
    const item = await ctx.db.get(row.itemId as Id<"items">);
    if (item) await ctx.db.patch(item._id, { updatedAt: Math.max(Date.now(), (item.updatedAt ?? 0) + 1), ...(item.assignmentsVersion !== undefined ? { assignmentsVersion: item.assignmentsVersion + 1 } : {}) });
  }
  return true;
}

/** The whole re-mint in one mutation. For small deployments and operators; /api/user/remintDid pages through it. */
export const applyRemint = internalMutation({
  args: {
    userId: v.id("users"),
    oldDid: v.string(),
    newDid: v.string(),
  },
  handler: async (ctx: MutationCtx, args) => {
    const user = await remintable(ctx, args.userId, args.oldDid, args.newDid);
    if (user === "skipped") return { rewritten: 0, skipped: true };
    let rewritten = 0;
    for (const table of REMINT_TABLES) {
      const rows = (await ctx.db.query(table as never).collect()) as unknown as Row[];
      for (const row of rows) if (await rewriteRow(ctx, table, row, args.oldDid, args.newDid)) rewritten += 1;
    }
    // The identity row moves last: if anything above throws, `did` still points
    // at the old value and the whole run is safe to retry.
    await ctx.db.patch(args.userId, { did: args.newDid });
    return { rewritten, skipped: false };
  },
});

// --- Paged re-mint (#286 PR b) -------------------------------------------------
// Every pre-#286 account re-mints at its first sign-in with a Turnkey session,
// so the rewrite can't be one mutation scanning every table: past Convex's
// per-mutation read limits it would fail for everyone. beginRemint claims the
// move, remintPage rewrites one page of one table, finishRemint moves the
// account and serves the new log together. Rows written under the old DID
// between a table's pass and finishRemint are not moved.

const REMINT_PAGE_SIZE = 200;
const REMINT_CLAIM_MS = 5 * 60 * 1000;

export const beginRemint = internalMutation({
  args: { userId: v.id("users"), oldDid: v.string(), newDid: v.string() },
  handler: async (ctx, args): Promise<{ skipped: true; did: string | null } | { skipped: false }> => {
    const user = await remintable(ctx, args.userId, args.oldDid, args.newDid);
    if (user === "skipped") return { skipped: true, did: (await ctx.db.get(args.userId))?.did ?? null };
    const pending = user.pendingRemint;
    if (pending && pending.newDid !== args.newDid && Date.now() - pending.startedAt < REMINT_CLAIM_MS) {
      throw new Error("Another device is moving this account. Try again shortly.");
    }
    await ctx.db.patch(user._id, { pendingRemint: { oldDid: args.oldDid, newDid: args.newDid, startedAt: Date.now() } });
    return { skipped: false };
  },
});

export const remintPage = internalMutation({
  args: { userId: v.id("users"), oldDid: v.string(), newDid: v.string(), table: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user?.pendingRemint?.newDid !== args.newDid || user.did !== args.oldDid) throw new Error("This re-mint is no longer the account's pending one");
    if (!REMINT_TABLES.includes(args.table)) throw new Error(`Not a re-mint table: ${args.table}`);
    const page = await ctx.db.query(args.table as never).paginate({ numItems: REMINT_PAGE_SIZE, cursor: args.cursor });
    let rewritten = 0;
    for (const row of page.page as unknown as Row[]) if (await rewriteRow(ctx, args.table, row, args.oldDid, args.newDid)) rewritten += 1;
    return { rewritten, isDone: page.isDone, cursor: page.continueCursor };
  },
});

export const finishRemint = internalMutation({
  args: {
    userId: v.id("users"), oldDid: v.string(), newDid: v.string(),
    path: v.string(), log: v.string(), scid: v.string(), versionId: v.string(), author: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (user?.pendingRemint?.newDid !== args.newDid || user.did !== args.oldDid) throw new Error("This re-mint is no longer the account's pending one");
    // The identity row and the served log move together, last.
    await ctx.db.patch(args.userId, { did: args.newDid, pendingRemint: undefined });
    const row = {
      userDid: args.newDid, path: args.path, log: args.log, scid: args.scid,
      versionId: args.versionId, author: args.author, updatedAt: Date.now(),
    };
    const existing = await ctx.db.query("didLogs").withIndex("by_path", (q) => q.eq("path", args.path)).first();
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("didLogs", row);
  },
});
