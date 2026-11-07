/**
 * Dev-only seed for the LWS end-to-end run (scripts/lws-e2e-dev.mjs,
 * docs/lws-agent-auth.md "End-to-end on dev"). Internal only: reached with
 * `npx convex run devLws:<name>`, never through `api.*` or HTTP.
 *
 * Approving an agent on a real account needs a Turnkey session (the author
 * key signs the DID update) and a boop session (POST /api/did/log). The e2e
 * can't sign in, so the seed stands in for exactly those two: the script
 * holds the test account's author and assertion keys locally, and these
 * helpers store its DID log after the same write check storeDidLog makes
 * (didLogValidation.checkWrite, with the local keys in place of the
 * sub-org's Turnkey accounts). Everything after that, approval included, is
 * the deployed code.
 *
 * Every helper refuses to run unless the deployment is clearly not prod:
 * WEBVH_DOMAIN set and not boop.ad, and LWS_DEV_SEED=1 (set on dev only, for
 * the run). They act only on accounts the seed made: a `lws-e2e-` sub-org id
 * and a `lws-e2e+…@example.invalid` email.
 */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { assertDidLogOwnership, didLogPathForSubOrg } from "./lib/didLogAuth";
import { deleteActionRecords } from "./lib/actionRecords";

const SUB_ORG_PATTERN = /^lws-e2e-[a-z0-9]{8,32}$/;
const EMAIL_PATTERN = /^lws-e2e\+[a-z0-9]{1,32}@example\.invalid$/;

/** Throws unless this deployment is clearly not prod and the seed is switched on. */
export function assertDevSeedAllowed(env: Record<string, string | undefined> = process.env): void {
  const domain = env.WEBVH_DOMAIN;
  if (!domain || domain === "boop.ad" || domain.endsWith(".boop.ad")) throw new Error("devLws: refused, this may be prod (WEBVH_DOMAIN)");
  if (env.LWS_DEV_SEED !== "1") throw new Error("devLws: refused, LWS_DEV_SEED is not 1");
}

/** A row the seed made, and only such a row. */
export function isSeedUser(user: Pick<Doc<"users">, "turnkeySubOrgId" | "email"> | null): boolean {
  return !!user && SUB_ORG_PATTERN.test(user.turnkeySubOrgId ?? "") && EMAIL_PATTERN.test(user.email ?? "");
}

const account = v.object({ path: v.string(), address: v.string() });
type Checked =
  | { ok: true; did: string; scid: string; versionId: string; entries: number; author: boolean; authorProblems: string[] }
  | { ok: false; error: string };

/** The domain DIDs are minted on here: the e2e mints the test DID on it. */
export const config = internalQuery({
  args: {},
  handler: async () => {
    assertDevSeedAllowed();
    return { domain: process.env.WEBVH_DOMAIN! };
  },
});

/**
 * A test account serving `log` (its genesis, signed locally) as its author
 * DID, with lists and items. `accounts` are the local keys in Turnkey's
 * account shape, which the write check pins the author DID to.
 */
export const seed = internalAction({
  args: {
    n: v.string(),
    subOrgId: v.string(),
    log: v.string(),
    accounts: v.array(account),
    lists: v.array(v.object({ name: v.string(), items: v.array(v.string()) })),
  },
  handler: async (ctx, args): Promise<{ userId: Id<"users">; did: string; path: string; lists: Array<{ listId: Id<"lists">; itemIds: Id<"items">[] }> }> => {
    assertDevSeedAllowed();
    const email = `lws-e2e+${args.n}@example.invalid`;
    if (!SUB_ORG_PATTERN.test(args.subOrgId) || !EMAIL_PATTERN.test(email)) throw new Error("devLws: not a seed account");
    const path = didLogPathForSubOrg(args.subOrgId);
    const checked: Checked = await ctx.runAction(internal.didLogValidation.checkWrite, {
      stored: null, next: args.log, accounts: args.accounts, domain: process.env.WEBVH_DOMAIN!,
    });
    if (!checked.ok) throw new Error(`devLws: the log was refused: ${checked.error}`);
    if (!checked.author) throw new Error(`devLws: not an author DID: ${checked.authorProblems.join("; ")}`);
    if (!checked.did.endsWith(`:${path}`)) throw new Error("devLws: the DID is not at this account's path");
    // The same ownership rule every didLogs writer applies (scripts/did-log-auth.test.mjs).
    assertDidLogOwnership({ subOrgId: args.subOrgId, userDid: checked.did, path });
    const seeded = await ctx.runMutation(internal.devLws.insertSeedRows, {
      subOrgId: args.subOrgId, email, displayName: `LWS e2e ${args.n}`, did: checked.did, lists: args.lists,
    });
    await ctx.runMutation(internal.didLogs.upsertDidLog, {
      userDid: checked.did, path, log: args.log, scid: checked.scid, versionId: checked.versionId, author: true, expected: null,
    });
    return { ...seeded, did: checked.did, path };
  },
});

export const insertSeedRows = internalMutation({
  args: {
    subOrgId: v.string(), email: v.string(), displayName: v.string(), did: v.string(),
    lists: v.array(v.object({ name: v.string(), items: v.array(v.string()) })),
  },
  handler: async (ctx, args) => {
    assertDevSeedAllowed();
    if (await ctx.db.query("users").withIndex("by_turnkey_id", q => q.eq("turnkeySubOrgId", args.subOrgId)).first()) {
      throw new Error("devLws: this seed account exists");
    }
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      did: args.did, displayName: args.displayName, createdAt: now, turnkeySubOrgId: args.subOrgId, email: args.email, lastLoginAt: now,
    });
    const lists = [];
    for (const [l, list] of args.lists.entries()) {
      const listId = await ctx.db.insert("lists", { name: list.name, ownerDid: args.did, createdAt: now + l });
      const itemIds = [];
      for (const [i, name] of list.items.entries()) {
        itemIds.push(await ctx.db.insert("items", {
          listId, name, checked: false, createdByDid: args.did, createdAt: now + i, updatedAt: now + i, order: i,
        }));
      }
      lists.push({ listId, itemIds });
    }
    return { userId, lists };
  },
});

/**
 * A continuation of the test account's served log (an agent method added or
 * removed, signed locally by its author key), stored after the same write
 * check storeDidLog makes, compare-and-swap against the served log.
 */
export const storeDidContinuation = internalAction({
  args: { userId: v.id("users"), log: v.string(), accounts: v.array(account) },
  handler: async (ctx, args): Promise<{ versionId: string }> => {
    assertDevSeedAllowed();
    const user: Doc<"users"> | null = await ctx.runQuery(internal.devLws.seedUser, { userId: args.userId });
    if (!user || !isSeedUser(user) || !user.did) throw new Error("devLws: not a seed account");
    const path = didLogPathForSubOrg(user.turnkeySubOrgId!);
    const served = await ctx.runQuery(internal.didLogs.getDidLogRecordByPath, { path });
    if (!served || served.userDid !== user.did) throw new Error("devLws: the account's DID is not served");
    const checked: Checked = await ctx.runAction(internal.didLogValidation.checkWrite, {
      stored: served.log, next: args.log, accounts: args.accounts, domain: process.env.WEBVH_DOMAIN!,
    });
    if (!checked.ok) throw new Error(`devLws: the log was refused: ${checked.error}`);
    if (checked.did !== user.did || !checked.author) throw new Error(`devLws: not this account's author DID: ${checked.ok ? checked.authorProblems.join("; ") : ""}`);
    assertDidLogOwnership({ subOrgId: user.turnkeySubOrgId!, userDid: user.did, path });
    await ctx.runMutation(internal.didLogs.upsertDidLog, {
      userDid: user.did, path, log: args.log, scid: checked.scid, versionId: checked.versionId, author: true,
      expected: { userDid: served.userDid, log: served.log },
    });
    return { versionId: checked.versionId };
  },
});

export const seedUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    assertDevSeedAllowed();
    return await ctx.db.get(userId);
  },
});

/** Everything one seed account has: its lists and what hangs off them, its DID log, agents, requests and tokens. */
async function deleteSeedAccount(ctx: MutationCtx, user: Doc<"users">) {
  const counts: Record<string, number> = {};
  const drop = async (table: string, id: Id<never>) => { await ctx.db.delete(id); counts[table] = (counts[table] ?? 0) + 1; };
  const dids = [user.did, user.legacyDid].filter((did): did is string => !!did);
  for (const did of dids) {
    for (const list of await ctx.db.query("lists").withIndex("by_owner", q => q.eq("ownerDid", did)).collect()) {
      for (const item of await ctx.db.query("items").withIndex("by_list", q => q.eq("listId", list._id)).collect()) await drop("items", item._id as never);
      await deleteActionRecords(ctx, { listId: list._id });
      for (const row of await ctx.db.query("itemAssignees").withIndex("by_list", q => q.eq("listId", list._id)).collect()) await drop("itemAssignees", row._id as never);
      for (const row of await ctx.db.query("activities").withIndex("by_list", q => q.eq("listId", list._id)).collect()) await drop("activities", row._id as never);
      await drop("lists", list._id as never);
    }
  }
  const path = didLogPathForSubOrg(user.turnkeySubOrgId!);
  for (const log of await ctx.db.query("didLogs").withIndex("by_path", q => q.eq("path", path)).collect()) await drop("didLogs", log._id as never);
  for (const agent of await ctx.db.query("lwsAgents").withIndex("by_user", q => q.eq("userId", user._id)).collect()) {
    for (const token of await ctx.db.query("lwsAccessTokens").withIndex("by_agent", q => q.eq("agentId", agent._id)).collect()) await drop("lwsAccessTokens", token._id as never);
    await drop("lwsAgents", agent._id as never);
  }
  for (const status of ["pending", "approved", "denied", "expired"] as const) {
    for (const row of await ctx.db.query("lwsAccessRequests").withIndex("by_user_status", q => q.eq("userId", user._id).eq("status", status)).collect()) {
      await drop("lwsAccessRequests", row._id as never);
    }
  }
  await drop("users", user._id as never);
  return counts;
}

/**
 * Delete what the seed made: the named accounts, or with `all`, every seed
 * account (a run that died before its own cleanup). Refuses any other account.
 * Spent jtis and rate-limit rows hold no account and expire on their own.
 */
export const cleanup = internalMutation({
  args: { userIds: v.optional(v.array(v.id("users"))), all: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    assertDevSeedAllowed();
    const users: Doc<"users">[] = [];
    for (const id of args.userIds ?? []) {
      const user = await ctx.db.get(id);
      if (!user) continue;
      if (!isSeedUser(user)) throw new Error("devLws: refusing to delete an account the seed didn't make");
      users.push(user);
    }
    if (args.all) {
      for await (const user of ctx.db.query("users")) {
        if (isSeedUser(user) && !users.some(u => u._id === user._id)) users.push(user);
      }
    }
    const deleted: Record<string, number> = {};
    for (const user of users) {
      for (const [table, n] of Object.entries(await deleteSeedAccount(ctx, user))) deleted[table] = (deleted[table] ?? 0) + n;
    }
    return { accounts: users.length, deleted };
  },
});

/** What is left of the seed accounts, to confirm a cleanup. */
export const remaining = internalQuery({
  args: {},
  handler: async (ctx) => {
    assertDevSeedAllowed();
    let accounts = 0;
    for await (const user of ctx.db.query("users")) if (isSeedUser(user)) accounts++;
    return { accounts };
  },
});
