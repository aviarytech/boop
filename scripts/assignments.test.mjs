import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { getFunctionName } from 'convex/server';
import { createHash } from 'node:crypto';
import { loadReplayModules, replayFixture } from './helpers/replay-fixture.mjs';
const modules = await loadReplayModules('assignments-replay');
const names = ['assignees', 'originals', 'assigneesHttp', 'agentReadHttp', 'actorSession', 'users', 'migrations/remintUserDidDb'];
await build({ entryPoints: names.map(n => `convex/${n}.ts`), outdir: 'tmp/assignments-extra', bundle: true, platform: 'node', format: 'esm', external: ['convex/*'], outExtension: { '.js': '.mjs' } });
for (const name of names) modules[name] = await import(pathToFileURL(`${process.cwd()}/tmp/assignments-extra/${name}.mjs`));
async function fixture() {
  const f = await replayFixture(modules);
  const query = f.ctx.db.query;
  f.ctx.db.query = table => { const q = query(table); q.order = () => q; return q; };
  f.ctx.runQuery = f.ctx.runMutation = (ref, args) => { const [ns, name] = getFunctionName(ref).split(':'); return modules[ns][name]._handler(f.ctx, args); };
  return f;
}
const dids = async f => (await f.call('assignees', 'getItemAssignees', { itemId: 'I1' })).map(r => r.assigneeDid).sort();
async function seed(f, scalar, rows) {
  if (scalar) await f.ctx.db.patch('I1', { assigneeDid: scalar });
  for (const [i, did] of rows.entries()) await f.ctx.db.insert('itemAssignees', { itemId: 'I1', listId: 'L1', assigneeDid: did, assignedByDid: `actor-${i}`, assignedAt: i });
}
for (const [label, scalar, rows, expected, conflict] of [
  ['none', undefined, [], [], false], ['scalar', 'a', [], ['a'], false], ['rows', undefined, ['b'], ['b'], false],
  ['matching', 'a', ['a'], ['a'], false], ['conflicting', 'a', ['b'], ['a','b'], true],
  ['multi', 'a', ['a','b'], ['a','b'], true], ['duplicates', 'a', ['b','b'], ['a','b'], true],
]) test(`reconciliation ${label}: union, explicit conflict, original history, idempotent reruns`, async () => {
  const f = await fixture(); await seed(f, scalar, rows);
  const proof = structuredClone(f.rows.items[0].vcProofs);
  const stored = structuredClone(f.rows.itemAssignees ?? []);
  assert.deepEqual(await dids(f), expected);
  const result = await modules.assignees.reconcileBatch._handler(f.ctx, { itemIds: ['I1'] });
  assert.deepEqual(result, [{ itemId: 'I1', migrated: true, conflict }]);
  assert.deepEqual(await dids(f), expected);
  for (const row of stored) assert.deepEqual(await f.ctx.db.get(row._id), row);
  assert.deepEqual(f.rows.items[0].vcProofs, proof);
  const once = structuredClone(f.rows);
  await modules.assignees.reconcileBatch._handler(f.ctx, { itemIds: ['I1','I1'] });
  assert.deepEqual(f.rows, once);
  if (scalar && !rows.includes(scalar)) assert.equal(f.rows.itemAssignees.find(r => r.assigneeDid === scalar).inferredFromLegacyScalar, true);
  if (conflict) assert.equal(JSON.parse(f.rows.activities[0].metadata.note).conflict, true);
});

test('browser, API, Explorer and secondary reads agree; API retries and legacy adapter preserve other members', async () => {
  const f = await fixture();
  await f.call('items', 'updateItem', { itemId: 'I1', assigneeDids: ['external:one','external:two'] });
  const activityCount = f.rows.activities.length;
  await f.call('assignees', 'assignItem', { itemId: 'I1', assigneeDid: 'external:one' });
  await f.call('assignees', 'unassignItem', { itemId: 'I1', assigneeDid: 'missing' });
  assert.equal(f.rows.activities.length, activityCount);
  for (const row of f.rows.itemAssignees) assert.equal(row.assignedByDid, f.owner.user.did);
  await f.ctx.db.patch('I1', { dueDate: 5, priority: 'high' });
  for (const name of ['getListItems','getListItemsForReplay','getItemsWithDueDates']) {
    const value = await f.call('items', name, { listId: 'L1', operationIds: [] });
    assert.deepEqual((value.items ?? value)[0].assigneeDids, ['external:one','external:two']);
  }
  assert.deepEqual((await f.call('items','getItemForSync',{itemId:'I1'})).assigneeDids,['external:one','external:two']);
  assert.deepEqual((await f.call('items','getHighPriorityItems',{}))[0].item.assigneeDids,['external:one','external:two']);
  await f.ctx.db.patch('I1', { parentId: 'I1' });
  assert.deepEqual((await f.call('items','getSubItems',{parentId:'I1'}))[0].assigneeDids,['external:one','external:two']);
  const explorer = await f.call('originals','listOwnedOriginals',{});
  assert.equal(explorer[0].collaborators, 2);
  await f.call('items','updateItem',{itemId:'I1', name:'Unrelated'});
  assert.deepEqual(await dids(f),['external:one','external:two']);
  await f.call('items','updateItem',{itemId:'I1', assigneeDid:'replacement'});
  assert.deepEqual(await dids(f),['external:two','replacement']);
  await f.call('items','updateItem',{itemId:'I1', clearAssigneeDid:true});
  assert.deepEqual(await dids(f),['external:two']);
  await f.call('assignees','unassignItem',{itemId:'I1', assigneeDid:'external:two'});
  await modules.assignees.reconcileBatch._handler(f.ctx,{itemIds:['I1']});
  assert.deepEqual((await f.call('items','getListItems',{listId:'L1'}))[0].assigneeDids,[]);
});

test('HTTP keeps multi-assignee shape, arbitrary assignee identities, and scope/resource protection', async () => {
  const f = await fixture();
  const request = (path, body) => new Request(`https://example.test/${path}`, {method:'POST',headers:{Authorization:`Bearer ${f.owner.authToken}`, 'Content-Type':'application/json'}, body:JSON.stringify(body)});
  for (const assigneeDid of ['arbitrary-one','did:external:two']) {
    const result = await modules.assigneesHttp.assignItem._handler(f.ctx,request('assign',{itemId:'I1',assigneeDid}));
    assert.equal(result.status,200); assert.deepEqual(await result.json(),{success:true});
  }
  const read = await modules.assigneesHttp.getItemAssignees._handler(f.ctx,request('read',{itemId:'I1'}));
  const json = await read.json(); assert.equal(json.assignees.length,2);
  for (const row of json.assignees) assert.equal(row.assignedByDid,f.owner.user.did);
  const combined = await modules.agentReadHttp.getListWithItems._handler(f.ctx,new Request('https://example.test/api/v1/lists/items?listId=L1',{headers:{Authorization:`Bearer ${f.owner.authToken}`}}));
  assert.deepEqual((await combined.json()).items[0].assigneeDids,['arbitrary-one','did:external:two']);
  await modules.assigneesHttp.unassignItem._handler(f.ctx,request('unassign',{itemId:'I1',assigneeDid:'arbitrary-one'}));
  assert.deepEqual((await f.call('items','getListItemsForReplay',{listId:'L1',operationIds:[]})).items[0].assigneeDids,['did:external:two']);
  // Private resource and scoped agent checks remain at the existing boundary.
  f.rows.publications.length=0;
  f.rows.listGrants.length=0; // The fixture collaborator must also lose its explicit grant.
  await assert.rejects(()=>f.call('assignees','assignItem',{itemId:'I1',assigneeDid:'x'},f.collaborator),/authorized|unavailable/);
  await f.ctx.db.insert('agentApiKeys',{ownerDid:f.owner.user.did,keyHash:createHash('sha256').update('read-only').digest('hex'),scopes:['items:read']});
  await assert.rejects(()=>modules.assignees.assignItem._handler(f.ctx,{apiKey:'read-only',itemId:'I1',assigneeDid:'x'}),/Missing scope/);
});

for (const migrateFirst of [false,true]) test(`duplicate removal never resurrects scalar; migrated=${migrateFirst}`,async()=>{
  const f=await fixture(); await seed(f,'a',['a','a','b']);
  if(migrateFirst) await modules.assignees.reconcileBatch._handler(f.ctx,{itemIds:['I1']});
  await f.call('assignees','unassignItem',{itemId:'I1',assigneeDid:'a'});
  assert.deepEqual(await dids(f),['b']);
  const removed=f.rows.activities.find(a=>a.type==='item_unassigned');
  assert.equal(JSON.parse(removed.metadata.note).priorAssignments.length,2);
  await modules.assignees.reconcileBatch._handler(f.ctx,{itemIds:['I1']});
  assert.deepEqual(await dids(f),['b']);
  await f.call('items','updateItem',{itemId:'I1',assigneeDids:[]});
  await modules.assignees.reconcileBatch._handler(f.ctx,{itemIds:['I1']});
  assert.deepEqual(await dids(f),[]);
});

test('reconciliation and orphan cleanup reject oversized batches and never remove live memberships',async()=>{
  const f=await fixture(); await seed(f,undefined,['a']);
  await assert.rejects(()=>modules.assignees.reconcileBatch._handler(f.ctx,{itemIds:Array(26).fill('I1')}),/25/);
  for(let i=0;i<100;i++) await f.ctx.db.insert('itemAssignees',{itemId:'I1',listId:'L1',assigneeDid:`x${i}`,assignedByDid:'x',assignedAt:1});
  await assert.rejects(()=>modules.assignees.reconcileBatch._handler(f.ctx,{itemIds:['I1']}),/Large assignment/);
  const orphan=await f.ctx.db.insert('itemAssignees',{itemId:'gone',listId:'L1',assigneeDid:'orphan',assignedByDid:'x',assignedAt:1});
  assert.deepEqual(await modules.assignees.cleanupOrphanRows._handler(f.ctx,{rowIds:[orphan,f.rows.itemAssignees[0]._id]}),[orphan]);
  assert.equal(f.rows.itemAssignees.length,101);
});

for(const operation of ['checkItem','batchCheckItems','copyList']) test(`${operation} inherits all assignments, retains source evidence and records truthful new history`,async()=>{
  const f=await fixture(); await seed(f,'a',['b','b','c']);
  await f.ctx.db.patch('I1',{recurrence:{frequency:'daily'},dueDate:10});
  const source=structuredClone(f.rows.items[0]); const sourceRows=structuredClone(f.rows.itemAssignees);
  if(operation==='copyList') await f.call('lists',operation,{sourceListId:'L1',assetDid:'did:new',celEnvelope:'{}',name:'Copy',createdAt:5});
  else await f.call('items',operation,operation==='checkItem'?{itemId:'I1',checkedAt:10}:{itemIds:['I1']});
  const next=f.rows.items.find(i=>i._id!=='I1');
  assert.deepEqual(f.rows.itemAssignees.filter(r=>r.itemId===next._id).map(r=>r.assigneeDid).sort(),['a','b','c']);
  assert.deepEqual(f.rows.itemAssignees.filter(r=>r.itemId==='I1'),sourceRows);
  assert.deepEqual(f.rows.items[0].vcProofs[0],source.vcProofs[0]);
  if(operation==='copyList') assert.deepEqual(f.rows.items[0],source);
  assert.equal(next.vcProofs,undefined);
  for(const event of f.rows.activities.filter(a=>a.itemId===next._id)) {
    assert.equal(event.actorDid,f.owner.user.did); assert.match(event.metadata.note,/from item I1/);
  }
});

for(const operation of ['removeItem','batchDeleteItems','deleteList']) test(`${operation} deletes live memberships; Explorer ignores old orphan rows`,async()=>{
  const f=await fixture(); await seed(f,undefined,['a','b']);
  const orphan=await f.ctx.db.insert('itemAssignees',{itemId:'old-deleted',listId:'L1',assigneeDid:'ghost',assignedByDid:'a',assignedAt:1});
  assert.equal((await f.call('originals','listOwnedOriginals',{}))[0].collaborators,2);
  if(operation==='deleteList') await f.call('lists',operation,{listId:'L1'});
  else await f.call('items',operation,operation==='removeItem'?{itemId:'I1'}:{itemIds:['I1']});
  assert.equal(f.rows.itemAssignees.some(r=>r.itemId==='I1'),false);
  if(operation==='deleteList') assert.equal(f.rows.itemAssignees.length,0);
  else {assert.equal((await f.call('originals','listOwnedOriginals',{}))[0].collaborators,undefined); await modules.assignees.cleanupOrphanRows._handler(f.ctx,{rowIds:[orphan]});}
});

test('queued assignment and unrelated edits hash persisted fields, retain multi-membership and reject same-clock API changes',async()=>{
  const f=await fixture(); await f.call('items','updateItem',{itemId:'I1',assigneeDids:['a','b']});
  let snapshot=(await f.call('items','getListItemsForReplay',{listId:'L1',operationIds:[]})).items;
  await modules.offline.queueMutation(f.session.accountId,{type:'updateItem',payload:{itemId:'I1',name:'Queued unrelated'}},snapshot);
  await new modules.sync.SyncManager().sync(f.client,f.session);
  assert.equal((await modules.offline.getQueuedMutations(f.session.accountId)).length,0);
  assert.deepEqual(await dids(f),['a','b']);
  snapshot=(await f.call('items','getListItemsForReplay',{listId:'L1',operationIds:[]})).items;
  await modules.offline.queueMutation(f.session.accountId,{type:'updateItem',payload:{itemId:'I1',assigneeDids:['a','b','c']}},snapshot);
  await new modules.sync.SyncManager().sync(f.client,f.session);
  assert.deepEqual(await dids(f),['a','b','c']);
  const realNow=Date.now; Date.now=()=>100;
  try {
    snapshot=(await f.call('items','getListItemsForReplay',{listId:'L1',operationIds:[]})).items;
    await modules.offline.queueMutation(f.session.accountId,{type:'updateItem',payload:{itemId:'I1',assigneeDids:[]}},snapshot);
    const version=f.rows.items[0].assignmentsVersion;
    await f.call('assignees','assignItem',{itemId:'I1',assigneeDid:'d'});
    await f.call('assignees','unassignItem',{itemId:'I1',assigneeDid:'d'});
    assert.equal(f.rows.items[0].assignmentsVersion,version+2);
    await new modules.sync.SyncManager().sync(f.client,f.session);
    assert.equal((await modules.offline.getQueuedMutations(f.session.accountId))[0].state,'conflict');
    assert.deepEqual(await dids(f),['a','b','c']);
  } finally {Date.now=realNow;}
});

test('DID remint collisions keep row attribution and logical dedupe, advancing secondary-assignment revisions',async()=>{
  const f=await fixture(); const old=f.owner.user.did, next='did:new';
  await f.call('items','updateItem',{itemId:'I1',assigneeDids:['a',old,next]});
  const unrelatedProof={type:'Signed',issuer:'unrelated',actorDid:'unrelated',proof:'unchanged-signed-bytes'};
  await f.ctx.db.patch('I1',{vcProofs:[unrelatedProof],createdByDid:'unrelated-creator'});
  const before=await modules.shared.revision(f.rows.items[0]);
  const version=f.rows.items[0].assignmentsVersion;
  const count=f.rows.itemAssignees.length;
  await modules['migrations/remintUserDidDb'].applyRemint._handler(f.ctx,{userId:f.owner.user._id,oldDid:old,newDid:next});
  assert.equal(f.rows.itemAssignees.length,count);
  assert.notEqual(await modules.shared.revision(f.rows.items[0]),before);
  assert.equal(f.rows.items[0].assignmentsVersion,version+1);
  assert.deepEqual(f.rows.items[0].vcProofs,[unrelatedProof]);
  assert.deepEqual(await dids(f),['a',next]);
  await f.call('assignees','unassignItem',{itemId:'I1',assigneeDid:next});
  assert.deepEqual(await dids(f),['a']);
  assert.equal(JSON.parse(f.rows.activities.find(a=>a.type==='item_unassigned').metadata.note).priorAssignments.length,2);
});

test('temporary create, multi-assign, clear and reassign survive receipts without duplicate events',async()=>{
  const f=await fixture(), account=f.session.accountId, store=modules.offline;
  await store.queueMutation(account,{type:'addItem',payload:{listId:'L1',name:'Offline task',createdAt:1}});
  let projected=modules.optimistic.projectItems([],await store.getOperations(account),'L1');
  const temp=projected[0]._id;
  for(const assigneeDids of [['a','b'],[],['c','d']]) {
    await store.queueMutation(account,{type:'updateItem',payload:{itemId:temp,assigneeDids}},projected);
    projected=modules.optimistic.projectItems([],await store.getOperations(account),'L1');
    assert.deepEqual(projected[0].assigneeDids,assigneeDids);
  }
  const operations=await store.getOperations(account);
  await new modules.sync.SyncManager().sync(f.client,f.session);
  assert.equal((await store.getQueuedMutations(account)).length,0);
  const created=f.rows.items.find(i=>i.name==='Offline task');
  assert.deepEqual(f.rows.itemAssignees.filter(r=>r.itemId===created._id).map(r=>r.assigneeDid).sort(),['c','d']);
  const events=f.rows.activities.filter(a=>a.itemId===created._id);
  assert.equal(events.filter(a=>a.type==='item_assigned').length,4);
  assert.equal(events.filter(a=>a.type==='item_unassigned').length,2);
  const receipt=f.rows.offlineReceipts.find(r=>r.operationId===operations[0].operationId);
  const before=structuredClone(f.rows);
  // The pre-change payload has no assigneeDids key. Canonical fingerprint must
  // still match after adding an optional validator to the server declaration.
  assert.equal(receipt.fingerprint,await modules.shared.revision({operation:'addItem',payload:{listId:'L1',name:'Offline task',createdAt:1},expected:[]}));
  await f.call('items','addItemReplay',{listId:'L1',name:'Offline task',createdAt:1,replay:{operationId:receipt.operationId,accountId:account,expected:[]}});
  assert.deepEqual(f.rows,before);
});

test('batch deletion of parent and direct deletion of child remove memberships',async()=>{
  for(const direct of [false,true]) {
    const f=await fixture();
    const child=await f.call('items','addItem',{listId:'L1',name:'Child',createdAt:1,parentId:'I1',assigneeDids:['a','b']});
    await f.call('items',direct?'removeItem':'batchDeleteItems',direct?{itemId:child}:{itemIds:['I1']});
    assert.equal(f.rows.items.some(i=>i._id===child),false);
    assert.equal(f.rows.itemAssignees.some(r=>r.itemId===child),false);
  }
});

test('account deletion drains preexisting orphan assignments before deleting their list',async()=>{
  const f=await fixture();
  await f.ctx.db.insert('itemAssignees',{itemId:'gone',listId:'L1',assigneeDid:'ghost',assignedByDid:'x',assignedAt:1});
  await f.call('users','deleteUserData',{userId:f.owner.user._id});
  for(let step=0;step<20 && f.rows.lists.length;step++) await modules.users.continueUserDeletion._handler(f.ctx,{userId:f.owner.user._id});
  assert.equal(f.rows.lists.length,0);
  assert.equal(f.rows.itemAssignees.length,0);
});

for(const legacy of [{assigneeDid:'new'}, {clearAssigneeDid:true}, {}]) test(`row-only legacy update preserves unseen row members: ${JSON.stringify(legacy)}`,async()=>{
  const f=await fixture(); await seed(f,undefined,['existing','secondary']);
  const evidence=structuredClone(f.rows.itemAssignees);
  await f.call('items','updateItem',{itemId:'I1',name:'Legacy unrelated save',...legacy});
  assert.deepEqual(await dids(f),legacy.assigneeDid?['existing','new','secondary']:['existing','secondary']);
  for(const row of evidence) assert.deepEqual(await f.ctx.db.get(row._id),row);
  assert.equal((f.rows.activities??[]).some(a=>a.type==='item_unassigned'),false);
});

for(const assigned of [false,true]) test(`older snapshot cleaner accepts unchanged joined revision; assigned=${assigned}`,async()=>{
  const f=await fixture();
  if(assigned) await f.call('items','updateItem',{itemId:'I1',assigneeDids:['a','b']});
  const snapshot=(await f.call('items','getListItemsForReplay',{listId:'L1',operationIds:[]})).items[0];
  const oldCleaner=doc=>Object.fromEntries(Object.entries(doc).filter(([k])=>!['_isOptimistic','_syncError','_localKey','_operationId'].includes(k)));
  const expected=[{id:'I1',revision:await modules.shared.revision(oldCleaner({...snapshot,_localKey:'local',_isOptimistic:true}))}];
  const replay={operationId:`old-client-${assigned}`,accountId:f.session.accountId,expected};
  const result=await f.call('items','updateItemReplay',{itemId:'I1',name:'Old client unchanged snapshot',replay});
  assert.equal(f.rows.items[0].name,'Old client unchanged snapshot');
  const rows=structuredClone(f.rows);
  assert.deepEqual(await f.call('items','updateItemReplay',{itemId:'I1',name:'Old client unchanged snapshot',replay}),result);
  assert.deepEqual(f.rows,rows,'retry retains old fingerprint/receipt and emits nothing');
  const updated=(await f.call('items','getListItemsForReplay',{listId:'L1',operationIds:[]})).items[0];
  const stale=[{id:'I1',revision:await modules.shared.revision(oldCleaner(updated))}];
  await f.call('assignees','assignItem',{itemId:'I1',assigneeDid:'concurrent'});
  await f.call('assignees','unassignItem',{itemId:'I1',assigneeDid:'concurrent'});
  await assert.rejects(()=>f.call('items','updateItemReplay',{itemId:'I1',name:'Must conflict',replay:{operationId:`old-client-conflict-${assigned}`,accountId:f.session.accountId,expected:stale}}),/changed on the server/);
  const current=(await f.call('items','getListItemsForReplay',{listId:'L1',operationIds:[]})).items[0];
  await assert.rejects(async()=>f.call('items','updateItemReplay',{itemId:'I1',name:'Must reject arbitrary projection',replay:{operationId:`old-client-partial-${assigned}`,accountId:f.session.accountId,expected:[{id:'I1',revision:await modules.shared.revision({name:current.name,assigneeDids:current.assigneeDids})}]}}),/changed on the server/);
});

// Count actual database calls made by the authenticated handlers, not helper
// invocation counts. Fail early if an accidental per-item loop returns.
function measureReads(f, budget = 100) {
  const calls = { gets: 0, getIds: [], queries: [] };
  const get = f.ctx.db.get, query = f.ctx.db.query;
  const check = () => assert.ok(calls.gets + calls.queries.length <= budget, 'database read-call budget exceeded');
  f.ctx.db.get = async id => { calls.gets++; calls.getIds.push(id); check(); return get(id); };
  f.ctx.db.query = table => {
    const entry = { table, index: undefined, bounds: {} }; calls.queries.push(entry); check();
    const q = query(table), withIndex = q.withIndex;
    q.withIndex = (index, fn) => {
      entry.index = index;
      return withIndex(index, builder => {
        const wrapped = { eq(key, value) { entry.bounds[key] = value; builder.eq(key, value); return wrapped; } };
        return fn?.(wrapped);
      });
    };
    return q;
  };
  return calls;
}
function seedLargeList(f, count) {
  f.rows.items = Array.from({ length: count }, (_, i) => ({ _id: `large-${i}`, _creationTime: i,
    listId: 'L1', name: `Task ${i}`, checked: false, createdByDid: f.owner.user.did, createdAt: i,
    order: i, ...(i < 8 ? { dueDate: 10, priority: 'high', parentId: 'large-10' } : {}),
    ...(i === 0 ? { assigneeDid: 'legacy' } : {}),
    ...(i === 1 ? { assigneeDid: 'conflict-scalar' } : {}),
    ...(i === 2 ? { assigneeDid: 'stale-scalar', assignmentsVersion: 5 } : {}),
  }));
  f.rows.itemAssignees = [
    ['large-1', 'row-member'], ['large-1', 'row-member'], ['large-2', 'authoritative'],
    ['large-3', 'multi-a'], ['large-3', 'multi-b'], ['deleted-item', 'orphan'],
  ].map(([itemId,assigneeDid],i)=>({_id:`large-row-${i}`,listId:'L1',itemId,assigneeDid,assignedByDid:`historical-${i}`,assignedAt:i}));
}
const largeExpected = [ ['legacy'], ['conflict-scalar','row-member'], ['authoritative'], ['multi-a','multi-b'] ];
function assertLargeProjection(items) {
  for(let i=0;i<4;i++) assert.deepEqual(items.find(item=>item._id===`large-${i}`).assigneeDids,largeExpected[i]);
  for(const item of items) {
    assert.ok(!item.assigneeDids.includes('orphan'));
    assert.ok(!item.assigneeDids.includes('stale-scalar'));
  }
}

for(const count of [20,4500]) test(`Explorer ${count} items uses one assignment read and filters legacy/orphan data`,async()=>{
  const f=await fixture(); seedLargeList(f,count); const reads=measureReads(f);
  const rows=await f.call('originals','listOwnedOriginals',{});
  assert.equal(rows[0].collaborators,6);
  assert.deepEqual(reads.queries.filter(q=>q.table==='itemAssignees'),[{table:'itemAssignees',index:'by_list',bounds:{listId:'L1'}}]);
  assert.ok(reads.queries.length<15);
});

for(const operation of ['getListItems','getListItemsForReplay','getListWithItemsForViewer','getSubItems','getItemsWithDueDates','getHighPriorityItems']) test(`${operation} batches a 4500-item list without querying assignments on unrelated lists`,async()=>{
  const f=await fixture(); seedLargeList(f,4500);
  if(operation==='getHighPriorityItems') for(const item of f.rows.items) delete item.parentId;
  f.rows.lists.push({_id:'L-empty',ownerDid:f.owner.user.did,name:'Empty',createdAt:1});
  f.rows.items.push({_id:'other-1',listId:'L-unrelated',name:'Unrelated',checked:false,createdAt:1,createdByDid:'other'});
  const reads=measureReads(f);
  const result=await f.call(operation==='getListWithItemsForViewer'?'lists':'items',operation,{listId:'L1',parentId:'large-10',operationIds:[],startDate:1,endDate:20});
  const items=operation==='getHighPriorityItems'?result.map(row=>row.item):(result.items??result);
  assert.equal(items.length,['getSubItems','getItemsWithDueDates','getHighPriorityItems'].includes(operation)?8:4500);
  assertLargeProjection(items);
  assert.deepEqual(reads.queries.filter(q=>q.table==='itemAssignees'),[{table:'itemAssignees',index:'by_list',bounds:{listId:'L1'}}]);
});

test('singleton and empty filtered results avoid whole-list assignment reads',async()=>{
  const f=await fixture(); seedLargeList(f,4500);
  for(const item of f.rows.items) delete item.dueDate;
  f.rows.items[0].dueDate=10;
  const reads=measureReads(f);
  const result=await f.call('items','getItemsWithDueDates',{listId:'L1'});
  assert.equal(result.length,1);
  assert.deepEqual(result[0].assigneeDids,['legacy']);
  assert.deepEqual(reads.queries.filter(q=>q.table==='itemAssignees'),[{table:'itemAssignees',index:'by_item',bounds:{itemId:'large-0'}}]);
  const before=reads.queries.length;
  assert.deepEqual(await f.call('items','getItemsWithDueDates',{listId:'L1',startDate:100}),[]);
  assert.equal(reads.queries.slice(before).filter(q=>q.table==='itemAssignees').length,0);
});

for(const count of [20,1200]) test(`copy ${count} mostly unassigned items uses constant assignment/source reads and no new-target reads`,async()=>{
  const f=await fixture(); seedLargeList(f,count);
  const sourceItems=structuredClone(f.rows.items), sourceRows=structuredClone(f.rows.itemAssignees);
  const sourceEvent={_id:'source-event',listId:'L1',itemId:'large-1',actorDid:'historical',type:'item_assigned',metadata:{assigneeDid:'row-member'},createdAt:1};
  f.rows.activities=[sourceEvent];
  f.rows.items[0].vcProofs=[{type:'ExistingSigned',proof:'source-only',issuer:'historical'}];
  sourceItems[0].vcProofs=structuredClone(f.rows.items[0].vcProofs);
  const reads=measureReads(f,50);
  const copied=await f.call('lists','copyList',{sourceListId:'L1',assetDid:'did:new',celEnvelope:'{}',name:'Large copy',createdAt:100});
  assert.equal(copied.itemsCopied,count);
  assert.deepEqual(reads.queries.filter(q=>q.table==='itemAssignees'),[{table:'itemAssignees',index:'by_list',bounds:{listId:'L1'}}]);
  assert.ok(reads.gets<15,'no reads of new items, including unassigned ones');
  assert.deepEqual(f.rows.items.filter(i=>i.listId==='L1'),sourceItems);
  assert.deepEqual(f.rows.itemAssignees.filter(i=>i.listId==='L1'),sourceRows);
  assert.deepEqual(f.rows.activities.filter(i=>i.listId==='L1'),[sourceEvent]);
  const targets=f.rows.items.filter(i=>i.listId===copied.listId);
  assert.equal(targets.length,count);
  assert.equal(targets.some(target=>reads.getIds.includes(target._id)),false,'new target items are never reread');
  for(let i=0;i<count;i++) {
    const target=targets.find(t=>t.name===`Task ${i}`), expected=largeExpected[i]??[];
    assert.equal(target.vcProofs,undefined);
    assert.equal(target.assigneeDid,expected[0]);
    assert.equal(target.assignmentsVersion,expected.length?2:1);
    assert.deepEqual(f.rows.itemAssignees.filter(r=>r.itemId===target._id).map(r=>r.assigneeDid).sort(),expected);
    const events=f.rows.activities.filter(a=>a.itemId===target._id);
    assert.equal(events.length,expected.length);
    for(const event of events) {assert.equal(event.actorDid,f.owner.user.did);assert.match(event.metadata.note,new RegExp(`copy from item large-${i};`));}
    if(i<8) assert.equal(target.parentId,targets.find(t=>t.name==='Task 10')._id);
  }
});

test('batch recurrence preloads assignment/order once per list and inserts truthful new memberships without target reads',async()=>{
  const f=await fixture(); seedLargeList(f,80);
  for(const item of f.rows.items) {item.recurrence={frequency:'daily'};item.dueDate=10;}
  const source=structuredClone(f.rows.itemAssignees);
  const reads=measureReads(f,1000);
  await f.call('items','batchCheckItems',{itemIds:f.rows.items.map(i=>i._id)});
  assert.deepEqual(reads.queries.filter(q=>q.table==='itemAssignees'),[{table:'itemAssignees',index:'by_list',bounds:{listId:'L1'}}]);
  assert.equal(reads.queries.filter(q=>q.table==='items').length,1);
  assert.deepEqual(f.rows.itemAssignees.filter(r=>r.itemId.startsWith('large-')),source.filter(r=>r.itemId.startsWith('large-')));
  const targets=f.rows.items.filter(i=>!i._id.startsWith('large-'));
  assert.equal(targets.length,80);
  assert.equal(targets.some(target=>reads.getIds.includes(target._id)),false,'new recurring items are never reread');
  for(let i=0;i<80;i++) {
    const target=targets.find(t=>t.name===`Task ${i}`), expected=largeExpected[i]??[];
    assert.deepEqual(f.rows.itemAssignees.filter(r=>r.itemId===target._id).map(r=>r.assigneeDid).sort(),expected);
    assert.equal(target.assignmentsVersion,expected.length?2:1);
    assert.equal(target.order,i<8?-i-1:-(i-8)-1);
    for(const event of f.rows.activities.filter(a=>a.itemId===target._id)) {assert.equal(event.actorDid,f.owner.user.did);assert.match(event.metadata.note,/recurrence from item large-/);}
  }
});
