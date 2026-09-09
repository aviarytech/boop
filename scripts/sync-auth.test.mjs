import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { ConvexError, convexToJson, jsonToConvex } from 'convex/values';
const state = globalThis.__syncAuthTest = { queue: [], toasts: [] };
await build({ entryPoints: ['src/lib/sync.ts', 'convex/lib/authError.ts', 'convex/lib/httpResponses.ts'], outdir: 'tmp/sync-auth', outbase: '.', bundle: true, platform: 'node', format: 'esm', outExtension: {'.js': '.mjs'}, external: ['convex/values', 'convex/server'], plugins: [{name: 'sync-fixtures', setup(b) {
  b.onResolve({filter: /^\.\/(offline|storageAdapter|toast)$/}, a => ({path: a.path.slice(2), namespace: 'fixture'}));
  b.onLoad({filter: /.*/, namespace: 'fixture'}, ({path}) => ({contents: {
    offline: 'const s=globalThis.__syncAuthTest; export const getQueuedMutations=async()=>[...s.queue]; export const clearMutation=async id=>{s.queue=s.queue.filter(m=>m.id!==id)}; export const updateMutationRetry=async()=>{throw new Error("Auth must not consume retries")};',
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
test('legacy missing-user errors pause sync; actual missing items are discarded',async()=>{
  seed('removeItem');const manager=new SyncManager();
  await manager.sync({mutation:async()=>{throw new Error('User not found')}});
  assert.equal(state.queue.length,2);assert.ok(!state.toasts.some(([m])=>m.includes('deleted')));
  await manager.sync({mutation:async()=>{throw new Error('Item not found')}});
  assert.equal(state.queue.length,0);assert.ok(state.toasts.some(([m])=>m.includes('deleted')));
});
test('HTTP recognizes serialized authentication errors without matching their prose',()=>{
  const request=new Request('https://example.test');
  for(const code of ['UNAUTHORIZED','INVALID_TOKEN','EXPIRED_TOKEN'])assert.equal(handlerErrorResponse(request,wireError(code),'Failed').status,401);
  assert.equal(handlerErrorResponse(request,new Error('Missing scope: write'),'Failed').status,403);
  const denied=new ConvexError(jsonToConvex(convexToJson(new AuthError('Only the list owner can rename this list','UNAUTHORIZED').data)));
  assert.equal(handlerErrorResponse(request,denied,'Failed').status,403);
});
