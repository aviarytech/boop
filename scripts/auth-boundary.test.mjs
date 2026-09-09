import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { SignJWT } from 'jose';
import { getFunctionName } from 'convex/server';
import { ConvexError, convexToJson, jsonToConvex } from 'convex/values';
import { createHash } from 'node:crypto';

process.env.JWT_SECRET = 'boundary-test-secret-not-a-deployed-credential';
const names = ['items','lists','publication','attachments','activity','assignees','presence','comments','tags','itemCategories','auth','authSessions','actorSession','didResources','itemsHttp','listsHttp','agentReadHttp','users','bitcoinAnchors','siteActions','siteInternals','sites','siteAssets','didCreation','billing','referrals','feedback','notificationActions','categories','templates','notifications'];
await build({ entryPoints: names.map(n => `convex/${n}.ts`), outdir: 'tmp/auth-boundary-test', bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, external: ['convex/*','@originals/*','@turnkey/*','didwebvh-ts','@noble/*'] });
const modules = Object.fromEntries(await Promise.all(names.map(async n => [n, await import(pathToFileURL(`${process.cwd()}/tmp/auth-boundary-test/${n}.mjs`))])));
const call = (module, name, ctx, args) => modules[module][name]._handler(ctx, args);
async function token(subject = 'owner', options = {}) {
  return new SignJWT({ email: `${subject}@example.test` }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject).setIssuer('originals-auth').setAudience('originals-api')
    .setExpirationTime(options.exp ?? '1h').sign(new TextEncoder().encode(options.secret ?? process.env.JWT_SECRET));
}
const ownerToken = await token(), strangerToken = await token('stranger');
function fixture({ published = false, migrated = false, keyScopes = ['lists:read','items:read','items:write'], revokedAt } = {}) {
  const rows = {
    users: [{ _id: 'U1', turnkeySubOrgId: 'owner', did: 'did:owner', legacyDid: migrated ? 'did:legacy' : undefined, email: 'owner@example.test' }, { _id: 'U2', turnkeySubOrgId: 'stranger', did: 'did:stranger', email: 'stranger@example.test' }],
    lists: [{ _id: 'L1', ownerDid: migrated ? 'did:legacy' : 'did:owner', name: 'Private', createdAt: 1, assetDid: 'did:list' }, { _id: 'L2', ownerDid: 'did:other', name: 'Other private', createdAt: 2 }],
    items: [{ _id: 'I1', listId: 'L1', name: 'Secret', checked: false, createdAt: 1, createdByDid: 'did:owner', vcProofs: [], priority: 'high' }, { _id: 'I2', listId: 'L2', name: 'Other secret', checked: false, createdAt: 1, vcProofs: [] }],
    publications: published ? [{ _id: 'P1', listId: 'L1', webvhDid: 'did:webvh:public', status: 'active' }] : [],
    agentApiKeys: [{ _id: 'K1', ownerDid: migrated ? 'did:legacy' : 'did:owner', keyHash: createHash('sha256').update('valid-key').digest('hex'), scopes: keyScopes, revokedAt }],
    accessSessions: [ownerToken,strangerToken].map((t,i) => ({_id:`S${i}`,tokenHash:createHash("sha256").update(t).digest("hex"),subject:i ? "stranger" : "owner",expiresAt:Date.now()+3600000})),
    bookmarks: [], listEnvelopes: [], subscriptions: [], referrals: [], categories: [], bitcoinAnchors: [],
  };
  let next = 1;
  const find = id => Object.values(rows).flat().find(row => row._id === id) ?? null;
  const ctx = { rows, db: {
    get: async id => find(id),
    patch: async (id, patch) => { const row = find(id); assert.ok(row, `missing ${id}`); Object.assign(row, patch); },
    insert: async (table, values) => { const row = { ...values, _id: `new${next++}` }; (rows[table] ??= []).push(row); return row._id; },
    delete: async id => { for (const table of Object.values(rows)) { const at = table.findIndex(row => row._id === id); if(at >= 0) table.splice(at,1); } },
    query: table => {
      let predicates = [];
      const q = {
        withIndex: (_index, fn) => { const b = { eq: (key,value) => { predicates.push(row => row[key] === value); return b; }, lte: (key,value) => { predicates.push(row => row[key] <= value); return b; } }; fn?.(b); return q; },
        order: () => q,
        filter: fn => { const b = { field: key => row => row[key], eq: (left,right) => row => (typeof left === 'function' ? left(row) : left) === right, or: (...ps) => row => ps.some(p => p(row)), and: (...ps) => row => ps.every(p => p(row)) }; predicates.push(fn(b)); return q; },
        collect: async () => (rows[table] ?? []).filter(row => predicates.every(p => p(row))),
        take: async count => (await q.collect()).slice(0,count),
        first: async () => (await q.collect())[0] ?? null,
        unique: async () => (await q.collect())[0] ?? null,
      }; return q;
    },
  }, scheduler: { runAfter: async () => {}, runAt: async () => {} } };
  ctx.runQuery = ctx.runMutation = async (ref,args) => { const [mod,fn] = getFunctionName(ref).split(':'); return call(mod,fn,ctx,args); };
  return ctx;
}

test('asserted owner without credentials cannot complete an item', async () => {
  const ctx = fixture();
  await assert.rejects(() => call('items','checkItem',ctx,{ itemId:'I1', checkedByDid:'did:owner', checkedAt:10 }), /auth|token/i);
  assert.equal(ctx.rows.items[0].checked,false);
});
test('forged current, legacy, and wallet identities never confer access', async () => {
  for (const field of ['checkedByDid','legacyDid','walletDid']) {
    const ctx = fixture({ migrated:true });
    await assert.rejects(() => call('items','checkItem',ctx,{ authToken:strangerToken, itemId:'I1', checkedAt:10, [field]: field === 'checkedByDid' ? 'did:owner' : 'did:legacy' }), /assertion|authorized/i);
    assert.equal(ctx.rows.items[0].checked,false);
  }
});
test('anonymous and unrelated authenticated callers cannot read private list surfaces', async () => {
  const reads = [ ['lists','getList',{listId:'L1'}], ['lists','getListEnvelope',{listId:'L1'}], ['lists','getLegacyListIds',{listIds:['L1']}], ['items','getListItems',{listId:'L1'}], ['items','getItemForSync',{itemId:'I1'}], ['items','getSubItems',{parentId:'I1'}], ['attachments','getAttachmentUrls',{itemId:'I1'}], ['activity','getListActivity',{listId:'L1'}], ['presence','getListPresence',{listId:'L1'}], ['assignees','getItemAssignees',{itemId:'I1'}], ['comments','getCommentCount',{itemId:'I1'}], ['bitcoinAnchors','getListDataForAnchor',{listId:'L1'}] ];
  for (const [mod,fn,args] of reads) for (const authToken of [undefined,strangerToken]) {
    if(fn==='getList' && authToken){assert.equal(await call(mod,fn,fixture(),{...args,authToken}),null);continue;}
    await assert.rejects(() => call(mod,fn,fixture(),{...args,authToken}), /auth|token/i, `${mod}.${fn}`);
  }
});
test('invalid signatures and expired sessions are rejected', async () => {
  for (const authToken of [await token('owner',{secret:'wrong'}), await token('owner',{exp:1})])
    await assert.rejects(() => call('lists','getUserLists',fixture(),{authToken}), /token/i);
});
test('authenticated browser and agent editing use server attribution, including migrated accounts', async () => {
  for (const migrated of [false,true]) for (const credentials of [{authToken:ownerToken},{apiKey:'valid-key'}]) {
    const ctx=fixture({migrated});
    const lists=await call('lists','getUserLists',ctx,credentials); assert.equal(lists.length,1);
    await call('items','checkItem',ctx,{...credentials,itemId:'I1',checkedAt:10});
    assert.equal(ctx.rows.items[0].checked,true); assert.equal(ctx.rows.items[0].checkedByDid,'did:owner');
    await call('items','uncheckItem',ctx,{...credentials,itemId:'I1'}); assert.equal(ctx.rows.items[0].checked,false);
  }
});
test('revoked and unknown keys fail even alongside a valid JWT', async () => {
  for(const [apiKey,revokedAt] of [['valid-key',0],['unknown',undefined]])
    await assert.rejects(() => call('items','checkItem',fixture({revokedAt}),{apiKey,authToken:ownerToken,itemId:'I1',checkedAt:10}),/API key/);
});
test('scopes apply equally to direct and internal operations, and revocation is rechecked', async () => {
  const ctx=fixture({keyScopes:['lists:read']});
  await call('lists','getUserListsInternal',ctx,{apiKey:'valid-key'});
  for(const fn of ['checkItem','checkItemInternal']) await assert.rejects(() => call('items',fn,ctx,{apiKey:'valid-key',itemId:'I1',checkedAt:10}),/Missing scope/);
  await assert.rejects(() => call('items','getListItems',ctx,{apiKey:'valid-key',listId:'L1'}),/Missing scope/);
  ctx.rows.agentApiKeys[0].revokedAt=Date.now();
  await assert.rejects(() => call('lists','getUserListsInternal',ctx,{apiKey:'valid-key'}),/API key/);
});
test('published reads remain public, shared editing requires login, and unpublishing removes access', async () => {
  const ctx=fixture({published:true});
  assert.ok(await call('publication','getPublicList',ctx,{webvhDid:'did:webvh:public'}));
  await assert.rejects(() => call('didResources','checkSharedItem',ctx,{listId:'L1',itemId:'I1'}),/Authentication/);
  await call('items','checkItem',ctx,{authToken:strangerToken,itemId:'I1',checkedAt:10});
  assert.equal(ctx.rows.items[0].checkedByDid,'did:stranger');
  await call('publication','bookmarkList',ctx,{authToken:strangerToken,listId:'L1'});
  await call('publication','unpublishList',ctx,{authToken:ownerToken,listId:'L1'});
  assert.equal(await call('publication','getPublicList',ctx,{webvhDid:'did:webvh:public'}),null);
  assert.deepEqual(await call('lists','getUserLists',ctx,{authToken:strangerToken}),[]);
  assert.deepEqual(await call('items','getHighPriorityItems',ctx,{authToken:strangerToken}),[]);
  await assert.rejects(() => call('items','uncheckItem',ctx,{authToken:strangerToken,itemId:'I1'}),/Resource unavailable/);
});
test('private resource aliases cannot bypass publication protection', async () => {
  const ctx=fixture();
  assert.equal(await call('didResources','getPublicList',ctx,{listId:'L1',ownerDid:'did:owner'}),null);
  assert.equal(await call('didResources','getListById',ctx,{listId:'L1'}),null);
  assert.deepEqual(await call('didResources','getPublicListItems',ctx,{listId:'L1'}),[]);
});
test('bookmarks remain actor-owned across unpublishing, migration, and republication', async () => {
  const ctx=fixture({published:true});
  ctx.rows.users[1].legacyDid='did:old-stranger';
  ctx.rows.bookmarks=[
    {_id:'owner-bookmark',userDid:'did:owner',listId:'L1'},
    {_id:'legacy-bookmark',userDid:'did:old-stranger',listId:'L1'},
  ];
  assert.equal(await call('publication','isBookmarked',ctx,{authToken:strangerToken,listId:'L1'}),true);
  assert.equal((await call('publication','getPublicationStatus',ctx,{authToken:strangerToken,listId:'L1'})).status,'active');
  await call('publication','unpublishList',ctx,{authToken:ownerToken,listId:'L1'});
  assert.equal(await call('publication','isBookmarked',ctx,{authToken:strangerToken,listId:'L1'}),true);
  assert.equal(await call('publication','getPublicationStatus',ctx,{authToken:strangerToken,listId:'L1'}),null);
  assert.equal(await call('publication','getPublicationStatus',ctx,{authToken:strangerToken,listId:'missing'}),null);
  assert.equal((await call('publication','getPublicationStatus',ctx,{authToken:ownerToken,listId:'L1'})).status,'unpublished');
  await assert.rejects(()=>call('items','getListItems',ctx,{authToken:strangerToken,listId:'L1'}),/Resource unavailable/);

  ctx.rows.bookmarks.push({_id:'current-bookmark',userDid:'did:stranger',listId:'L1'});
  await call('publication','unbookmarkList',ctx,{authToken:strangerToken,listId:'L1'});
  assert.deepEqual(ctx.rows.bookmarks.map(b=>b._id),['owner-bookmark']);
  assert.equal(await call('publication','isBookmarked',ctx,{authToken:strangerToken,listId:'L1'}),false);
  await call('publication','publishList',ctx,{authToken:ownerToken,listId:'L1',webvhDid:'did:webvh:public'});
  assert.equal(await call('publication','isBookmarked',ctx,{authToken:strangerToken,listId:'L1'}),false);
  assert.deepEqual(await call('lists','getUserLists',ctx,{authToken:strangerToken}),[]);
  assert.ok(await call('publication','getPublicList',ctx,{webvhDid:'did:webvh:public'}));
  await call('publication','bookmarkList',ctx,{authToken:strangerToken,listId:'L1'});
  assert.equal(await call('publication','isBookmarked',ctx,{authToken:strangerToken,listId:'L1'}),true);

  ctx.rows.lists=[];
  assert.equal(await call('publication','getPublicationStatus',ctx,{authToken:ownerToken,listId:'L1'}),null);
  await call('publication','unbookmarkList',ctx,{authToken:strangerToken,listId:'L1'});
  assert.deepEqual(ctx.rows.bookmarks.map(b=>b._id),['owner-bookmark']);
});
test('bookmark state and publication status still require authentication and scopes', async () => {
  for (const fn of ['isBookmarked','unbookmarkList','getPublicationStatus']) {
    await assert.rejects(()=>call('publication',fn,fixture(),{listId:'L1'}),/Authentication/);
    await assert.rejects(()=>call('publication',fn,fixture({keyScopes:[]}),{apiKey:'valid-key',listId:'L1'}),/Missing scope/);
    await assert.rejects(()=>call('publication',fn,fixture(),{authToken:strangerToken,userDid:'did:owner',listId:'L1'}),/assertion/);
  }
});
test('migrated owners can publish and edit categories, strangers cannot publish', async () => {
  const ctx=fixture({migrated:true});
  await assert.rejects(() => call('publication','publishList',ctx,{authToken:strangerToken,listId:'L1',webvhDid:'did:pub',publisherDid:'did:legacy'}),/assertion/);
  await call('itemCategories','addListCategory',ctx,{authToken:ownerToken,listId:'L1',name:'Travel',emoji:'🧳'});
  await call('publication','publishList',ctx,{authToken:ownerToken,listId:'L1',webvhDid:'did:pub'});
  assert.equal(ctx.rows.publications[0].publishedByDid,'did:owner');
});
test('attachment registration is authorized and bound to the target item', async () => {
  const ctx=fixture(); const args={itemId:'I1',bucketKey:'attachments/I1/file.png',contentType:'image/png',size:10,sha256:'abc'};
  await assert.rejects(() => call('attachments','addAttachment',ctx,{...args,userDid:'did:owner'}),/Authentication/);
  await assert.rejects(() => call('attachments','addAttachment',ctx,{...args,authToken:ownerToken,bucketKey:'attachments/I2/file.png'}),/key/);
  await call('attachments','addAttachment',ctx,{...args,authToken:ownerToken}); assert.equal(ctx.rows.items[0].attachments.length,1);
});
test('batch operations refuse a mixed unauthorized list before any write', async () => {
  const ctx=fixture();
  await assert.rejects(() => call('items','batchCheckItems',ctx,{authToken:ownerToken,itemIds:['I1','I2'],checkedAt:10}),/Resource unavailable/);
  assert.equal(ctx.rows.items[0].checked,false);
});
test('account and OTP storage cannot be used to forge a login or legacy link', async () => {
  const ctx=fixture();
  await assert.rejects(() => call('auth','upsertUser',ctx,{turnkeySubOrgId:'attacker',email:'attacker@example.test',legacyDid:'did:owner'}),/Authentication/);
  await assert.rejects(() => call('auth','upsertUser',ctx,{authToken:strangerToken,turnkeySubOrgId:'stranger',email:'stranger@example.test',legacyDid:'did:owner'}),/Resource unavailable/);
  await assert.rejects(() => call('authSessions','markSessionVerified',ctx,{sessionId:'stolen',subOrgId:'owner'}),/Authentication/);
  await assert.rejects(() => call('auth','getUserByTurnkeyId',ctx,{authToken:strangerToken,turnkeySubOrgId:'owner'}),/Resource unavailable/);
  assert.equal((await call('auth','getUserByTurnkeyId',ctx,{authToken:ownerToken,turnkeySubOrgId:'owner'})).did,'did:owner');
});
test('HTTP writes and reads execute the same authenticated internal boundary', async () => {
  for(const credential of [{Authorization:`Bearer ${ownerToken}`},{'X-API-Key':'valid-key'}]) {
    const ctx=fixture({migrated:true});
    const response=await modules.itemsHttp.checkItem._handler(ctx,new Request('https://test/api/items/check',{method:'POST',headers:{'Content-Type':'application/json',...credential},body:JSON.stringify({itemId:'I1',checkedByDid:'did:forged'})}));
    assert.equal(response.status,200);assert.equal(ctx.rows.items[0].checkedByDid,'did:owner');
    const read=await modules.agentReadHttp.getLists._handler(ctx,new Request('https://test/api/v1/lists',{headers:credential}));assert.equal(read.status,200);
  }
  for(const keyScopes of [[],['items:read']]) {
    const ctx=fixture({keyScopes}); const response=await modules.itemsHttp.checkItem._handler(ctx,new Request('https://test/api/items/check',{method:'POST',headers:{'X-API-Key':'valid-key'},body:JSON.stringify({itemId:'I1'})}));
    assert.equal(response.status,403);assert.equal(ctx.rows.items[0].checked,false);
  }
});

test('session logout and scheduled expiry invalidate private reads and prevent re-establishment', async () => {
  const ctx=fixture();
  await call('lists','getList',ctx,{authToken:ownerToken,listId:'L1'});
  await call('actorSession','revoke',ctx,{authToken:ownerToken});
  await assert.rejects(() => call('lists','getList',ctx,{authToken:ownerToken,listId:'L1'}),/Authentication/);
  await assert.rejects(() => call('actorSession','establish',ctx,{authToken:ownerToken}),/token/);
  ctx.rows.accessSessions[1].expiresAt=1;
  await call('actorSession','expire',ctx,{id:'S1'});
  assert.equal(ctx.rows.accessSessions.some(s=>s._id==='S1'),false);
  await assert.rejects(() => call('lists','getUserLists',ctx,{authToken:strangerToken}),/Authentication/);
});
test('existing valid JWT clients can establish a cache-aware session without asserting identity', async () => {
  const ctx=fixture();ctx.rows.accessSessions=[];
  await assert.rejects(() => call('lists','getUserLists',ctx,{authToken:ownerToken}),/restore your session/);
  await call('actorSession','establish',ctx,{authToken:ownerToken});
  assert.equal((await call('lists','getUserLists',ctx,{authToken:ownerToken})).length,1);
  assert.equal(ctx.rows.accessSessions[0].subject,'owner');
});

test('attachment capabilities reject forged callers and cross-item removal before storage access', async () => {
  const ctx=fixture();ctx.rows.items[0].attachments=[{key:'attachments/I1/file.png',contentType:'image/png',size:10,sha256:'abc'}];
  const actionCtx={runQuery:ctx.runQuery,runMutation:ctx.runMutation};
  await assert.rejects(() => call('attachments','generateUploadUrl',actionCtx,{itemId:'I1',userDid:'did:owner',contentType:'image/png',byteLength:10}),/Authentication/);
  await assert.rejects(() => call('attachments','generateUploadUrl',actionCtx,{authToken:strangerToken,itemId:'I1',contentType:'image/png',byteLength:10}),/Resource unavailable/);
  await assert.rejects(() => call('attachments','removeAttachment',actionCtx,{authToken:ownerToken,itemId:'I1',bucketKey:'attachments/I2/file.png'}),/Attachment not found/);
});
test('agent combined read preserves indistinguishable missing/private responses', async () => {
  const ctx=fixture();
  for (const listId of ['L2','missing']) {
    const response=await modules.agentReadHttp.getListWithItems._handler(ctx,new Request(`https://test/api/v1/lists/items?listId=${listId}`,{headers:{'X-API-Key':'valid-key'}}));
    assert.equal(response.status,404);
  }
});

test('missing parents and deleted lists never authorize retained private data', async()=>{
  const ctx=fixture();ctx.rows.items.push({_id:'child',listId:'L1',parentId:'I1',name:'Private child'});
  await call('items','removeItem',ctx,{authToken:ownerToken,itemId:'I1'});
  await assert.rejects(()=>call('items','getSubItems',ctx,{authToken:strangerToken,parentId:'I1'}),/Resource unavailable/);
  ctx.rows.activities=[{_id:'A1',listId:'L1',metadata:{note:'Private note'}}];
  ctx.rows.bitcoinAnchors=[{_id:'B1',listId:'L1',status:'pending',stateSnapshot:'Private snapshot'}];
  await call('lists','deleteList',ctx,{authToken:ownerToken,listId:'L1'});
  await assert.rejects(()=>call('activity','getListActivity',ctx,{authToken:strangerToken,listId:'L1'}),/Resource unavailable/);
  assert.deepEqual(await call('bitcoinAnchors','getPendingAnchors',ctx,{authToken:strangerToken}),[]);
  assert.equal(await call('lists','getList',ctx,{authToken:ownerToken,listId:'L1'}),null);
  await assert.rejects(()=>call('items','getItemForSync',ctx,{authToken:ownerToken,itemId:'I1'}),/Resource unavailable/);
});

test('site publication and signing actions reject forged owner and signing identities', async()=>{
  const ctx=fixture();const actionCtx={runQuery:ctx.runQuery,runMutation:ctx.runMutation};
  ctx.rows.sites=[{_id:'site1',ownerDid:'did:owner'}];
  for (const name of ['replaceSiteFile','migrateVerifiedCustomDomain','requestCustomHostname']) {
    await assert.rejects(()=>call('siteActions',name,actionCtx,{authToken:strangerToken,ownerDid:'did:owner',siteId:'site1',bucketKey:'known',hostname:'example.test'}),/assertion/);
  }
  await assert.rejects(()=>call('siteActions','replaceSiteFile',actionCtx,{authToken:strangerToken,siteId:'site1',bucketKey:'known'}),/not found/i);
  await assert.rejects(()=>call('siteActions','createSiteFromUpload',actionCtx,{authToken:ownerToken,bucketKey:'attachments/I2/private.html'}),/upload key/i);
  await assert.rejects(()=>call('didCreation','createListDID',actionCtx,{authToken:strangerToken,subOrgId:'owner',domain:'example.test',slug:'list'}),/signing identity/i);
});
test('account-id callers cannot bypass the authenticated boundary through billing, referrals or feedback', async()=>{
  for(const [mod,fn] of [['billing','getUserPlan'],['referrals','getReferralCode'],['feedback','submit']]) {
    await assert.rejects(()=>call(mod,fn,fixture(),{authToken:strangerToken,userId:'U1',body:'Forged',category:'bug'}),/Resource unavailable/);
    await assert.rejects(()=>call(mod,fn,fixture(),{userId:'U1',body:'Forged',category:'bug'}),/Authentication/);
  }
});

test('upload references cannot traverse from an authorized prefix into private objects', async()=>{
  const ctx=fixture(), actionCtx={runQuery:ctx.runQuery,runMutation:ctx.runMutation};
  for (const suffix of ['../../attachments/I2/private.html','../victim.html','x/../../../private.html']) {
    await assert.rejects(()=>call('siteActions','createSiteFromUpload',actionCtx,{authToken:ownerToken,bucketKey:`siteFiles/${encodeURIComponent('did:owner')}/${suffix}`}),/upload key/);
    await assert.rejects(()=>call('attachments','addAttachment',ctx,{authToken:ownerToken,itemId:'I1',bucketKey:`attachments/I1/${suffix}`,contentType:'image/png',size:10,sha256:'abc'}),/attachment key/);
  }
  assert.equal(ctx.rows.items[0].attachments,undefined);
});
test('referral redemption binds the referee account to the authenticated user',async()=>{
  await assert.rejects(()=>call('referrals','redeemReferral',fixture(),{authToken:strangerToken,refereeUserId:'U1',code:'known'}),/Resource unavailable/);
  assert.deepEqual(await call('referrals','redeemReferral',fixture(),{authToken:ownerToken,refereeUserId:'U1',code:'invalid'}),{success:false,reason:'invalid_code'});
});

test('migrated accounts retain their saved categories, templates, sites, and push subscriptions', async()=>{
  const ctx=fixture({migrated:true});
  ctx.rows.categories=[{_id:'C1',ownerDid:'did:legacy',name:'Saved',order:1}];
  ctx.rows.listTemplates=[{_id:'T1',ownerDid:'did:legacy',name:'Saved',items:[]}];
  ctx.rows.sites=[{_id:'site1',ownerDid:'did:legacy'}];
  ctx.rows.pushTokens=[{_id:'push1',userDid:'did:legacy',token:'old-device'}];
  for(const [mod,fn] of [['categories','getUserCategories'],['templates','getUserTemplates'],['sites','listSites'],['notifications','getUserSubscriptions']]) {
    assert.equal((await call(mod,fn,ctx,{authToken:ownerToken})).length,1);
    assert.equal((await call(mod,fn,ctx,{authToken:strangerToken})).length,0);
  }
  await call('categories','renameCategory',ctx,{authToken:ownerToken,categoryId:'C1',name:'Renamed'});
  assert.equal(ctx.rows.categories[0].name,'Renamed');
  await call('notifications','unregisterPushToken',ctx,{authToken:ownerToken,token:'old-device'});
  assert.equal(ctx.rows.pushTokens.length,0);
});

test('session establishment is idempotent and premature or missing expiry callbacks are harmless',async()=>{
  const ctx=fixture(),count=ctx.rows.accessSessions.length;
  await call('actorSession','establish',ctx,{authToken:ownerToken});
  await call('actorSession','establish',ctx,{authToken:ownerToken});
  assert.equal(ctx.rows.accessSessions.length,count);
  await call('actorSession','expire',ctx,{id:'S0'});
  await call('actorSession','expire',ctx,{id:'missing'});
  assert.equal(ctx.rows.accessSessions.length,count);
  assert.equal((await call('lists','getUserLists',ctx,{authToken:ownerToken})).length,1);
});
test('session cleanup is bounded and preserves live sessions and unexpired revocation tombstones',async()=>{
  const ctx=fixture();
  await call('actorSession','revoke',ctx,{authToken:strangerToken});
  const expiresAt=Date.now()-1000;
  ctx.rows.accessSessions.push(...Array.from({length:105},(_,i)=>({
    _id:`expired${i}`,tokenHash:`expired-hash-${i}`,subject:'owner',expiresAt,
    ...(i%2===0?{revokedAt:expiresAt-1000}:{}),
  })));
  assert.equal(await call('actorSession','cleanupExpiredSessions',ctx,{}),100);
  assert.equal(ctx.rows.accessSessions.filter(s=>s.expiresAt===expiresAt).length,5);
  assert.equal(ctx.rows.accessSessions.some(s=>s._id==='S0'),true);
  assert.equal(ctx.rows.accessSessions.some(s=>s._id==='S1'&&s.revokedAt!==undefined),true);
  await assert.rejects(()=>call('actorSession','establish',ctx,{authToken:strangerToken}),/token/);
  assert.equal((await call('lists','getUserLists',ctx,{authToken:ownerToken})).length,1);
  assert.equal(await call('actorSession','cleanupExpiredSessions',ctx,{}),5);
  assert.equal(await call('actorSession','cleanupExpiredSessions',ctx,{}),0);
  assert.deepEqual(ctx.rows.accessSessions.map(s=>s._id),['S0','S1']);
});

// Production strips ordinary Error messages; authorization data must survive RPC.
test('private resource denials preserve structured authorization data across RPC', async () => {
  for (const [module, name, args] of [
    ['items','getItemForSync',{itemId:'I1'}],
    ['items','checkItem',{itemId:'I1',checkedAt:10}],
    ['lists','renameList',{listId:'L1',name:'Renamed'}],
    ['lists','deleteList',{listId:'L1'}],
  ]) {
    const ctx=fixture({published:name==='renameList'||name==='deleteList'});
    await assert.rejects(() => call(module,name,ctx,{...args,authToken:strangerToken}), error => {
      assert.ok(error instanceof ConvexError);
      const received=new ConvexError(jsonToConvex(convexToJson(error.data)));
      assert.equal(received.data.kind,'auth');assert.equal(received.data.code,'FORBIDDEN');
      assert.equal(received.data.message,"Resource unavailable");return true;
    });
  }
});

test('missing and inaccessible resources have identical production RPC responses', async () => {
  for (const [module,name,field,existing,extra] of [
    ['items','getItemForSync','itemId','I1',{}],
    ['items','checkItem','itemId','I1',{checkedAt:10}],
    ['items','getListItems','listId','L1',{}],
  ]) {
    const data=[];
    for (const id of [existing,'missing']) {
      await assert.rejects(()=>call(module,name,fixture(),{authToken:strangerToken,[field]:id,...extra}),error=>{
        assert.ok(error instanceof ConvexError);
        data.push(jsonToConvex(convexToJson(error.data)));return true;
      });
    }
    assert.deepEqual(data[0],data[1]);
    assert.deepEqual(data[0],{kind:'auth',code:'FORBIDDEN',message:'Resource unavailable'});
  }
});

test('single-list reads return the same empty result for missing and inaccessible lists',async()=>{
  for(const listId of ['L1','missing'])assert.equal(await call('lists','getList',fixture(),{authToken:strangerToken,listId}),null);
});
