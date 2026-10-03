import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const React = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const { render, fireEvent, waitFor } = await import('@testing-library/react');
await build({
  entryPoints: ['src/components/auth/AuthGuard.tsx'], outfile: 'tmp/deletion-guard-test.mjs',
  bundle: true, platform: 'node', format: 'esm', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-router-dom'],
  plugins: [{ name: 'auth-fixture', setup(build) {
    build.onResolve({ filter: /hooks\/useAuth$|lib\/authenticatedConvex$|_generated\/api$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
      args.path.endsWith('useAuth') ? 'export const useAuth = () => globalThis.deletionGuardAuth;' :
      args.path.endsWith('authenticatedConvex') ? 'export const useQuery = () => globalThis.deletionGuardAccount; export const useMutation = () => globalThis.deletionGuardResume;' :
      'export const api = {auth:{getUserByTurnkeyId:{}},users:{deleteUserData:{}}};', loader: 'js' }));
  } }],
});
const { AuthGuard } = await import(pathToFileURL(`${process.cwd()}/tmp/deletion-guard-test.mjs`));

test('pending deletion has a reachable retry screen without mounting protected queries', async () => {
  let resumed = 0, loggedOut = 0, mounted = 0;
  globalThis.deletionGuardAccount = { _id: 'U1', deletionRequestedAt: 1 };
  globalThis.deletionGuardAuth = { isAuthenticated: true, isLoading: false,
    user: { turnkeySubOrgId: 'owner' }, logout: async () => { loggedOut++; } };
  globalThis.deletionGuardResume = async args => { assert.equal(args.userId, 'U1'); resumed++; };
  function Protected() { mounted++; return React.createElement('div', null, 'Protected'); }
  const view = render(React.createElement(MemoryRouter, null,
    React.createElement(AuthGuard, null, React.createElement(Protected))));
  try {
    assert.equal(mounted, 0);
    fireEvent.click(view.getByText('Resume deletion'));
    await waitFor(() => assert.equal(loggedOut, 1));
    assert.equal(resumed, 1);
    assert.equal(mounted, 0);
  } finally { view.unmount(); }
});
