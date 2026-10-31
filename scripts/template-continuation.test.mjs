import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

await mkdir('tmp/template-continuation-test', {recursive:true});
await build({entryPoints:['src/lib/templateActivation.ts'],outfile:'tmp/template-continuation-test/activation.mjs',bundle:true,platform:'node',format:'esm'});
const {templateCreationKey,finishTemplateAttempt} = await import(pathToFileURL(`${process.cwd()}/tmp/template-continuation-test/activation.mjs`));
if (!globalThis.sessionStorage) {
  const storage = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', {configurable:true,value:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),clear:()=>storage.clear()}});
}
const values = sessionStorage;
test('pending attempts survive explicit retry and refresh, completed uses can start anew',()=>{
  values.clear();
  const first = templateCreationKey('owner','release',true);
  assert.equal(typeof first, 'string');
  assert.equal(templateCreationKey('owner','release',true),first);
  assert.equal(templateCreationKey('owner','release'),first);
  finishTemplateAttempt('owner','release');
  assert.equal(templateCreationKey('owner','release'),first, 'a refresh after success returns the same list');
  assert.notEqual(templateCreationKey('owner','release',true),first, 'an explicit new use gets a new list');
});
test('account and template changes cannot reuse another attempt',()=>{
  values.clear();
  const a = templateCreationKey('a','release');
  assert.equal(templateCreationKey('a','release'),a);
  assert.notEqual(templateCreationKey('b','release'),a);
  assert.notEqual(templateCreationKey('a','research'),a);
});
test('corrupt saved state is replaced, never reused',()=>{
  values.clear();
  values.setItem('boop:template-attempt:a:release','{not json');
  const key = templateCreationKey('a','release');
  assert.equal(typeof key, 'string');
  assert.equal(templateCreationKey('a','release'),key);
});
