import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { getFunctionName } from 'convex/server';
import { createAuthFixture } from './auth-fixture.mjs';

export async function loadReplayModules(name) {
  const entries = ['convex/items.ts', 'convex/lists.ts', 'convex/lib/httpResponses.ts', 'src/lib/offline.ts', 'src/lib/sync.ts', 'src/lib/optimisticItems.ts', 'src/lib/legacyOffline.ts', 'shared/replay.ts'];
  const outdir = `tmp/${name}`;
  await build({ entryPoints: entries, outdir, outbase: '.', bundle: true, splitting: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, external: ['convex/*', 'idb'] });
  const loaded = await Promise.all(entries.map(p => import(pathToFileURL(`${process.cwd()}/${outdir}/${p.replace('.ts', '.mjs')}`))));
  return Object.fromEntries(['items', 'lists', 'http', 'offline', 'sync', 'optimistic', 'legacy', 'shared'].map((key, i) => [key, loaded[i]]));
}
let fixtureCount = 0;
export async function replayFixture(modules) {
  const owner = await createAuthFixture(`did:owner-${++fixtureCount}`);
  const collaborator = await createAuthFixture(`did:collaborator-${fixtureCount}`);
  let rows = {
    users: [owner.user, collaborator.user], accessSessions: [owner.accessSession, collaborator.accessSession],
    lists: [{ _id: 'L1', _creationTime: 1, assetDid: 'did:list', name: 'Groceries', ownerDid: owner.user.did, createdAt: 1 }],
    items: [{ _id: 'I1', _creationTime: 1, listId: 'L1', name: 'Milk', checked: false, createdByDid: owner.user.did, createdAt: 1, updatedAt: 1, vcProofs: [{ type: 'ExistingSignedProof', proof: 'do-not-replace', issuer: owner.user.did }] }],
    publications: [{ _id: 'P1', listId: 'L1', status: 'active' }], offlineReceipts: [],
  };
  let sequence = 0;
  const effects = [];
  const find = id => Object.values(rows).flat().find(r => r._id === id);
  const ctx = {
    db: {
      get: async id => structuredClone(find(id) ?? null),
      patch: async (id, values) => { const row = find(id); if (!row) throw Error('Missing row'); for (const [key, value] of Object.entries(values)) { if (value === undefined) delete row[key]; else row[key] = structuredClone(value); } },
      insert: async (table, value) => { const _id = `${table}-${++sequence}`; (rows[table] ??= []).push({ ...structuredClone(value), _id, _creationTime: sequence }); return _id; },
      delete: async id => { for (const table of Object.keys(rows)) rows[table] = rows[table].filter(r => r._id !== id); },
      query: table => {
        let selected = rows[table] ?? [];
        const q = {
          withIndex(_index, fn) { const builder = { eq(field, value) { selected = selected.filter(r => r[field] === value); return builder; } }; fn?.(builder); return q; },
          collect: async () => structuredClone(selected), first: async () => structuredClone(selected[0] ?? null),
          unique: async () => { if (selected.length > 1) throw Error('Duplicate receipt'); return structuredClone(selected[0] ?? null); },
          take: async n => structuredClone(selected.slice(0, n)),
        }; return q;
      },
    },
    scheduler: { runAfter: async (...args) => { effects.push(args); } },
  };
  // Model mutation transactions with serial isolation and rollback. Real Convex
  // OCC / transport is deliberately left to the isolated integration backend.
  let tail = Promise.resolve();
  const transaction = fn => {
    const next = tail.then(async () => {
      const before = structuredClone(rows), effectCount = effects.length;
      try { return await fn(); } catch (error) { rows = before; effects.length = effectCount; throw error; }
    });
    tail = next.catch(() => {}); return next;
  };
  const call = (namespace, name, args, who = owner) => transaction(() => modules[namespace][name]._handler(ctx, { ...args, authToken: who.authToken }));
  const client = { mutation: (ref, args) => { const [ns, name] = getFunctionName(ref).split(':'); return transaction(() => modules[ns][name]._handler(ctx, args)); }, query: () => { throw Error('Unexpected preflight query'); } };
  const session = { accountId: owner.user.turnkeySubOrgId, token: owner.authToken };
  return { get rows() { return rows; }, owner, collaborator, ctx, effects, call, client, session };
}
