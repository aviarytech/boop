import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

await mkdir('tmp/template-continuation-test', {recursive:true});
await build({entryPoints:['src/lib/templateActivation.ts'],outfile:'tmp/template-continuation-test/activation.mjs',bundle:true,platform:'node',format:'esm',plugins:[{
  name:'isolated-genesis',setup(b) { b.onResolve({filter:/^\.\/originals$/},()=>({path:'genesis',namespace:'fixture'})); b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'let n=0; export async function createListAsset(name,did) { return {assetDid:`did:cel:${did}:${++n}`,envelope:JSON.stringify({name,did})}; }'})); }
}]});
const {templateAsset,finishTemplateAttempt} = await import(pathToFileURL(`${process.cwd()}/tmp/template-continuation-test/activation.mjs`));
if (!globalThis.sessionStorage) {
  const storage = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', {configurable:true,value:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),clear:()=>storage.clear()}});
}
const values = sessionStorage;
test('pending attempts survive explicit retry and refresh, completed uses can start anew',async()=>{
  values.clear();
  const first = await templateAsset('owner','release','Release',true);
  assert.deepEqual(await templateAsset('owner','release','Release',true),first);
  assert.deepEqual(await templateAsset('owner','release','Release'),first);
  finishTemplateAttempt('owner','release');
  assert.equal((await templateAsset('owner','release','Release')).assetDid,first.assetDid);
  assert.notEqual((await templateAsset('owner','release','Release',true)).assetDid,first.assetDid);
});
test('account and template changes cannot reuse another attempt; concurrent genesis is deduplicated',async()=>{
  values.clear();
  const [a,b] = await Promise.all([templateAsset('a','release','Release'),templateAsset('a','release','Release')]);
  assert.deepEqual(a,b);
  assert.notEqual((await templateAsset('b','release','Release')).assetDid,a.assetDid);
  assert.notEqual((await templateAsset('a','research','Research')).assetDid,a.assetDid);
});
