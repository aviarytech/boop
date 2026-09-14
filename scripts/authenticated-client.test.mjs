import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const { renderHook, cleanup } = await import('@testing-library/react');
const { makeFunctionReference } = await import('convex/server');
const state = globalThis.__authAdapterTest = { token: null, calls: [] };
await build({entryPoints:['src/lib/authenticatedConvex.ts'],outfile:'tmp/authenticated-client-test.mjs',bundle:true,platform:'node',format:'esm',external:['react','convex/server'],plugins:[{
  name:'hook-fixtures', setup(b) {
    b.onResolve({filter:/convex\/react$/},()=>({path:'convex-react',namespace:'fixture'}));
    b.onResolve({filter:/hooks\/useAuth$/},()=>({path:'auth',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='auth' ? `export function useAuth(){return globalThis.__authAdapterTest}` : `
      export function useQuery(ref,args){globalThis.__authAdapterTest.calls.push({ref,args});return args==='skip'?undefined:args;}
      function mutation(ref){const fn=async args=>{globalThis.__authAdapterTest.calls.push({ref,args});return args;};fn.withOptimisticUpdate=()=>mutation(ref);return fn;}
      export const useMutation=mutation;export const useAction=mutation;
    `}));
  }
}]});
const hooks=await import(pathToFileURL(`${process.cwd()}/tmp/authenticated-client-test.mjs`));
const privateQuery=makeFunctionReference('lists:getList'),publicQuery=makeFunctionReference('publication:getPublicList'),write=makeFunctionReference('items:checkItem');

test('login, account changes and logout update query credentials and skip private subscriptions',()=>{
  state.token=null;state.calls=[];
  const {result,rerender,unmount}=renderHook(()=>hooks.useQuery(privateQuery,{listId:'L1',userDid:'did:forged',legacyDid:'did:forged'}));
  assert.equal(result.current,undefined);
  state.token='session-A';rerender();assert.deepEqual(result.current,{listId:'L1',authToken:'session-A'});
  state.token='session-B';rerender();assert.deepEqual(result.current,{listId:'L1',authToken:'session-B'});
  state.token=null;rerender();assert.equal(result.current,undefined);assert.equal(state.calls.at(-1).args,'skip');unmount();cleanup();
});
test('public reads remain available without a session',()=>{
  state.token=null;
  const {result,unmount}=renderHook(()=>hooks.useQuery(publicQuery,{webvhDid:'did:public'}));
  assert.deepEqual(result.current,{webvhDid:'did:public'});unmount();cleanup();
});
test('writes and actions carry session credentials and omit identity assertions',async()=>{
  state.token='session-A';
  const {result,rerender,unmount}=renderHook(()=>({write:hooks.useMutation(write),upload:hooks.useAction(makeFunctionReference('attachments:generateUploadUrl'))}));
  assert.deepEqual(await result.current.write({itemId:'I1',checkedByDid:'did:forged'}),{itemId:'I1',authToken:'session-A'});
  assert.deepEqual(await result.current.upload({itemId:'I1',contentType:'image/png',byteLength:10,userDid:'did:forged'}),{itemId:'I1',contentType:'image/png',byteLength:10,authToken:'session-A'});
  assert.deepEqual(await result.current.write.withOptimisticUpdate(()=>{})({itemId:'I1'}),{itemId:'I1',authToken:'session-A'});
  state.token=null;rerender();await assert.rejects(async()=>result.current.write({itemId:'I1'}),/Sign in/);unmount();cleanup();
});
test('generated client registry matches authenticated server registrations',()=>{
  execFileSync(process.execPath,['scripts/generate-auth-client.mjs','--check']);
});

await build({entryPoints:['src/lib/sessionExpiry.ts'],outfile:'tmp/session-expiry-test.mjs',bundle:true,platform:'node',format:'esm'});
const {onSessionExpiry}=await import(pathToFileURL(`${process.cwd()}/tmp/session-expiry-test.mjs`));
test('30-day sessions expire at their deadline, not on timer overflow, and cancelled timers stay cancelled', () => {
  const originalNow = Date.now, originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  let now = 0, next = 0, expired = 0;
  const timers = new Map();
  Date.now = () => now;
  globalThis.setTimeout = (fn, delay) => { const id = ++next; timers.set(id, {fn, at: now + delay}); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  const tick = ms => {
    const end = now + ms;
    for (;;) {
      const entry = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
      if (!entry) break;
      now = entry[1].at; timers.delete(entry[0]); entry[1].fn();
    }
    now = end;
  };
  try {
    const lifetime = 30*24*60*60*1000;
    const cancel = onSessionExpiry(lifetime, () => expired++);
    tick(2_147_483_647); assert.equal(expired, 0);
    tick(lifetime-2_147_483_647-1); assert.equal(expired, 0);
    tick(1); assert.equal(expired, 1); cancel();
    const stop = onSessionExpiry(Date.now()+100, () => expired++); stop();
    tick(100); assert.equal(expired, 1);
  } finally {
    Date.now = originalNow; globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear;
  }
});
