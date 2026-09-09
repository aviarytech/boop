import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const { renderHook, cleanup, act } = await import('@testing-library/react');
const state = globalThis.__authProviderTest = { storage: new Map(), establish: async () => {} };
state.convex = { mutation: (...args) => state.establish(...args) };
await build({entryPoints:['src/hooks/useAuth.tsx'],outfile:'tmp/auth-provider-test.mjs',bundle:true,jsx:'automatic',platform:'node',format:'esm',external:['react','react/jsx-runtime','convex/server'],plugins:[{
  name:'auth-provider-fixtures', setup(b) {
    b.onResolve({filter:/^(convex\/react|\.\.?\/.*(storageAdapter|webvh|useDidDomainRemint|convexUrls|analytics))$/}, args=>({path:args.path.split('/').at(-1),namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:({
      react:'export function useConvex(){return globalThis.__authProviderTest.convex;}',
      storageAdapter:'export const storageAdapter={get:async k=>globalThis.__authProviderTest.storage.get(k)??null,set:async(k,v)=>globalThis.__authProviderTest.storage.set(k,v),remove:async k=>globalThis.__authProviderTest.storage.delete(k)};',
      webvh:'export const createUserWebVHDid=async()=>{throw new Error("Unexpected DID creation")};',
      useDidDomainRemint:'export const useDidDomainRemint=()=>{};',
      convexUrls:'export const getConvexHttpUrl=()=>"https://auth.example.test";',
      analytics:'export const identifyUser=()=>{};export const resetAnalytics=()=>{};',
    })[path]}));
  }
}]});
const {AuthProvider,useAuth}=await import(pathToFileURL(`${process.cwd()}/tmp/auth-provider-test.mjs`));
const user={turnkeySubOrgId:'owner',email:'owner@example.test',did:'did:webvh:owner',displayName:'Owner'};
const token=`header.${btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+30*86400}))}.signature`;
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const flush=()=>act(async()=>{await Promise.resolve();});
const fetchBefore=globalThis.fetch;
afterEach(()=>{cleanup();globalThis.fetch=fetchBefore;state.storage.clear();state.establish=async()=>{};});
function seed(){state.storage.set('lisa-auth-state',JSON.stringify({user,token}));state.storage.set('lisa-jwt-token',token);}

test('restore exposes credentials only after the server accepts the session',async()=>{
  seed();const pending=deferred();state.establish=()=>pending.promise;
  const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider});await flush();
  assert.equal(result.current.token,null);assert.equal(result.current.isLoading,true);
  await act(async()=>pending.resolve());assert.equal(result.current.token,token);assert.equal(result.current.isAuthenticated,true);assert.equal(result.current.isLoading,false);
});
test('failed restore removes persisted credentials and leaves private queries signed out',async()=>{
  seed();state.establish=async()=>{throw new Error('revoked session')};
  const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider});await flush();
  assert.equal(result.current.token,null);assert.equal(result.current.isAuthenticated,false);assert.equal(result.current.isLoading,false);assert.equal(state.storage.size,0);
});
test('OTP cannot persist or expose a token when session establishment fails',async()=>{
  globalThis.fetch=async url=>Response.json(url.endsWith('/auth/initiate')?{sessionId:'otp-session'}:{user,token});
  const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider});await flush();
  await act(async()=>result.current.startOtp(user.email));
  state.establish=async()=>{throw new Error('session rejected')};
  await act(async()=>assert.rejects(()=>result.current.verifyOtp('123456'),/session rejected/));
  assert.equal(result.current.token,null);assert.equal(result.current.isAuthenticated,false);assert.equal(state.storage.size,0);
});
test('logout drops credentials immediately and serializes the next login until its response settles',async()=>{
  seed();const pending=deferred();let logoutRequest;
  globalThis.fetch=async(url,options)=>{logoutRequest={url,options};return pending.promise;};
  const {result}=renderHook(()=>useAuth(),{wrapper:AuthProvider});await flush();
  let logout;await act(async()=>{logout=result.current.logout();await Promise.resolve();});
  assert.equal(result.current.token,null);assert.equal(result.current.isAuthenticated,false);assert.equal(result.current.isLoading,true);assert.equal(state.storage.size,0);
  assert.equal(logoutRequest.options.headers.Authorization,`Bearer ${token}`);
  await assert.rejects(()=>result.current.startOtp(user.email),/already in progress/);
  await act(async()=>{pending.resolve(new Response(null,{status:204}));await logout;});assert.equal(result.current.isLoading,false);
  globalThis.fetch=async()=>Response.json({sessionId:'new-otp'});
  await act(async()=>result.current.startOtp(user.email));
});

test('the mounted provider expires a long session at its deadline and clears persisted credentials',async()=>{
  seed();
  const originalNow=Date.now, originalSet=globalThis.setTimeout, originalClear=globalThis.clearTimeout;
  let now=Date.now(),next=0;const timers=new Map();
  Date.now=()=>now;
  globalThis.setTimeout=(fn,delay,...args)=>{
    if(delay>100000){const id={expiryTimer:++next};timers.set(id,{fn,at:now+delay});return id;}
    return originalSet(fn,delay,...args);
  };
  globalThis.clearTimeout=id=>{if(!timers.delete(id))originalClear(id);};
  try {
    const {result,unmount}=renderHook(()=>useAuth(),{wrapper:AuthProvider});await flush();
    assert.equal(result.current.token,token);
    const fireNext=async()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);now=timer.at;await act(async()=>timer.fn());};
    await fireNext();assert.equal(result.current.token,token);
    await fireNext();assert.equal(result.current.token,null);assert.equal(result.current.isAuthenticated,false);assert.equal(state.storage.size,0);
    unmount();
  } finally {Date.now=originalNow;globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});
