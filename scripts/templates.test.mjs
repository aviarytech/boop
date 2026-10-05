import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createAuthFixture } from "./helpers/auth-fixture.mjs";

const outdir = "tmp/templates-test";

async function loadModule() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: ["./convex/templates.ts"],
    outfile: `${outdir}/templates.mjs`,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["convex/*"],
  });
  return import(
    `${pathToFileURL(`${process.cwd()}/${outdir}/templates.mjs`).href}?t=${Date.now()}`
  );
}

const mod = await loadModule();
const unwrap = (fn) => fn._handler ?? fn.handler;

const OWNER = "did:webvh:QmS:boop.ad:user-owner";
const STRANGER = "did:webvh:QmS:boop.ad:user-stranger";
const ownerSession = await createAuthFixture(OWNER);
const strangerSession = await createAuthFixture(STRANGER);

/**
 * The source list is a migrated one: its envelope exists but nobody holds the
 * key, which is the situation copyList is for.
 */
function makeCtx({ items = [], lists: extraLists = [], user = null, subscription = null, failItem = false } = {}) {
  const rows = {
    lists: [
      { _id: "L1", ownerDid: OWNER, name: "Camping", createdAt: 1000, assetDid: "did:cel:old", itemViewMode: "categorized", itemCategories: [{ id: "c1", name: "Gear", emoji: "🎒", order: 0 }] },
      ...extraLists,
    ],
    items: items.map((i, n) => ({ _id: `I${n}`, listId: "L1", ...i })),
    users: [{ ...ownerSession.user, ...user }, strangerSession.user],
    accessSessions: [ownerSession.accessSession, strangerSession.accessSession],
    subscriptions: subscription ? [subscription] : [],
    referrals: [],
    listEnvelopes: [],
  };

  const byId = new Map();
  for (const table of Object.values(rows)) for (const r of table) byId.set(r._id, r);

  let seq = 0;
  const scheduled = [];
  return {
    rows,
    scheduled,
    scheduler: { runAfter: async (_delay, ref, args) => { scheduled.push({ ref, args }); } },
    db: {
      get: async (id) => byId.get(id) ?? null,
      patch: async (id, fields) => Object.assign(byId.get(id), fields),
      insert: async (table, doc) => {
        if (table === "items" && failItem) throw new Error("Injected insert failure");
        const _id = `${table}-${++seq}`;
        const row = { _id, _creationTime: Date.now(), ...doc };
        (rows[table] ??= []).push(row);
        byId.set(_id, row);
        return _id;
      },
      query: (table) => {
        let rowsFor = () => rows[table] ?? [];
        const result = {
          withIndex: (_name, fn) => {
            // Emulate just enough index filtering for by_list / by_owner.
            const captured = {};
            const builder = { eq: (field, value) => { captured[field] = value; return builder; } };
            fn?.(builder);
            const base = rowsFor;
            rowsFor = () =>
              base().filter((r) => Object.entries(captured).every(([k, v]) => r[k] === v));
            return result;
          },
          collect: async () => rowsFor(),
          first: async () => rowsFor()[0] ?? null,
          unique: async () => rowsFor()[0] ?? null,
        };
        return result;
      },
    },
  };
}


const create = unwrap(mod.createListFromTemplate);
const records = (ctx, action) => (ctx.rows.actionRecords ?? []).map(r => JSON.parse(r.payload)).filter(p => p.action === action);
const args = { builtinId: 'release-checklist', listName: 'Release checklist', assetDid: 'did:cel:template-test', authToken: ownerSession.authToken, expectedOwnerDid: OWNER };

test('all ten catalog runbooks have actionable, ordered steps and distinct landing copy', async () => {
  const { AGENT_RUNBOOKS, templateLoginDestination } = await import('../convex/lib/templateCatalog.ts');
  assert.equal(AGENT_RUNBOOKS.length, 10);
  assert.equal(new Set(AGENT_RUNBOOKS.map(t => t.id)).size, 10);
  for (const template of AGENT_RUNBOOKS) {
    assert.ok(template.useCase.length > 40 && template.outcome.length > 40);
    assert.ok(template.items.length >= 6);
    assert.deepEqual(template.items.map(i => i.order), template.items.map((_, i) => i));
    assert.ok(template.items.every(i => i.description.length > 60));
    const ctx = makeCtx();
    const id = await create(ctx, { ...args, builtinId: template.id });
    assert.deepEqual(ctx.rows.items.filter(i => i.listId === id).map(i => i.name), template.items.map(i => i.name));
  }
  assert.equal(templateLoginDestination('?template=release-checklist'), '/templates/release-checklist/use');
  for (const input of ['?template=https://evil.test', '?template=../d', '?template=private-id', '?next=//evil.test']) assert.equal(templateLoginDestination(input), '/d');
});
test('retry returns the complete original list without extra items, even at quota', async () => {
  const ctx = makeCtx({ lists: Array.from({length:3}, (_,i) => ({_id:`extra-${i}`, ownerDid:OWNER})) });
  const id = await create(ctx, args);
  assert.equal(await create(ctx, args), id);
  assert.equal(ctx.rows.lists.length, 5);
  assert.equal(ctx.rows.items.length, 6);
  assert.ok(ctx.rows.items.every(i => i.checked === false && i.createdByDid === OWNER));
  assert.equal((await ctx.db.get(id)).vcProof, undefined, 'no new unsigned ownership placeholder');
  assert.equal(records(ctx, 'list.created').length, 1);
  assert.equal(ctx.scheduled.length, 1, 'the retry queues no second signer run');
});
test('quick-start and saved template items get one creation record each, like ordinary creation, across retries', async () => {
  for (const saved of [false, true]) {
    const ctx = makeCtx();
    const source = saved
      ? { builtinId: undefined, templateId: await ctx.db.insert('listTemplates', {
        name: 'Saved runbook', ownerDid: OWNER, isPublic: false,
        items: [{ name: 'Review evidence', order: 0 }],
      }) }
      : { builtinId: 'grocery' };
    const request = { ...args, ...source };
    const listId = await create(ctx, request);
    const items = ctx.rows.items.filter(item => item.listId === listId);
    assert.ok(items.length > 0);
    const origin = { kind: 'template', source: saved ? `saved:${source.templateId}` : 'builtin:grocery' };
    assert.deepEqual(records(ctx, 'list.created').map(r => [r.subject, r.after, r.origin]),
      [[{ listId, listAssetDid: args.assetDid }, { name: args.listName, kind: 'list' }, origin]]);
    for (const item of items) {
      assert.equal(item.updatedAt, item.createdAt);
      assert.equal(item.assignmentsVersion, 1);
      assert.equal(item.vcProofs, undefined, 'no new unsigned authorship placeholder');
      const [record, ...extra] = records(ctx, 'item.created').filter(r => r.subject.itemId === item._id);
      assert.deepEqual(extra, []);
      assert.deepEqual(record.subject, { listId, listAssetDid: args.assetDid, itemId: item._id });
      assert.deepEqual(record.after, { name: item.name, checked: false });
      assert.deepEqual(record.origin, origin);
      assert.deepEqual(record.owner, { did: OWNER, userId: ownerSession.user._id });
      assert.deepEqual(record.credential, { kind: 'session', id: ownerSession.accessSession._id });
    }
    // One signer run covers the whole mutation's records.
    assert.deepEqual(ctx.scheduled.map(job => job.args.recordIds.length), [items.length + 1]);
    assert.ok(ctx.rows.actionRecords.every(r => r.status === 'pending' && r.signature === undefined));
    const before = structuredClone([ctx.rows.items, ctx.rows.actionRecords]);
    assert.equal(await create(ctx, request), listId);
    assert.deepEqual([ctx.rows.items, ctx.rows.actionRecords], before);
  }
});
test('new creation enforces free-plan quota before writing', async () => {
  const ctx = makeCtx({ lists: Array.from({length:4}, (_,i) => ({_id:`extra-${i}`, ownerDid:OWNER})) });
  await assert.rejects(create(ctx, args), /PLAN_LIMIT/);
  assert.equal(ctx.rows.lists.length, 5);
  assert.equal(ctx.rows.items.length, 0);
});
test('unknown template, mismatched account and unrelated asset cannot be acknowledged as activation', async () => {
  const ctx = makeCtx();
  await assert.rejects(create(ctx, {...args,builtinId:'private-id'}), /Template not found/);
  await assert.rejects(create(ctx, {...args,expectedOwnerDid:STRANGER}), /Account changed/);
  await assert.rejects(create(ctx, {...args,assetDid:'did:cel:old'}), /Asset already used/);
  await assert.rejects(create(ctx, {...args,authToken:undefined}), /auth|sign|session/i);
  assert.equal(ctx.rows.lists.length, 1);
});
test('item failure rejects the whole mutation; it never reports list creation success', async () => {
  const ctx = makeCtx({failItem:true});
  // The handler fixture intentionally is not a database emulator. Convex supplies
  // rollback in production; here verify that an insert error escapes the transaction.
  await assert.rejects(create(ctx,args), /Injected insert failure/);
});
test('same asset cannot cross template or account boundaries', async () => {
  const ctx = makeCtx();
  await create(ctx,args);
  await assert.rejects(create(ctx,{...args,builtinId:'ci-triage'}), /Asset already used/);
  await assert.rejects(create(ctx,{...args,authToken:strangerSession.authToken,expectedOwnerDid:STRANGER}), /Asset already used/);
});

test('first template grants referral benefits atomically and retries do not renew them',async()=>{
  const ctx=makeCtx();
  ctx.rows.lists.length=0;
  ctx.rows.referrals.push({_id:'referral',refereeId:ownerSession.user._id,referrerId:strangerSession.user._id});
  // The fixture map predates adding the referral; route its patches to the row.
  const patch=ctx.db.patch;
  ctx.db.patch=async(id,fields)=>id==='referral'?Object.assign(ctx.rows.referrals[0],fields):patch(id,fields);
  await create(ctx,args);
  assert.ok(ctx.rows.users[0].referralProUntil > Date.now());
  assert.equal(ctx.rows.users[0].referralProUntil,ctx.rows.users[1].referralProUntil);
  const granted=ctx.rows.referrals[0].proGrantedAt;
  await create(ctx,args);
  assert.equal(ctx.rows.referrals[0].proGrantedAt,granted);
});
test('private saved templates remain owner-only under the optional source validator',async()=>{
  const ctx=makeCtx();
  const id=await ctx.db.insert('listTemplates',{name:'Private',ownerDid:OWNER,isPublic:false,items:[]});
  await assert.rejects(create(ctx,{...args,builtinId:undefined,templateId:id,authToken:strangerSession.authToken,expectedOwnerDid:STRANGER}),/Not authorized/);
  await assert.rejects(create(ctx,{...args,templateId:id}),/exactly one/);
  await assert.rejects(create(ctx,{...args,builtinId:undefined}),/exactly one/);
  assert.equal(ctx.rows.lists.length,1);
});
