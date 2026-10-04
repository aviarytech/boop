import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, act, cleanup } = await import('@testing-library/react');
const { ConvexProvider } = await import('convex/react');
const { getFunctionName } = await import('convex/server');
const state = globalThis.__monitorSubscription = {
  token: null, accountId: '',
  compaction: { lists: [], items: [], operations: [], revokedListIds: [] },
  reconciled: [], drafts: [],
};
await build({ entryPoints: ['src/components/offline/OfflineAccessMonitor.tsx'], outfile: 'tmp/monitor-subscription.mjs', bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'convex/react', 'convex/server', 'convex/values'], plugins: [{ name: 'monitor-context', setup(b) {
  b.onResolve({ filter: /\/useAuth$|\/useOffline$|\/offline$|\/noteDrafts$|\/downloadCache$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents:
    path.endsWith('/useAuth') ? 'export const useAuth=()=>globalThis.__monitorSubscription;' :
    path.endsWith('/useOffline') ? 'export const useOffline=()=>globalThis.__monitorSubscription;' :
    path.endsWith('/offline') ? 'export const reconcileOfflineAccess=(account,value)=>globalThis.__monitorSubscription.reconciled.push({account,value});' :
    path.endsWith('/downloadCache') ? 'export const purgeAppDownloadCaches=async()=>{};' :
    `export const draftResources=()=>globalThis.__monitorSubscription.drafts;
     export const reconcileDraftAccess=()=>{}; export const subscribeDrafts=()=>()=>{};` }));
} }] });
const { OfflineAccessMonitor } = await import(pathToFileURL(`${process.cwd()}/tmp/monitor-subscription.mjs`));

// Keep the actual Convex React hooks. Stubbing useQueries hides its requirement
// for stable request identities and missed the production infinite render loop.
test('real Convex subscriptions survive sign-in, batched access, token changes and sign-out', async () => {
  const active = new Map();
  const results = new Map();
  const client = { watchQuery(query, args) {
    const name = getFunctionName(query);
    const key = JSON.stringify([name, args]);
    if (!results.has(key)) results.set(key, name === 'items:getOfflineAccount'
      ? { accountId: state.accountId, did: 'did:owner' } : []);
    return {
      localQueryResult: () => results.get(key), journal: () => undefined,
      onUpdate(listener) { active.set(key, { name, args, listener }); return () => active.delete(key); },
    };
  } };
  const tree = () => React.createElement(ConvexProvider, { client }, React.createElement(OfflineAccessMonitor));
  const view = render(tree());
  try {
    assert.equal(active.size, 0);
    state.accountId = 'account-one'; state.token = 'first-session';
    state.compaction = { lists: [{ _id: 'L' }], items: [{ _id: 'I', listId: 'L' }], operations: [], revokedListIds: [] };
    state.drafts = [{ kind: 'note', id: 'L', documentKey: 'did:owner:note:L' }];
    view.rerender(tree());
    assert.equal(active.size, 4, 'identity, list, item and draft subscriptions mount');
    assert.ok([...active.values()].every(q => q.args.authToken === 'first-session'));
    const listQuery = [...active.entries()].find(([, q]) => q.name === 'items:getOfflineAccess' && q.args.listIds.length);
    const denial = [{ listId: 'L', canRead: false, canEdit: false, checkedAt: 10, missingItemIds: [] }];
    await act(async () => { results.set(listQuery[0], denial); listQuery[1].listener(); });
    assert.ok(state.reconciled.some(r => r.account === 'account-one' && r.value === denial), 'revocation still reaches reconciliation');
    state.token = 'renewed-session'; view.rerender(tree());
    assert.equal(active.size, 4);
    assert.ok([...active.values()].every(q => q.args.authToken === 'renewed-session'));
    state.accountId = 'account-two'; state.token = 'other-session'; view.rerender(tree());
    assert.ok([...active.values()].every(q => q.args.authToken === 'other-session'));
    state.accountId = ''; state.token = null; view.rerender(tree());
    assert.equal(active.size, 0, 'sign-out removes all protected subscriptions');
  } finally { view.unmount(); cleanup(); }
  assert.equal(active.size, 0);
});
