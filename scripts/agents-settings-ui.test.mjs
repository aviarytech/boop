// Settings → Agents (docs/lws-agent-auth.md "App"): approval order and
// progress, narrowing, sign-in prompts, revoke order and stray keys. Convex
// and the DID update are fixtures; scripts/agent-keys.test.mjs covers the DID
// update itself.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const React = await import('react');
const { render, fireEvent, screen, cleanup, waitFor } = await import('@testing-library/react');

const state = globalThis.__agentsUi = { revision: 0, listeners: new Set() };
state.subscribe = listener => { state.listeners.add(listener); return () => state.listeners.delete(listener); };
state.notify = () => { state.revision++; for (const listener of state.listeners) listener(); };
const DID = 'did:webvh:QmScid:boop.test:user-sub-org-0000000';
const request = {
  requestId: 'R1', name: 'Shopping bot', actions: ['read', 'create', 'delete'], fragment: 'agent-aaaaaaaaaa',
  agentDidKey: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK', agentPublicKeyMultibase: 'z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
  createdAt: Date.now() - 5 * 60_000, expiresAt: Date.now() + 3_600_000,
};
const agent = { agentId: 'A1', name: 'Calendar sync', fragment: 'agent-bbbbbbbbbb', actions: ['read', 'update'], createdAt: Date.now() - 86_400_000 * 3, lastUsedAt: undefined };
function reset() {
  Object.assign(state, {
    pending: [request], active: [agent], calls: [], didFragments: [agent.fragment],
    failApprove: 0, keyError: null, failRevoke: false, loggedOut: false, copied: null,
  });
}
// The served DID log: only its latest state matters here.
function didLog() {
  const methods = state.didFragments.map(f => ({ id: `#${f}`, type: 'Multikey', controller: DID, publicKeyMultibase: `z6Mk${f}` }));
  return JSON.stringify({ versionId: '1-x', parameters: {}, state: { id: DID, verificationMethod: methods, authentication: ['#key-0', ...methods.map(m => m.id)] } });
}
globalThis.fetch = async url => (String(url).includes('/api/did/log') ? new Response(didLog()) : new Response('', { status: 404 }));
Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async text => { state.copied = text; } }, configurable: true });

await build({
  entryPoints: ['src/components/AgentsSettings.tsx'], outfile: 'tmp/agents-ui/agents.mjs', bundle: true, jsx: 'automatic', platform: 'node', format: 'esm',
  external: ['react', 'react/jsx-runtime', 'convex/*', '@capacitor/core'],
  define: { 'import.meta.env.VITE_LWS_BASE_URL': 'undefined' }, logLevel: 'error',
  plugins: [{ name: 'agents-ui-fixtures', setup(b) {
    b.onResolve({ filter: /(lib\/authenticatedConvex|hooks\/useAuth|lib\/authorIdentity)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'fixture' }));
    b.onResolve({ filter: /(^|\/)convexUrls$/ }, () => ({ path: 'convexUrls', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ resolveDir: `${process.cwd()}/src/lib`, contents: {
      authenticatedConvex: `import {useSyncExternalStore} from "react";import {getFunctionName} from "convex/server";
        export function useQuery(ref){const s=globalThis.__agentsUi;useSyncExternalStore(s.subscribe,()=>s.revision);return getFunctionName(ref)==="lwsAccess:pendingAccessRequests"?s.pending:s.active;}
        export function useMutation(ref){return async args=>{const s=globalThis.__agentsUi;const name=getFunctionName(ref);s.calls.push([name,args]);
          if(name==="lwsAccess:approveAccessRequest"){if(s.failApprove>0){s.failApprove--;throw new Error("Network down");}s.pending=[];s.notify();return {agentId:"A2"};}
          if(name==="lwsAccess:denyAccessRequest"){s.pending=[];s.notify();return null;}
          if(name==="lwsAccess:revokeAgent"){if(s.failRevoke)throw new Error("Offline");const a=s.active.find(x=>x.agentId===args.agentId);s.active=s.active.filter(x=>x!==a);s.notify();return {fragment:a.fragment,vmId:"x"};}};}`,
      useAuth: `export const useAuth=()=>({user:{did:${JSON.stringify(DID)},turnkeySubOrgId:"sub-org-0000000000000"},token:"jwt",logout:async()=>{globalThis.__agentsUi.loggedOut=true;}});`,
      convexUrls: `export const getConvexHttpUrl=()=>"https://deploy.convex.site";`,
      authorIdentity: `import {AgentKeyError} from "./agentKeys";
        export async function changeAuthorAgentKey(change,token,onStep,deps,account){const s=globalThis.__agentsUi;s.calls.push(["did",change]);s.account=account;
          if(s.keyError){const e=s.keyError;s.keyError=null;throw new AgentKeyError(e,e==="not-ready"?"Sign in again to change your agents.":"boop didn't save the DID update (500).");}
          onStep&&onStep("signing");onStep&&onStep("saving");
          if("add" in change)s.didFragments.push(change.add.fragment);else s.didFragments=s.didFragments.filter(f=>f!==change.remove);
          return {changed:true};}`,
    }[path] }));
  } }],
});
const { AgentsSettings } = await import(pathToFileURL(`${process.cwd()}/tmp/agents-ui/agents.mjs`));
const mount = () => render(React.createElement(AgentsSettings));
afterEach(cleanup);
const STORAGE = 'https://deploy.convex.site/lws/user-sub-org-00000000';

test('shows the storage URL to copy, a pending request and an approved agent, and what approval makes public', async () => {
  reset(); mount();
  assert.ok(screen.getByText(STORAGE));
  fireEvent.click(screen.getByRole('button', { name: 'Copy storage URL' }));
  await waitFor(() => assert.equal(state.copied, STORAGE));
  assert.ok(screen.getByText(/how many agents you\s+have, but not their names/));
  assert.ok(screen.getByText(/other devices need the latest version/));
  assert.ok(screen.getByText('Shopping bot'));
  assert.ok(screen.getByText('pbnn EGta 2doK'), 'the key fingerprint, as the agent CLI prints it');
  assert.ok(screen.getByText('Only approve a request you started just now from your own agent. Check the key fingerprint matches what your agent printed.'));
  assert.ok(screen.getByText(/asked 5 minutes ago/));
  assert.ok(screen.getByText('Calendar sync'));
  assert.ok(screen.getByText('Read, Update'));
  assert.ok(screen.getByText(/not used yet/));
});

test('approve: the DID update comes first, then the grant, with only the actions left ticked', async () => {
  reset(); mount();
  assert.equal(screen.getAllByRole('checkbox').filter(box => box.checked).length, 3);
  fireEvent.click(screen.getByRole('checkbox', { name: /Delete items/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Approve Shopping bot' }));
  await waitFor(() => assert.ok(!screen.queryByText('Shopping bot')));
  assert.deepEqual(state.calls, [
    ['did', { add: { fragment: request.fragment, publicKeyMultibase: request.agentPublicKeyMultibase } }],
    ['lwsAccess:approveAccessRequest', { requestId: 'R1', actions: ['read', 'create'] }],
  ]);
  // Whose served DID to read, so a key already in it is approved with no signature.
  assert.deepEqual(state.account, { subOrgId: 'sub-org-0000000000000', did: DID });
});

test('a grant that fails after the DID update can be retried; nothing is approved with no action ticked', async () => {
  reset(); state.failApprove = 1; mount();
  fireEvent.click(screen.getByRole('button', { name: 'Approve Shopping bot' }));
  const alert = await screen.findByRole('alert');
  assert.match(alert.textContent, /Network down/);
  assert.match(alert.textContent, /already has the key, so trying again only grants access/);
  fireEvent.click(screen.getByRole('button', { name: 'Try approving Shopping bot' }));
  await waitFor(() => assert.ok(!screen.queryByText('Shopping bot')));
  assert.deepEqual(state.calls.map(c => c[0]), ['did', 'lwsAccess:approveAccessRequest', 'did', 'lwsAccess:approveAccessRequest']);

  cleanup(); reset(); mount();
  for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
  assert.equal(screen.getByRole('button', { name: 'Approve Shopping bot' }).disabled, true);
});

test('without a Turnkey session, approval asks to sign in again and grants nothing', async () => {
  reset(); state.keyError = 'not-ready'; mount();
  fireEvent.click(screen.getByRole('button', { name: 'Approve Shopping bot' }));
  await screen.findByRole('alert');
  assert.deepEqual(state.calls.map(c => c[0]), ['did']);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
  assert.equal(state.loggedOut, true);
});

test('deny', async () => {
  reset(); mount();
  fireEvent.click(screen.getByRole('button', { name: 'Deny Shopping bot' }));
  await waitFor(() => assert.ok(!screen.queryByText('Shopping bot')));
  assert.deepEqual(state.calls, [['lwsAccess:denyAccessRequest', { requestId: 'R1' }]]);
});

test('revoke asks first, ends access before touching the DID, and a key left behind can be removed later', async () => {
  reset(); state.keyError = 'rejected'; mount();
  fireEvent.click(screen.getByRole('button', { name: 'Revoke Calendar sync' }));
  assert.deepEqual(state.calls, [], 'nothing happens before confirming');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Revoke Calendar sync' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
  const alert = await screen.findByRole('alert');
  assert.match(alert.textContent, /no longer has access, but its key is still in your DID/);
  assert.deepEqual(state.calls, [['lwsAccess:revokeAgent', { agentId: 'A1' }], ['did', { remove: agent.fragment }]]);
  const remove = await screen.findByRole('button', { name: `Remove key #${agent.fragment} from your DID` });
  assert.ok(screen.getByText(/turns it away until its old key is gone: Remove key from DID first/));
  fireEvent.click(remove);
  await waitFor(() => assert.ok(!screen.queryByRole('button', { name: /Remove key/ })));
  assert.deepEqual(state.calls.at(-1), ['did', { remove: agent.fragment }]);
  assert.match(screen.getByRole('status').textContent, /key is gone from your DID/);
});

test('a revoke the server refuses leaves the DID alone', async () => {
  reset(); state.failRevoke = true; mount();
  fireEvent.click(screen.getByRole('button', { name: 'Revoke Calendar sync' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
  assert.match((await screen.findByRole('alert')).textContent, /Couldn't revoke Calendar sync: Offline/);
  assert.deepEqual(state.calls.map(c => c[0]), ['lwsAccess:revokeAgent']);
});
