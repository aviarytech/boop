// Exercise Home's actual create-dialog callback wiring. External services and
// unrelated child surfaces are fixtures; Home, CreateListModal and Panel are real.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: 'http://localhost/' });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { MemoryRouter, useLocation } = await import('react-router-dom');
const { render, cleanup, fireEvent, act } = await import('@testing-library/react');
const fixture = globalThis.__createListHomeUi = {};
const root = process.env.CREATE_DIALOG_ROOT ?? '.';
const mocks = {
  '/lib/authenticatedConvex': 'export const useMutation=()=>globalThis.__createListHomeUi.save; export const useQuery=()=>[];',
  '/_generated/api': 'export const api={lists:{createList:"create",getUserLists:"lists"},originalsHost:{getOriginalStatus:"originalStatus"},items:{addItem:"add"},publication:{getUserBookmarkIds:"bookmarks"}};',
  '/hooks/useCurrentUser': 'export const useCurrentUser=()=>({did:"did:owner",legacyDid:null,isLoading:false});',
  '/hooks/useSettings': 'export const useSettings=()=>({haptic:value=>globalThis.__createListHomeUi.feedback.push(value),listSort:"newest"});',
  '/hooks/useCategories': 'export const useCategories=()=>({categories:[],isLoading:false});',
  '/hooks/useOffline': 'export const useOffline=()=>({isOnline:true,accountId:"account",compaction:{}});',
  '/hooks/useStreaks': 'export const useStreaks=()=>({streak:null});',
  '/hooks/useBilling': 'export const useBilling=()=>({isPro:false});',
  '/lib/offline': 'export const cacheAllLists=async()=>{}, getAllCachedLists=async()=>[];',
  '/lib/planLimit': 'export const isPlanLimitError=error=>error.message==="plan limit";',
  '/lib/noteBody': 'export const isNote=()=>false;',
  '/lib/analytics': 'export const trackListCreated=()=>{}, trackFirstListCreated=()=>{}, trackFeatureGateHit=()=>{}, trackInviteSent=()=>{};',
  '/components/CreateChooser': 'import {createElement} from "react"; export const CreateChooser=({onPick})=>createElement("button",{onClick:()=>onPick("list")},"Choose list");',
  '/components/TemplatePickerModal': 'import {createElement} from "react"; export const TemplatePickerModal=({onCreateBlank})=>createElement("button",{onClick:onCreateBlank},"Create blank list");',
  '/components/OnboardingFlow': 'import {createElement} from "react"; export const OnboardingFlow=()=>null, isOnboardingDone=()=>true, isInviteNudgeDone=()=>false, markInviteNudgeDone=()=>{}, InviteNudge=({listName})=>createElement("aside",null,`Invitation for ${listName}`);',
};
for (const [path, exports] of Object.entries({
  '/components/ListCard': ['ListCard'], '/components/NoteCard': ['NoteCard'],
  '/components/CreateNoteModal': ['CreateNoteModal'], '/components/lists/CategoryHeader': ['CategoryHeader'],
  '/components/lists/CategoryManager': ['CategoryManager'], '/components/ui/SearchInput': ['SearchInput'],
  '/components/ui/SortDropdown': ['SortDropdown'], '/components/ui/Skeleton': ['HomePageSkeleton'],
  '/components/ui/EmptyState': ['NoListsEmptyState', 'NoSearchResultsEmptyState'],
  '/components/StreakBadge': ['StreakBadge'], '/ReferralInvite': ['ReferralInviteCurrentUser'],
  '/lists/CategorySelector': ['CategorySelector'],
})) mocks[path] = exports.map(name => `export const ${name}=()=>null;`).join('');

await build({ entryPoints: [`${root}/src/pages/Home.tsx`], outfile: 'tmp/create-list-home-ui.mjs',
  bundle: true, jsx: 'automatic', platform: 'node', format: 'esm',
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-router-dom'],
  plugins: [{ name: 'home-fixtures', setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      const key = Object.keys(mocks).find(key => args.path.endsWith(key));
      return key ? { path: key, namespace: 'fixture' } : undefined;
    });
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: mocks[path] }));
  } }],
});
const { Home } = await import(pathToFileURL(`${process.cwd()}/tmp/create-list-home-ui.mjs`));
afterEach(() => { cleanup(); localStorage.clear(); });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function mountHome() {
  const save = deferred();
  Object.assign(fixture, { feedback: [], save: () => save.promise });
  localStorage.setItem('boop:onboarding_demo_created', 'done');
  let location;
  function Location() { location = useLocation(); return null; }
  const view = render(React.createElement(React.StrictMode, null,
    React.createElement(MemoryRouter, { initialEntries: ['/d'] },
      React.createElement(Location), React.createElement(Home))));
  fireEvent.click(view.getByRole('button', { name: 'Create new list or note' }));
  fireEvent.click(view.getByRole('button', { name: 'Choose list' }));
  fireEvent.click(view.getByRole('button', { name: 'Create blank list' }));
  fireEvent.change(view.getByRole('textbox', { name: 'List name' }), { target: { value: 'Weekend' } });
  fireEvent.submit(document.getElementById('create-list-form'));
  return { view, save, location: () => location };
}

// Creation is one save now: the list's Original is minted when it is opened.
test('Home does not open an invite nudge after the save is dismissed', async () => {
  const f = mountHome();
  fireEvent.keyDown(window, { key: 'Escape' });
  const feedback = [...fixture.feedback];
  await act(async () => { f.save.resolve('weekend-list'); });
  assert.equal(f.view.queryByText('Invitation for Weekend'), null);
  assert.deepEqual(fixture.feedback, feedback);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
  assert.equal(f.view.queryByRole('dialog'), null);
  assert.equal(f.view.queryByText('Invitation for Weekend'), null);
  assert.equal(f.location().pathname, '/d');
});

test('Home still opens its invite nudge when creation completes while visible', async () => {
  const f = mountHome();
  await act(async () => { f.save.resolve('weekend-list'); });
  assert.ok(f.view.getByText('Invitation for Weekend'));
  assert.ok(f.view.getByRole('heading', { name: 'List created!' }));
  assert.equal(f.location().pathname, '/d');
});
