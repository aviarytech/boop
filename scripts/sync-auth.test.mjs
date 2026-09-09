import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { ConvexError, convexToJson, jsonToConvex } from 'convex/values';
const state = globalThis.__syncAuthTest = { queue: [], toasts: [] };
await build({ entryPoints: ['src/lib/sync.ts', 'convex/lib/authError.ts', 'convex/lib/httpResponses.ts'], outdir: 'tmp/sync-auth', outbase: '.', bundle: true, platform: 'node', format: 'esm', outExtension: {'.js': '.mjs'}, external: ['convex/values', 'convex/server'], plugins: [{name: 'sync-fixtures', setup(b) {
  b.onResolve({filter: /^\.\/(offline|storageAdapter|toast)$/}, a => ({path: a.path.slice(2), namespace: 'fixture'}));
  b.onLoad({filter: /.*/, namespace: 'fixture'}, ({path}) => ({contents: {
    offline: 'const s=globalThis.__syncAuthTest; export const getQueuedMutations=async()=>structuredClone(s.queue); export const clearMutation=async id=>{s.queue=s.queue.filter(m=>m.id!==id)}; export const updateMutationRetry=async(id,retryCount)=>{s.queue.find(m=>m.id===id).retryCount=retryCount};',
    storageAdapter: 'export const storageAdapter={get:async()=>"session-token"};',
    toast: 'export const showGlobalToast=(...args)=>globalThis.__syncAuthTest.toasts.push(args);',
  }[path]}));
}}]});
const load = p => import(pathToFileURL(`${process.cwd()}/tmp/sync-auth/${p}.mjs`));
const {SyncManager} = await load('src/lib/sync');
const {AuthError} = await load('convex/lib/authError');
const {handlerErrorResponse} = await load('convex/lib/httpResponses');
const wireError = code => new ConvexError(jsonToConvex(convexToJson(new AuthError('Account unavailable', code).data)));
function seed(type='checkItem') {
  state.queue = [1,2].map(id=>({id,type,payload:{itemId:`item-${id}`,checkedByDid:'did:owner'},timestamp:10,retryCount:5}));
  state.toasts=[];
}
for (const phase of ['query','mutation']) for (const code of ['UNAUTHORIZED','INVALID_TOKEN','EXPIRED_TOKEN']) {
  test(`${phase} ${code} across RPC preserves queued edits and resumes after login`, async()=>{
    seed(); const manager=new SyncManager(); const statuses=[];manager.subscribe(s=>statuses.push(s));
    let reject=true;
    const client={query:async()=>{if(reject&&phase==='query')throw wireError(code);return {updatedAt:1}},mutation:async()=>{if(reject&&phase==='mutation')throw wireError(code)}};
    await manager.sync(client);
    assert.equal(state.queue.length,2);assert.ok(state.queue.every(m=>m.retryCount===5));
    assert.equal(statuses.at(-1).status,'error');assert.equal(manager.syncing,false);
    assert.match(state.toasts[0][0],/changes are still saved/);assert.ok(!state.toasts.some(([m])=>m.includes('deleted')));
    reject=false;await manager.sync(client);assert.equal(state.queue.length,0);assert.equal(statuses.at(-1).status,'synced');
  });
}
test('legacy missing-user errors pause sync without discarding queued edits',async()=>{
  seed('removeItem');const manager=new SyncManager();
  await manager.sync({mutation:async()=>{throw new Error('User not found')}});
  assert.equal(state.queue.length,2);assert.ok(!state.toasts.some(([m])=>m.includes('deleted')));
  assert.ok(state.queue.every(m=>m.retryCount===5));
});
test('HTTP recognizes serialized authentication errors without matching their prose',()=>{
  const request=new Request('https://example.test');
  for(const code of ['UNAUTHORIZED','INVALID_TOKEN','EXPIRED_TOKEN'])assert.equal(handlerErrorResponse(request,wireError(code),'Failed').status,401);
  assert.equal(handlerErrorResponse(request,new Error('Missing scope: write'),'Failed').status,403);
  const denied=new ConvexError(jsonToConvex(convexToJson(new AuthError('Resource unavailable','FORBIDDEN').data)));
  assert.equal(handlerErrorResponse(request,denied,'Failed').status,403);
});

for(const phase of ['query','mutation']) {
  test(`structured ${phase} missing-or-denied error backs off, progresses later edits, and exhausts only its own retry budget`,async()=>{
    seed();state.queue.forEach(m=>m.retryCount=0);
    const manager=new SyncManager();const statuses=[];manager.subscribe(s=>statuses.push(s));
    const delays=[];manager.delay=async ms=>{delays.push(ms)};
    const applied=[];
    const client={
      query:async(_ref,args)=>{if(phase==='query'&&args.itemId==='item-1')throw wireError('FORBIDDEN');return {updatedAt:1}},
      mutation:async(_ref,args)=>{if(args.itemId==='item-1')throw wireError('FORBIDDEN');applied.push(args.itemId)},
    };
    await manager.sync(client);
    assert.deepEqual(applied,['item-2']);assert.equal(state.queue.length,1);assert.equal(state.queue[0].retryCount,1);
    assert.equal(statuses.at(-1).status,'error');
    for(let attempt=1;attempt<=5;attempt++) {
      // New authorized edits must progress even when the denied operation never recovers.
      state.queue.push({id:attempt+2,type:'checkItem',payload:{itemId:`healthy-${attempt}`},timestamp:10,retryCount:0});
      await manager.sync(client);
      assert.ok(applied.includes(`healthy-${attempt}`));
    }
    assert.equal(state.queue.length,0);assert.equal(manager.syncing,false);
    assert.deepEqual(delays,[1000,2000,4000,8000,16000]);
    assert.equal(statuses.at(-1).status,'error');assert.match(statuses.at(-1).message,/discarded/);
    assert.ok(state.toasts.every(([m])=>m.includes('may have been removed or access is unavailable')));
    assert.ok(!state.toasts.some(([m])=>/Sign in|deleted by another/.test(m)));
  });
}
test('temporary resource denial can recover before exhausting its retry budget',async()=>{
  seed();state.queue.forEach(m=>m.retryCount=0);const manager=new SyncManager();
  const delays=[];manager.delay=async ms=>{delays.push(ms)};
  await manager.sync({query:async()=>{throw wireError('FORBIDDEN')}});
  assert.equal(state.queue.length,2);assert.ok(state.queue.every(m=>m.retryCount===1));
  assert.deepEqual(delays,[1000,1000]);
  await manager.sync({query:async()=>({updatedAt:1}),mutation:async()=>{}});
  assert.equal(state.queue.length,0);
});

test('rapid sync attempts do not consume retries while a denial is backing off',async()=>{
  seed();state.queue.forEach(m=>m.retryCount=0);
  const manager=new SyncManager();const applied=[];const delays=[];
  let releaseDelay;let delayStarted;
  const waiting=new Promise(resolve=>{delayStarted=resolve});
  manager.delay=ms=>{delays.push(ms);delayStarted();return new Promise(resolve=>{releaseDelay=resolve})};
  const client={
    query:async(_ref,args)=>{if(args.itemId==='item-1')throw wireError('FORBIDDEN');return {updatedAt:1}},
    mutation:async(_ref,args)=>{applied.push(args.itemId)},
  };
  const firstSync=manager.sync(client);
  await waiting;
  await manager.sync(client);await manager.sync(client);
  assert.equal(state.queue[0].retryCount,1);assert.deepEqual(delays,[1000]);
  assert.equal(manager.syncing,true);
  releaseDelay();await firstSync;
  assert.deepEqual(applied,['item-2']);assert.equal(state.queue.length,1);
  assert.equal(manager.syncing,false);
});
