import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkApproval, needsApproval } from './check-authentication-cutover.mjs';
const record = () => ({owner:'release-owner',approvedBy:'release-owner',approvedAt:'2026-09-09T00:00:00Z',stagingEvidence:'staging run URL',clients:Object.fromEntries(['browser','ios','android','integrations'].map(k=>[k,{supportedVersions:'verified build IDs',evidence:'inventory URL'}]))});
test('pending cutover evidence blocks production',()=>{
  const pending=record();pending.approvedBy=null;pending.approvedAt=null;
  assert.throws(()=>checkApproval(pending));
});
test('approval requires the owner, staging run, and every supported client inventory',()=>{
  assert.doesNotThrow(()=>checkApproval(record()));
  for(const field of ['approvedBy','approvedAt','stagingEvidence']){const r=record();r[field]=null;assert.throws(()=>checkApproval(r));}
  for(const client of ['browser','ios','android','integrations']) for(const field of ['supportedVersions','evidence']){const r=record();r.clients[client][field]=null;assert.throws(()=>checkApproval(r));}
});
test('production and unknown Railway environments fail closed; previews can validate',()=>{
  for(const env of ['production',undefined,'renamed-production','']) assert.equal(needsApproval(true,env),true);
  for(const env of ['boop-pr-241','staging','development'])assert.equal(needsApproval(true,env),false);
  assert.equal(needsApproval(false,'boop-pr-241'),true);
});
