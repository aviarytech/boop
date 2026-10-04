import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getFunctionName } from "convex/server";
import { createAuthFixture } from "./auth-fixture.mjs";

export const sessions = Object.fromEntries(await Promise.all(
  ["owner", "editor", "viewer", "outsider", "pending"].map(async name => [name,
    await createAuthFixture(`did:${name}`, { _id: `U-${name}`, email: `${name}@example.test`, displayName: name, createdAt: 1 }),
  ]),
));
export const credentials = name => name === "anonymous" ? {} : { authToken: sessions[name].authToken };
export const digest = value => createHash("sha256").update(value).digest("hex");

/** Real handlers and credential verification, deterministic in-memory storage.
 * Does not simulate Convex subscriptions, schema validation, or transaction retry.
 */
export function fixture(modules, { published = false } = {}) {
  const rows = {
    users: Object.values(sessions).map(s => structuredClone(s.user)),
    accessSessions: Object.values(sessions).map(s => structuredClone(s.accessSession)),
    lists: [
      { _id: "L", ownerDid: "did:owner", name: "Private list", createdAt: 1, assetDid: "did:cel:source", categoryId: "CAT" },
      { _id: "N", ownerDid: "did:owner", kind: "note", name: "Private note", createdAt: 1, assetDid: "did:cel:note" },
      { _id: "X", ownerDid: "did:outsider", name: "Other private", createdAt: 2, assetDid: "did:cel:other" },
    ],
    items: [
      { _id: "I", listId: "L", name: "Secret item", checked: false, description: "Secret description", priority: "high", dueDate: 100, createdAt: 1, createdByDid: "did:owner", vcProofs: [], tags: ["T"] },
      { _id: "CHILD", listId: "L", parentId: "I", name: "Child", checked: false, createdAt: 2, createdByDid: "did:owner", vcProofs: [] },
      { _id: "IX", listId: "X", name: "Unrelated", checked: false, createdAt: 1, createdByDid: "did:outsider", vcProofs: [] },
    ],
    listGrants: ["L", "N"].flatMap(listId => ["editor", "viewer"].map(role => ({ _id: `G-${listId}-${role}`, listId, recipientId: `U-${role}`, role, acceptedAt: 1 }))),
    // Deliberately not an accepted grant; no production path reads this fixture table.
    pendingInvitations: [{ _id: "invite", listId: "L", recipientId: "U-pending", role: "editor" }],
    publications: published ? [{ _id: "P", listId: "L", webvhDid: "did:webvh:public", status: "active", publishedAt: 1 }] : [],
    listEnvelopes: [{ _id: "E", listId: "L", assetDid: "did:cel:source", envelope: "source-owner-envelope", genesisSealedAt: 2 }],
    noteBodies: [{ _id: "BODY", listId: "N", body: "Private note body", updatedAt: 1 }],
    tags: [{ _id: "T", listId: "L", name: "Secret tag", color: "red", createdByDid: "did:owner", createdAt: 1 }],
    comments: [{ _id: "COMMENT", itemId: "I", userDid: "did:viewer", text: "Secret comment", createdAt: 1 }],
    presence: [{ _id: "PRESENCE", listId: "L", userDid: "did:owner", status: "active", lastSeenAt: Date.now(), updatedAt: 1 }],
    activities: [{ _id: "ACT", listId: "L", itemId: "I", actorDid: "did:owner", type: "item_updated", createdAt: 1 }],
    itemAssignees: [{ _id: "ASSIGN", listId: "L", itemId: "I", assigneeDid: "did:owner", assignedByDid: "did:owner", assignedAt: 1 }],
    bitcoinAnchors: [{ _id: "ANCHOR", listId: "L", itemId: "I", txid: "tx", contentHash: "hash", status: "pending", createdAt: 1 }],
    categories: [{ _id: "CAT", name: "Owner's category", ownerDid: "did:owner" }],
    bookmarks: [], subscriptions: [], referrals: [], pushTokens: [],
    agentApiKeys: ["owner", "editor", "viewer", "outsider"].map(name => ({ _id: `KEY-${name}`, ownerDid: `did:${name}`, keyHash: digest(`key-${name}`), scopes: ["lists:read", "items:read", "items:write"] })),
  };
  const find = id => Object.values(rows).flat().find(row => row._id === id) ?? null;
  let next = 0;
  const reads = [];
  const scheduled = [];
  const ctx = { rows, reads, scheduled, db: {
    get: async id => { reads.push({ id }); return find(id); },
    patch: async (id, patch) => { assert.ok(find(id), `Missing ${id}`); Object.assign(find(id), patch); },
    insert: async (table, values) => { const row = { ...values, _id: `${table}-${++next}`, _creationTime: Date.now() }; (rows[table] ??= []).push(row); return row._id; },
    delete: async id => { for (const table of Object.values(rows)) { const at = table.findIndex(r => r._id === id); if (at >= 0) table.splice(at, 1); } },
    query: table => {
      const predicates = [];
      const q = {
        withIndex: (index, fn) => {
          reads.push({ table, index });
          const b = {
            eq: (key, value) => { predicates.push(row => row[key] === value); return b; },
            gte: (key, value) => { predicates.push(row => row[key] !== undefined && row[key] >= value); return b; },
            lte: (key, value) => { predicates.push(row => row[key] === undefined || row[key] <= value); return b; },
          };
          fn?.(b); return q;
        },
        order: () => q,
        filter: fn => {
          const b = { field: key => row => row[key], eq: (left, right) => row => (typeof left === "function" ? left(row) : left) === right, or: (...ps) => row => ps.some(p => p(row)), and: (...ps) => row => ps.every(p => p(row)) };
          predicates.push(fn(b)); return q;
        },
        collect: async () => (rows[table] ?? []).filter(row => predicates.every(p => p(row))),
        take: async count => (await q.collect()).slice(0, count),
        first: async () => (await q.collect())[0] ?? null,
        unique: async () => { const found = await q.collect(); assert.ok(found.length < 2, `Duplicate ${table}`); return found[0] ?? null; },
      };
      return q;
    },
  }, scheduler: { runAfter: async (_ms, ref, args) => scheduled.push({ ref, args }), runAt: async (_ms, ref, args) => scheduled.push({ ref, args }) } };
  ctx.runQuery = ctx.runMutation = async (ref, args) => {
    const [mod, fn] = getFunctionName(ref).split(":");
    assert.ok(modules[mod]?.[fn]?._handler, `Unmocked dispatch ${mod}:${fn}`);
    return modules[mod][fn]._handler(ctx, args);
  };
  ctx.action = { runQuery: ctx.runQuery, runMutation: ctx.runMutation };
  return ctx;
}
