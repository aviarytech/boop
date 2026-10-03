/**
 * Database half of the user did:webvh re-mint.
 *
 * Split from remintUserDid.ts because that file is "use node" (Turnkey signing)
 * and Convex only allows actions in Node modules.
 *
 * A did:webvh encodes its domain in the identifier and these DIDs are minted
 * `portable: false` (didCreation.ts:57), so a domain change is a NEW DID, not an
 * update. Every row keyed to the old DID has to move with it or it is orphaned:
 * lists become invisible to their owner, assignments point at nobody.
 *
 * The rewrite surface is declared as data below rather than written out as 17
 * hand-rolled blocks, so it can be read against schema.ts field by field.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";

/**
 * Tables holding a user DID by value, as (table -> exact-match fields).
 * Deliberately excludes:
 *  - lists.assetDid / listEnvelopes.assetDid — did:cel asset ids, not user DIDs
 *  - sites.did — the site's own did:webvh
 *  - users.did / users.legacyDid — handled separately, they ARE the identity
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

export const storeDidLog = internalMutation({
  args: { userDid: v.string(), path: v.string(), log: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("didLogs")
      .withIndex("by_path", (q) => q.eq("path", args.path))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        userDid: args.userDid,
        log: args.log,
        updatedAt: Date.now(),
      });
      return;
    }
    await ctx.db.insert("didLogs", {
      userDid: args.userDid,
      path: args.path,
      log: args.log,
      updatedAt: Date.now(),
    });
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

export const applyRemint = internalMutation({
  args: {
    userId: v.id("users"),
    oldDid: v.string(),
    newDid: v.string(),
  },
  handler: async (ctx: MutationCtx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error(`User ${args.userId} not found`);
    if (user.did !== args.oldDid) {
      // Someone already re-minted this user; don't rewrite a second time.
      return { rewritten: 0, skipped: true };
    }

    let rewritten = 0;

    for (const [table, fields] of Object.entries(EXACT_MATCH_FIELDS)) {
      const rows = (await ctx.db.query(table as never).collect()) as unknown as Row[];
      for (const row of rows) {
        const patch: Record<string, unknown> = {};
        for (const field of fields) {
          if (row[field] === args.oldDid) patch[field] = args.newDid;
        }
        const nested = rewriteNested(table, row, args.oldDid, args.newDid);
        if (nested) Object.assign(patch, nested);
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(row._id as never, patch as never);
          rewritten += 1;
        }
      }
    }

    for (const [table, fields] of Object.entries(PREFIX_MATCH_FIELDS)) {
      const rows = (await ctx.db.query(table as never).collect()) as unknown as Row[];
      for (const row of rows) {
        const patch: Record<string, unknown> = {};
        for (const field of fields) {
          const value = row[field];
          if (typeof value === "string" && value.startsWith(args.oldDid)) {
            patch[field] = args.newDid + value.slice(args.oldDid.length);
          }
        }
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(row._id as never, patch as never);
          rewritten += 1;
        }
      }
    }

    // The identity row moves last: if anything above throws, `did` still points
    // at the old value and the whole run is safe to retry.
    await ctx.db.patch(args.userId, { did: args.newDid });

    return { rewritten, skipped: false };
  },
});
