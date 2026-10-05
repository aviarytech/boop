import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import React, { useEffect } from 'react';
import { render, act, cleanup } from '@testing-library/react';

if (!globalThis.document) {
  const { GlobalRegistrator } = await import('@happy-dom/global-registrator');
  GlobalRegistrator.register({url:'http://localhost/'});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
}
await mkdir('tmp/template-app-lock-test', {recursive:true});
await build({entryPoints:['src/components/AppLockGuard.tsx'],outfile:'tmp/template-app-lock-test/guard.mjs',bundle:true,jsx:'automatic',platform:'node',format:'esm',external:['react','react/*'],plugins:[{
  name:'lock-fixture',setup(b) {
    b.onResolve({filter:/\/lib\/(storage|biometrics)$/},args=>({path:args.path,namespace:'lock-fixture'}));
    b.onLoad({filter:/.*/,namespace:'lock-fixture'},args=>({contents:args.path.endsWith('storage')?'export const getBiometricLockEnabled = () => globalThis.__templateLockSettings();':'export const biometrics = {authenticate: () => globalThis.__templateLockAuthenticate()};'}));
  }
}]});
const {AppLockGuard} = await import(pathToFileURL(`${process.cwd()}/tmp/template-app-lock-test/guard.mjs`));
test('template activation cannot mount before delayed settings and successful biometric unlock',async()=>{
  let settings, unlock, writes=0;
  globalThis.__templateLockSettings=()=>new Promise(resolve=>{settings=resolve;});
  globalThis.__templateLockAuthenticate=()=>new Promise(resolve=>{unlock=resolve;});
  function Activation(){useEffect(()=>{writes++;},[]);return React.createElement('div',null,'Activation');}
  const view=render(React.createElement(AppLockGuard,null,React.createElement(Activation)));
  assert.equal(writes,0);
  await act(async()=>settings(true));
  assert.equal(writes,0);
  assert.ok(view.getByText('boop is locked'));
  await act(async()=>unlock(true));
  assert.equal(writes,1);
  cleanup();
});
test('settings failure fails closed rather than mounting template activation',async()=>{
  globalThis.__templateLockSettings=async()=>{throw new Error('unavailable');};
  let mounts=0;
  function Activation(){useEffect(()=>{mounts++;},[]);return null;}
  await act(async()=>{render(React.createElement(AppLockGuard,null,React.createElement(Activation)));});
  assert.equal(mounts,0);
  cleanup();
  delete globalThis.__templateLockSettings;
  delete globalThis.__templateLockAuthenticate;
});
