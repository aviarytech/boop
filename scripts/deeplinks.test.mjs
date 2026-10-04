import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
const state = globalThis.__deepLinkFixture = { native: true, listeners: {} };
await build({entryPoints:['src/lib/deeplinks.ts'],outfile:'tmp/deeplinks.mjs',bundle:true,format:'esm',platform:'node',plugins:[{name:'capacitor-fixture',setup(b){
  b.onResolve({filter:/^@capacitor\//},({path})=>({path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path.endsWith('/core')?'export const Capacitor={isNativePlatform:()=>globalThis.__deepLinkFixture.native};':`export const App={addListener:async(name,fn)=>{globalThis.__deepLinkFixture.listeners[name]=fn},getLaunchUrl:async()=>({url:globalThis.__deepLinkFixture.launch}),exitApp:()=>{}};`}));
}}]});
const { initDeepLinks } = await import(pathToFileURL(`${process.cwd()}/tmp/deeplinks.mjs`));
test('native invitation cold and warm links preserve continuation and reject foreign or malformed URLs',async()=>{
  state.launch='https://boop.ad/invitations/abc/1?continue=review#accept';const paths=[];
  await initDeepLinks(path=>paths.push(path));
  assert.deepEqual(paths,['/invitations/abc/1?continue=review#accept']);
  state.listeners.appUrlOpen({url:'https://boop.ad/invitations/abc/2'});
  state.listeners.appUrlOpen({url:'https://attacker.test/invitations/abc/3'});
  state.listeners.appUrlOpen({url:'not a URL'});
  assert.deepEqual(paths,['/invitations/abc/1?continue=review#accept','/invitations/abc/2']);
});
test('web fallback never invokes native navigation',async()=>{
  state.native=false;await initDeepLinks(()=>assert.fail('unexpected native navigation'));
});
