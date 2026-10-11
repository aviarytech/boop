import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: 'http://localhost/' });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, cleanup, fireEvent, act, waitFor } = await import('@testing-library/react');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const fixture = globalThis.__loginUi = { authenticated: false, listeners: new Set(), verify: async () => {} };
await build({
  entryPoints: [{in: process.env.LOGIN_SOURCE ?? 'src/pages/Login.tsx', out: 'pages/Login'}, {in: 'src/lib/loginDestination.ts', out: 'lib/loginDestination'}], outdir: 'tmp/login', outbase: 'src',
  bundle: true, splitting: true, platform: 'node', format: 'esm', jsx: 'automatic', outExtension: { '.js': '.mjs' },
  external: ['react', 'react/jsx-runtime', 'react-router-dom'],
  plugins: [{ name: 'auth-fixture', setup(b) {
    b.onResolve({ filter: /\/hooks\/useAuth$|\/components\/auth\/OtpInput$|\/lib\/analytics$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents:
      path.endsWith('/useAuth') ? `import {useSyncExternalStore} from 'react'; export function useAuth(){const f=globalThis.__loginUi; const isAuthenticated=useSyncExternalStore(cb=>{f.listeners.add(cb);return()=>f.listeners.delete(cb)},()=>f.authenticated);return {isAuthenticated,isLoading:false,startOtp:async()=>{},verifyOtp:code=>f.verify(code)}}` :
      path.endsWith('/OtpInput') ? `import {createElement} from 'react'; export const OtpInput=({onComplete})=>createElement('button',{onClick:()=>onComplete('123456')},'Verify fixture OTP');` :
      'export const trackSignupStarted=()=>{}; export const trackSignupCompleted=()=>{};' }));
  }}],
});
const { Login } = await import(pathToFileURL(`${process.cwd()}/tmp/login/pages/Login.mjs`));
const { loginDestination } = await import(pathToFileURL(`${process.cwd()}/tmp/login/lib/loginDestination.mjs`));
afterEach(() => { cleanup(); fixture.authenticated = false; fixture.verify = async () => {}; fixture.listeners.clear(); });
const authenticate = () => { fixture.authenticated = true; for (const cb of fixture.listeners) cb(); };
function mount({ entry = { pathname: '/login' }, embedded = false } = {}) {
  const router = createMemoryRouter([
    { path: '/login', element: React.createElement(Login, { embedded }) },
    { path: '*', element: React.createElement('div', null, 'Destination') },
  ], { initialEntries: ['/previous', entry], initialIndex: 1 });
  const view = render(React.createElement(React.StrictMode, null, React.createElement(RouterProvider, { router })));
  return { router, view };
}
async function otp(view) {
  fireEvent.change(view.getByLabelText('Email address'), { target: { value: 'test@example.test' } });
  fireEvent.submit(view.getByRole('button', { name: 'Send Code' }).closest('form'));
  await waitFor(() => assert.ok(view.getByText('Verify fixture OTP')));
  fireEvent.click(view.getByText('Verify fixture OTP'));
}

test('destination preserves guarded pathname, search, hash and action state', () => {
  assert.deepEqual(loginDestination('', { from: { pathname: '/list/abc', search: '?view=all', hash: '#item', state: { openShare: true } } }), { to: '/list/abc?view=all#item', state: { openShare: true } });
});
test('known runbook retains precedence and invalid runbooks fall back to guarded route', () => {
  assert.equal(loginDestination('?template=release-checklist', { from: { pathname: '/profile' } }).to, '/templates/release-checklist/use');
  assert.equal(loginDestination('?template=invalid', { from: { pathname: '/profile' } }).to, '/profile');
});
test('missing, malformed, external and login-loop destinations safely use home', () => {
  for (const state of [undefined, null, {}, {from: '/list/a'}, {from: {pathname: 5}}, ...['https://evil.test','//evil.test','/a/..//evil.test','/\\evil.test','/login','/login/','/LOGIN','/a/../login','/login?x=1','/list/a\n'].map(pathname => ({from:{pathname}}))]) {
    assert.equal(loginDestination('', state).to, '/d', JSON.stringify(state));
  }
});
test('already-authenticated login resumes intent and replaces history', async () => {
  fixture.authenticated = true;
  const {router} = mount({entry: {pathname:'/login',state:{from:{pathname:'/list/abc',search:'?q=1',hash:'#last',state:{openShare:true}}}}});
  await waitFor(() => assert.equal(router.state.location.pathname, '/list/abc'));
  assert.equal(router.state.location.search, '?q=1'); assert.equal(router.state.location.hash, '#last');
  assert.deepEqual(router.state.location.state, {openShare:true});
  await act(async () => router.navigate(-1)); assert.equal(router.state.location.pathname,'/previous');
  await act(async () => router.navigate(1)); assert.equal(router.state.location.pathname,'/list/abc');
});
test('OTP authentication resumes the originally guarded route', async () => {
  fixture.verify = async () => authenticate();
  const {router,view} = mount({entry:{pathname:'/login',state:{from:{pathname:'/invitations'}}}});
  await otp(view);
  await waitFor(() => assert.equal(router.state.location.pathname, '/invitations'));
});
test('late successful OTP after navigating away cannot hijack the newer page', async () => {
  let finish;
  fixture.verify = () => new Promise(resolve => { finish = () => { authenticate(); resolve(); }; });
  const {router,view} = mount({entry:{pathname:'/login',state:{from:{pathname:'/list/old'}}}});
  await otp(view);
  await act(async () => router.navigate('/privacy'));
  await act(async () => finish());
  assert.equal(router.state.location.pathname, '/privacy');
});
test('embedded login leaves navigation to its parent after OTP', async () => {
  fixture.verify = async () => authenticate();
  const {router,view} = mount({embedded:true});
  await otp(view);
  await act(async () => {});
  assert.equal(router.state.location.pathname, '/login');
});
test('App gives Login sole responsibility for post-auth destination', () => {
  const source = readFileSync('src/App.tsx','utf8');
  assert.match(source, /path="\/login" element=\{<Login \/>\}/);
  assert.doesNotMatch(source, /templateLoginDestination/);
});

test('rendered login resumes a selected runbook without stale route state', async () => {
  fixture.authenticated = true;
  const { router } = mount({entry:{pathname:'/login',search:'?template=release-checklist',state:{from:{pathname:'/profile',state:{old:true}}}}});
  await waitFor(() => assert.equal(router.state.location.pathname, '/templates/release-checklist/use'));
  assert.equal(router.state.location.state, null);
});
test('failed OTP remains on login with intended route available for a retry', async () => {
  fixture.verify = async () => { throw new Error('Invalid code'); };
  const from = {pathname:'/list/retry',search:'?view=all'};
  const { router,view } = mount({entry:{pathname:'/login',state:{from}}});
  const originalError = console.error;
  console.error = () => {};
  try { await otp(view); await act(async () => {}); }
  finally { console.error = originalError; }
  assert.equal(router.state.location.pathname, '/login');
  assert.deepEqual(router.state.location.state, {from});
  fixture.verify = async () => authenticate();
  fireEvent.click(view.getByText('Verify fixture OTP'));
  await waitFor(() => assert.equal(router.state.location.pathname, '/list/retry'));
  assert.equal(router.state.location.search,'?view=all');
});
