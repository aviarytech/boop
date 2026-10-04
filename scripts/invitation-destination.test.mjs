import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { getFunctionName } from 'convex/server';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { fixture, credentials, PRIVATE_SHARING_JWT_SECRET } from './helpers/private-sharing-fixture.mjs';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h } = await import('react');
const { MemoryRouter, Routes, Route } = await import('react-router-dom');
const { render, fireEvent, waitFor, cleanup, act } = await import('@testing-library/react');
const backendNames = ['invitations', 'listGrants', 'lists', 'items'];
await build({ entryPoints: backendNames.map(name => `convex/${name}.ts`), outdir: 'tmp/invitation-destination-backend', bundle: true,
  platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, external: ['convex/*'],
  define: { 'process.env.JWT_SECRET': JSON.stringify(PRIVATE_SHARING_JWT_SECRET) },
});
const modules = Object.fromEntries(await Promise.all(backendNames.map(async name => [name, await import(pathToFileURL(`${process.cwd()}/tmp/invitation-destination-backend/${name}.mjs`))])));

// Mount the actual invitation route AND ListView, including nested rows, keyboard
// shortcuts, menus, batch controls, calendar and the real item-details panel.
// Only transport/identity/device/offline boundaries are fixtures. Invitation
// acceptance and list authority/read results come from production backend handlers.
await build({ stdin: { contents: 'export { Invitations } from "./src/pages/Invitations"; export { ListView } from "./src/pages/ListView";', resolveDir: process.cwd() },
  outfile: 'tmp/invitation-destination-ui.mjs', bundle: true, jsx: 'automatic', platform: 'node', format: 'esm', packages: 'external',
  define: { 'import.meta.env.MODE': '"test"' },
  plugins: [{ name: 'invitation-destination-contexts', setup(b) {
    b.onResolve({ filter: /\/(authenticatedConvex|useOffline|useOptimisticItems|useSettings|useCurrentUser|useAuth|useNotifications|useStreaks|useCategories|originals|observability|analytics|share)$/ }, args => ({ path: args.path, namespace: 'destination-fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'destination-fixture' }, ({ path }) => ({ resolveDir: process.cwd(), contents:
      path.endsWith('/authenticatedConvex') ? `import {useSyncExternalStore} from 'react'; export function useQuery(ref,args){const s=globalThis.__invitationDestination;useSyncExternalStore(s.subscribe,()=>s.revision);return s.query(ref,args)} export const useMutation=ref=>args=>globalThis.__invitationDestination.mutate(ref,args);export const useAction=useMutation;` :
      path.endsWith('/useOffline') ? 'export const useOffline=()=>globalThis.__invitationDestination.offline;' :
      path.endsWith('/useOptimisticItems') ? 'export const useOptimisticItems=()=>globalThis.__invitationDestination.optimistic;' :
      path.endsWith('/useSettings') ? 'const settings={haptic:()=>{}};export const useSettings=()=>settings;' :
      path.endsWith('/useCurrentUser') ? 'export const useCurrentUser=()=>({did:globalThis.__invitationDestination.did,email:"fixture@example.test",isLoading:false});' :
      path.endsWith('/useAuth') ? 'export const useAuth=()=>({logout:async()=>{}});' :
      path.endsWith('/useNotifications') ? 'const value={scheduleItemsNotifications:()=>{},isEnabled:false};export const useNotifications=()=>value;' :
      path.endsWith('/useStreaks') ? 'const value={streak:0,recordTaskCompletion:()=>null};export const useStreaks=()=>value;' :
      path.endsWith('/useCategories') ? 'const value={categories:[]};export const useCategories=()=>value;' :
      path.endsWith('/observability') ? 'export const recordLatencyMs=()=>{};export const setGaugeMetric=()=>{};' :
      path.endsWith('/analytics') ? 'export const trackSignupStarted=()=>{};export const trackSignupCompleted=()=>{};export const trackListShared=()=>{};export const trackInviteSent=()=>{};' :
      path.endsWith('/share') ? 'export const shareList=async()=>{};export const shareItem=async()=>{};export const canShare=async()=>false;' :
      'export const verifyListEnvelope=()=>{};export const isRetroactiveGenesis=()=>false;export const createListAsset=()=>{};export const buildListSnapshot=()=>{};export const recordPublishedVersion=()=>{};export class ListNotAuthorableError extends Error {}',
    }));
  } }],
});
const { Invitations, ListView } = await import(pathToFileURL(`${process.cwd()}/tmp/invitation-destination-ui.mjs`));
afterEach(cleanup);

async function setup({ role = 'viewer', published = false, actor = 'pending', acceptFirst = false } = {}) {
  const ctx = fixture(modules, { published });
  Object.assign(ctx.rows.users.find(user => user._id === "U-owner"), { displayName: "Alex Rivera", displayNameChosenAt: 1 });
  ctx.rows.comments[0].userDid = 'did:pending';
  const state = globalThis.__invitationDestination = { ctx, did: `did:${actor}`, calls: [], revision: 0, listeners: new Set() };
  state.subscribe = listener => { state.listeners.add(listener); return () => state.listeners.delete(listener); };
  state.notify = () => { state.revision++; for (const listener of state.listeners) listener(); };
  const call = (module, operation, args, who = actor) => modules[module][operation]._handler(ctx, { ...args, ...credentials(who) });
  const invite = await call('invitations', 'createInvitation', { listId: 'L', email: 'fixture@example.test', role, requestId: 'destination-request' }, 'owner');
  state.hydrate = async () => {
    state.list = await call('lists', 'getList', { listId: 'L' });
    state.access = state.list ? await call('listGrants', 'getMyListAccess', { listId: 'L' }) : undefined;
    state.pending = await call('invitations', 'getPendingInvitations', {});
    state.lists = await call('lists', 'getUserLists', {});
    state.optimistic.items = state.list ? ctx.rows.items.filter(item => item.listId === 'L').map(item => ({ ...item })) : [];
  };
  state.write = async (type, payload) => {
    state.calls.push({ name: `items:${type}`, args: payload });
    await call('items', type, payload);
    await state.hydrate(); state.notify();
  };
  state.offline = { isOnline: true, queueMutation: async op => state.write(op.type, op.payload) };
  state.optimistic = { items: [], isLoading: false, usingCache: false,
    addItem: args => state.write('addItem', { listId: 'L', ...args }),
    checkItem: (itemId, checkedByDid) => state.write('checkItem', { itemId, checkedByDid, checkedAt: Date.now() }),
    uncheckItem: (itemId, userDid) => state.write('uncheckItem', { itemId, userDid }),
    removeItem: (itemId, userDid) => state.write('removeItem', { itemId, userDid }),
    reorderItems: (itemIds, userDid) => state.write('reorderItems', { listId: 'L', itemIds, userDid }),
    updateItem: args => state.write('updateItem', args),
  };
  state.query = (ref, args) => {
    if (args === 'skip') return undefined;
    const name = getFunctionName(ref);
    switch (name) {
      case 'invitations:getPendingInvitations': return state.pending;
      case 'lists:getUserLists': return state.lists;
      case 'lists:getList': return state.list;
      case 'listGrants:getMyListAccess': return state.access;
      case 'publication:getPublicationStatus': return published ? { status: 'active' } : null;
      case 'publication:isBookmarked': return false;
      case 'items:getListItems': return state.optimistic.items;
      case 'items:getSubItems': return state.optimistic.items.filter(item => item.parentId === args.parentId);
      case 'comments:getItemComments': return ctx.rows.comments.filter(comment => comment.itemId === args.itemId);
      case 'users:getUsersByDids': return {};
      default: return [];
    }
  };
  state.mutate = async (ref, args) => {
    const name = getFunctionName(ref);
    state.calls.push({ name, args });
    const [module, operation] = name.split(':');
    const result = await call(module, operation, args);
    await state.hydrate(); state.notify();
    return result;
  };
  if (acceptFirst) await call('invitations', 'acceptInvitation', { ...invite, accept: true });
  await state.hydrate();
  state.setRole = async next => {
    const grant = ctx.rows.listGrants.find(g => g.listId === 'L' && g.recipientId === `U-${actor}`);
    if (next) await call('listGrants', 'updateListGrant', { listId: 'L', grantId: grant._id, role: next }, 'owner');
    else await call('listGrants', 'revokeListGrant', { listId: 'L', grantId: grant._id }, 'owner');
    await state.hydrate(); state.notify();
  };
  return state;
}
function mount(path = '/invitations', navigationState) {
  return render(h(MemoryRouter, { initialEntries: [{ pathname: path, state: navigationState }] }, h(Routes, null,
    h(Route, { path: '/invitations', element: h(Invitations) }),
    h(Route, { path: '/list/:id', element: h(ListView) }),
  )));
}
async function assertNoOwnerControls(view) {
  fireEvent.click(view.getByRole('button', { name: 'More actions' }));
  for (const name of ['Rename list', 'Publish publicly', 'Manage publication', 'Delete list', 'Change category', 'Share with people']) assert.equal(view.queryByRole('button', { name: new RegExp(name + '$') }), null, name);
  fireEvent.click(view.getByRole('button', { name: 'More actions' }));
}

for (const role of ['viewer', 'editor']) test(`explicit ${role} acceptance opens the actual unpublished ListView with role-correct row/header controls`, async () => {
  const state = await setup({ role });
  const view = mount();
  assert.equal(view.queryByText('Private list'), null);
  fireEvent.click(view.getByRole('button', { name: 'Accept invitation' }));
  await view.findByRole('heading', { name: 'Private list' });
  assert.equal(view.queryByText('Access denied'), null);
  assert.equal(state.ctx.rows.listGrants.filter(g => g.recipientId === 'U-pending').length, 1);
  await assertNoOwnerControls(view);
  if (role === 'viewer') {
    assert.ok(view.getByText('You have view-only access to this list.'));
    assert.equal(view.queryByRole('textbox', { name: 'Add new item' }), null);
    for (const name of ['Check Secret item', 'Check Child', 'Drag to reorder', 'Select']) assert.equal(view.queryByRole('button', { name: new RegExp(name + '$') }), null, name);
    fireEvent.keyDown(window, { key: 'j' });
    for (const key of ['x', ' ', 'd', 'Delete', 'Backspace']) fireEvent.keyDown(window, { key });
    assert.deepEqual(state.calls.map(c => c.name), ['invitations:acceptInvitation']);
    fireEvent.click(view.getByRole('button', { name: 'Categorized view' }));
    assert.equal(view.queryByText('Drag items between aisles to reclassify'), null);
    assert.equal(view.queryByRole('button', { name: /New Aisle/ }), null);
    assert.deepEqual(state.calls.map(c => c.name), ['invitations:acceptInvitation'], 'viewer presentation switch is local only');
  } else {
    assert.ok(view.getByRole('textbox', { name: 'Add new item' }));
    assert.ok(view.getByRole('button', { name: 'Select' }));
    fireEvent.click(view.getByRole('button', { name: 'Check Secret item' }));
    await waitFor(() => assert.equal(state.ctx.rows.items.find(i => i._id === 'I').checked, true));
    fireEvent.change(view.getByRole('textbox', { name: 'Add new item' }), { target: { value: 'Recipient added' } });
    fireEvent.submit(view.getByRole('form', { name: 'Add new item' }));
    await waitFor(() => assert.ok(state.ctx.rows.items.some(i => i.name === 'Recipient added')));
    fireEvent.click(view.getByRole('button', { name: 'Categorized view' }));
    assert.ok(view.getByRole('button', { name: /New Aisle/ }));
    assert.equal(state.calls.some(c => c.name === 'lists:updateItemViewMode'), false, 'editors do not persist owner-only list preferences');
  }
});

test('real viewer details, comments and calendar remain read-only; an authored comment does not grant delete rights', async () => {
  const state = await setup({ acceptFirst: true });
  const view = mount('/list/L');
  fireEvent.click(view.getByText('Secret item'));
  await view.findByText('Item Details');
  assert.equal(view.queryByRole('button', { name: 'Save' }), null);
  assert.equal(view.getByDisplayValue('Secret item').disabled, true);
  assert.equal(view.queryByPlaceholderText('Add a comment...'), null);
  assert.equal(view.queryByRole('button', { name: 'Delete comment' }), null);
  assert.equal(view.queryByRole('button', { name: /Add sub-item/ }), null);
  fireEvent.click(view.getByRole('button', { name: 'Close panel' }));
  fireEvent.click(view.getByRole('button', { name: 'Calendar view' }));
  assert.ok(view.getByRole('button', { name: 'Today' }));
  assert.deepEqual(state.calls, []);
});

test('role downgrade updates actual open controls and shortcuts; revoked private access removes the destination', async () => {
  const state = await setup({ role: 'editor', acceptFirst: true });
  const view = mount('/list/L');
  fireEvent.click(view.getByRole('button', { name: 'Select' }));
  await act(() => state.setRole('viewer'));
  assert.equal(view.queryByRole('button', { name: 'Select' }), null);
  assert.equal(view.queryByRole('textbox', { name: 'Add new item' }), null);
  fireEvent.keyDown(window, { key: 'j' }); fireEvent.keyDown(window, { key: 'x' }); fireEvent.keyDown(window, { key: 'Delete' });
  assert.deepEqual(state.calls, []);
  await act(() => state.setRole(null));
  assert.ok(view.getByText('List not found'));
  assert.equal(view.queryByRole('heading', { name: 'Private list' }), null);
});

test('publication gives no edit capability and routed openShare state cannot mount an owner management dialog', async () => {
  const state = await setup({ published: true, actor: 'outsider' });
  const view = mount('/list/L', { openShare: true });
  assert.ok(view.getByRole('heading', { name: 'Private list' }));
  assert.equal(state.access.role, null);
  assert.equal(view.queryByRole('textbox', { name: 'Add new item' }), null);
  assert.equal(view.queryByRole('dialog'), null);
  await assertNoOwnerControls(view);
});

test('owner destination retains rename, publication, delete and content controls', async () => {
  await setup({ actor: 'owner' });
  const view = mount('/list/L');
  assert.ok(view.getByRole('textbox', { name: 'Add new item' }));
  fireEvent.click(view.getByRole('button', { name: 'More actions' }));
  for (const name of ['Rename list', 'Publish publicly', 'Delete list', 'Change category']) assert.ok(view.getByRole('button', { name: new RegExp(name + '$') }));
});

test('an already-open editor details panel becomes read-only when the accepted role is downgraded', async () => {
  const state = await setup({ role: 'editor', acceptFirst: true });
  const view = mount('/list/L');
  fireEvent.click(view.getByText('Secret item'));
  await view.findByRole('button', { name: 'Save' });
  assert.equal(view.getByDisplayValue('Secret item').disabled, false);
  assert.ok(view.getByPlaceholderText('Add a comment...'));
  await act(() => state.setRole('viewer'));
  assert.equal(view.queryByRole('button', { name: 'Save' }), null);
  assert.equal(view.getByDisplayValue('Secret item').disabled, true);
  assert.equal(view.queryByPlaceholderText('Add a comment...'), null);
  assert.equal(view.queryByRole('button', { name: 'Delete comment' }), null);
  assert.deepEqual(state.calls, []);
});
