import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, fireEvent, waitFor, act, cleanup } = await import('@testing-library/react');
const { MemoryRouter, useLocation, useNavigate } = await import('react-router-dom');

const state = globalThis.__deepLinkFixture = {
  native: true, listeners: new Map(), registrations: 0, launches: 0,
  launch: 'https://boop.ad/invitations/abc/1?continue=review#accept',
};
await build({
  entryPoints: ['src/hooks/useNativeLinks.ts'], outfile: 'tmp/deeplinks.mjs',
  bundle: true, format: 'esm', platform: 'node', external: ['react', 'react-router-dom'],
  plugins: [{ name: 'capacitor-fixture', setup(b) {
    b.onResolve({ filter: /^@capacitor\// }, ({ path }) => ({ path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path.endsWith('/core')
      ? 'export const Capacitor={isNativePlatform:()=>globalThis.__deepLinkFixture.native};'
      : `export const App={
          addListener:async(name,fn)=>{const s=globalThis.__deepLinkFixture;s.registrations++;
            const key=Symbol(name);s.listeners.set(key,{name,fn});return {remove:async()=>{s.listeners.delete(key)}};},
          getLaunchUrl:async()=>{const s=globalThis.__deepLinkFixture;s.launches++;return {url:s.launch}},
          exitApp:()=>{}
        };` }));
  } }],
});
const { useNativeLinks } = await import(pathToFileURL(`${process.cwd()}/tmp/deeplinks.mjs`));
function NativeRouter() {
  useNativeLinks();
  const location = useLocation(), navigate = useNavigate();
  return React.createElement(React.Fragment, null,
    React.createElement('output', null, `${location.pathname}${location.search}${location.hash}`),
    React.createElement('button', { onClick: () => navigate('/list/accepted') }, 'Accept'),
    React.createElement('button', { onClick: () => navigate('/shared') }, 'Shared with me'));
}
const tree = () => React.createElement(React.StrictMode, null,
  React.createElement(MemoryRouter, { initialEntries: ['/'] }, React.createElement(NativeRouter)));
const dispatch = url => {
  for (const { name, fn } of state.listeners.values()) if (name === 'appUrlOpen') fn({ url });
};

test('native invitation is consumed once across router navigation; warm links work and listeners clean up', async () => {
  const view = render(tree());
  const path = () => view.container.querySelector('output').textContent;
  try {
    await waitFor(() => assert.equal(path(), '/invitations/abc/1?continue=review#accept'));
    assert.equal(state.launches, 1);
    assert.equal(state.listeners.size, 2, 'one link listener and one back listener after StrictMode setup');
    const registrations = state.registrations;
    fireEvent.click(view.getByText('Accept'));
    await act(async () => {});
    assert.equal(path(), '/list/accepted', 'acceptance must not bounce to the consumed launch invitation');
    fireEvent.click(view.getByText('Shared with me'));
    await act(async () => {});
    assert.equal(path(), '/shared');
    assert.equal(state.registrations, registrations, 'route changes do not reinstall listeners');
    assert.equal(state.launches, 1);
    await act(async () => { dispatch('https://boop.ad/invitations/abc/2'); });
    assert.equal(path(), '/invitations/abc/2');
    await act(async () => {
      dispatch('https://attacker.test/invitations/abc/3');
      dispatch('https://boop.ad:444/invitations/abc/3');
      dispatch('not a URL');
    });
    assert.equal(path(), '/invitations/abc/2');
  } finally { view.unmount(); cleanup(); }
  assert.equal(state.listeners.size, 0);
  const remounted = render(tree());
  await act(async () => {});
  assert.equal(remounted.container.querySelector('output').textContent, '/', 'remount does not replay a cold launch');
  remounted.unmount(); cleanup();
  assert.equal(state.listeners.size, 0);
});

test('web fallback does not register native listeners or fetch a launch URL', async () => {
  state.native = false;
  const before = { registrations: state.registrations, launches: state.launches };
  const view = render(tree());
  await act(async () => {});
  assert.equal(view.container.querySelector('output').textContent, '/');
  assert.deepEqual({ registrations: state.registrations, launches: state.launches }, before);
  view.unmount(); cleanup();
});
