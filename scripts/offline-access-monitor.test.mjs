import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, act, waitFor, cleanup } = await import('@testing-library/react');
const state = globalThis.__accessMonitor = { user: { turnkeySubOrgId: 'monitor-account', did: 'did:monitor' }, token: 'session', contact: false, canRead: false, canEdit: false, checkedAt: 10, responses: new Map(), queries: [] };
await build({ entryPoints: ['src/components/offline/OfflineAccessMonitor.tsx', 'src/lib/offline.ts', 'src/lib/noteDrafts.ts'], outdir: 'tmp/access-monitor', outbase: '.', bundle: true, splitting: true, platform: 'node', format: 'esm', jsx: 'automatic', outExtension: { '.js': '.mjs' }, external: ['react', 'react/jsx-runtime', 'convex/server', 'convex/values', 'idb'], plugins: [{ name: 'access-context', setup(b) {
  b.onResolve({ filter: /\/useAuth$|\/network$|^convex\/react$/ }, args => ({ path: args.path, namespace: 'fixture' }));
  b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path.endsWith('/useAuth') ? 'export const useAuth=()=>globalThis.__accessMonitor;' : path.endsWith('/network') ? 'export const getNetworkStatus=()=>false;export const onNetworkChange=()=>()=>{};' : `
    import { getFunctionName } from 'convex/server';
    export const useConvex=()=>({mutation:async()=>{throw Error('Offline transport')}});
    export const useQueries=(queries)=>{const s=globalThis.__accessMonitor;const key=JSON.stringify([queries,s.contact,s.canRead,s.canEdit,s.checkedAt,s.user]);
      if(s.responses.has(key))return s.responses.get(key);const result={};
      for(const [key,{query,args}] of Object.entries(queries)){const name=getFunctionName(query);s.queries.push({name,args});
        result[key]=!s.contact?undefined:name==='items:getOfflineAccount'?{accountId:s.user.turnkeySubOrgId,did:s.user.did}:name==='items:getOfflineDraftAccess'?args.resources.map(r=>({...r,canEdit:s.canEdit,checkedAt:s.checkedAt})):
        [...new Set([...args.listIds,...args.items.map(i=>i.listId)])].map(listId=>({listId,canRead:s.canRead,canEdit:s.canEdit,checkedAt:s.checkedAt,missingItemIds:[]}));
      }s.responses.set(key,result);return result;
    };` }));
} }] });
const load = path => import(pathToFileURL(`${process.cwd()}/tmp/access-monitor/${path}.mjs`));
const { OfflineAccessMonitor } = await load('src/components/offline/OfflineAccessMonitor');
const store = await load('src/lib/offline');
const drafts = await load('src/lib/noteDrafts');

test('persistent monitor purges unopened list caches and both note-editor comparison bases on reconnect, preserving only account-scoped independent work', async () => {
  const account = state.user.turnkeySubOrgId;
  const source = { _id: 'I', _creationTime: 1, listId: 'L', name: 'Private title', description: 'Private description', checked: false, createdByDid: 'did:owner', createdAt: 1 };
  await store.cacheItems(account, [source], 'L');
  await store.cacheAllLists(account, [{ _id: 'L', name: 'Private list', ownerDid: 'did:owner', createdAt: 1 }]);
  await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I', name: 'Independent authored name' } }, [source]);
  for (const kind of ['note', 'item']) drafts.writeDraft(`did:monitor:${kind}:${kind === 'note' ? 'L' : 'I'}:session:one`, `Independent ${kind} draft`, `Original ${kind} source`);
  drafts.writeDraft('did:other:note:L:session:one', 'Other account work', 'Other account source');
  const view = render(React.createElement(OfflineAccessMonitor));
  try {
    await waitFor(() => assert.ok(state.queries.some(q => q.name === 'items:getOfflineAccess')));
    assert.equal((await store.getCachedItemsByList(account, 'L')).length, 1, 'offline before contact still has its cache');
    state.contact = true; view.rerender(React.createElement(OfflineAccessMonitor));
    await waitFor(async () => assert.deepEqual(await store.getCachedItemsByList(account, 'L'), []));
    await waitFor(() => assert.ok(drafts.listDrafts('did:monitor:note:L')[0].detached));
    for (const kind of ['note', 'item']) {
      const doc = `did:monitor:${kind}:${kind === 'note' ? 'L' : 'I'}`;
      const [draft] = drafts.listDrafts(doc);
      assert.equal(draft.base, undefined); assert.equal(draft.text, `Independent ${kind} draft`);
      // A suspended tab resumes with its stale body/base after the denial.
      drafts.writeDraft(draft.key, `Later independent ${kind} text`, `Original ${kind} source`);
      assert.equal(drafts.listDrafts(doc)[0].base, undefined);
      drafts.reconcileDraftAccess(doc, true, 1);
      assert.equal(drafts.draftIsDetached(draft.key), true);
    }
    assert.equal(drafts.listDrafts('did:other:note:L')[0].base, 'Other account source');
    assert.equal((await store.getOperations(account))[0].payload.name, 'Independent authored name');
  } finally { view.unmount(); cleanup(); }
});

test('memory-only note drafts drop cached bases and reject stale base writes just like persisted drafts', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); }, get length() { throw Error('blocked'); } } });
  try {
    const document = 'did:memory:note:N', key = `${document}:session:one`;
    drafts.writeDraft(key, 'Independent memory draft', 'Private memory source');
    assert.equal(drafts.draftBase(key), 'Private memory source');
    drafts.reconcileDraftAccess(document, false, 10);
    assert.equal(drafts.draftBase(key), undefined);
    drafts.writeDraft(key, 'Still independent', 'Stale private memory source');
    assert.equal(drafts.draftBase(key), undefined);
    assert.equal(drafts.draftText(key), 'Still independent');
  } finally { Object.defineProperty(globalThis, 'localStorage', descriptor); }
});

test('quota-exhausted storage cannot hide a newer in-memory denial from a stale editor', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const persisted = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key) { return persisted.get(key) ?? null; },
    setItem() { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
    removeItem(key) { persisted.delete(key); },
    key(index) { return [...persisted.keys()][index] ?? null; },
    get length() { return persisted.size; },
  } });
  try {
    for (const kind of ['note', 'item']) {
      const document = `did:quota:${kind}:resource`;
      persisted.set(`boop-note-access:${document}`, JSON.stringify({ canEdit: true, checkedAt: 1 }));
      drafts.reconcileDraftAccess(document, false, 10);
      const newSession = `${document}:session:resumed`;
      drafts.writeDraft(newSession, 'My independent work', 'Private comparison body');
      assert.equal(drafts.draftIsDetached(newSession), true);
      assert.equal(drafts.draftBase(newSession), undefined);
      assert.equal(drafts.draftText(newSession), 'My independent work');
      drafts.reconcileDraftAccess(document, true, 2);
      assert.equal(drafts.draftIsDetached(`${document}:session:another`), true);
    }
  } finally { Object.defineProperty(globalThis, 'localStorage', descriptor); }
});

test('discarding all drafts retains denied marker locators for regrant monitoring', async () => {
  const document = 'did:monitor:note:discarded';
  state.contact = true; state.canEdit = false; state.checkedAt = 100;
  const key = `${document}:session:old`;
  drafts.writeDraft(key, 'Independent work', 'Private baseline');
  drafts.reconcileDraftAccess(document, false, 100);
  drafts.clearDraft(key, drafts.readDraft(key));
  assert.equal(drafts.listDrafts(document).length, 0);
  assert.ok(drafts.draftResources(['did:monitor']).some(r => r.documentKey === document));
  const view = render(React.createElement(OfflineAccessMonitor));
  try {
    state.canEdit = true; state.checkedAt = 101;
    view.rerender(React.createElement(OfflineAccessMonitor));
    await waitFor(() => assert.equal(drafts.draftIsDetached(`${document}:session:fresh`), false));
    drafts.writeDraft(`${document}:session:fresh`, 'New authorized work', 'New baseline');
    assert.equal(drafts.draftBase(`${document}:session:fresh`), 'New baseline');
  } finally { view.unmount(); cleanup(); }
});

test('unrelated offline snapshots do not rescan app download caches', async () => {
  const previous = globalThis.caches; let scans = 0;
  globalThis.caches = { keys: async () => { scans++; return []; } };
  const view = render(React.createElement(OfflineAccessMonitor));
  try {
    await waitFor(() => assert.ok(scans > 0));
    const before = scans;
    await act(async () => {
      await store.cacheAllLists(state.user.turnkeySubOrgId, []);
      await store.queueMutation(state.user.turnkeySubOrgId, {type:'createList',payload:{name:'Unrelated local work'}}, []);
    });
    assert.equal(scans, before);
  } finally { view.unmount(); cleanup(); globalThis.caches = previous; }
});
