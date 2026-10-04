import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { render, act, waitFor, cleanup } = await import('@testing-library/react');
const state = globalThis.__attachmentUI = { token: 'account-a', attachments: [] };
await build({ entryPoints: ['src/components/Attachments.tsx', 'src/lib/downloadCache.ts'], outdir: 'tmp/attachment-ui', outbase: '.', bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', outExtension: { '.js': '.mjs' }, external: ['react', 'react/jsx-runtime', 'convex/*'],
  define: { 'import.meta.env.VITE_CONVEX_URL': '"https://test.convex.cloud"' }, plugins: [{ name: 'attachment-context', setup(b) {
    b.onResolve({ filter: /\/(useAuth|useSettings|authenticatedConvex)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path.endsWith('/useAuth') ? 'export const useAuth=()=>globalThis.__attachmentUI;' : path.endsWith('/useSettings') ? 'export const useSettings=()=>({haptic:()=>{}});' : 'export const useQuery=()=>globalThis.__attachmentUI.attachments;export const useMutation=()=>()=>{};export const useAction=useMutation;' }));
  } }],
});
const load = path => import(pathToFileURL(`${process.cwd()}/tmp/attachment-ui/${path}.mjs`));
const { Attachments } = await load('src/components/Attachments');
const { isUncacheableResource, purgeAppDownloadCaches } = await load('src/lib/downloadCache');
const entry = { key: 'attachments/I/photo.png', url: 'https://test.convex.site/api/attachments/download?itemId=I&key=attachments%2FI%2Fphoto.png', contentType: 'image/png', size: 5 };

test('attachment previews revoke object URLs on permission notification, account switch, and unmount; late fetches cannot restore them', async () => {
  const previous = { fetch: globalThis.fetch, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const created = [], revoked = [], calls = [];
  URL.createObjectURL = () => { const url = `blob:preview-${created.length}`; created.push(url); return url; };
  URL.revokeObjectURL = url => revoked.push(url);
  globalThis.fetch = async (...args) => { calls.push(args); return new Response('photo'); };
  state.token = 'account-a'; state.attachments = [entry];
  const tree = () => React.createElement(Attachments, { itemId: 'I', canEdit: false, userDid: 'did:a' });
  const view = render(tree());
  try {
    await waitFor(() => assert.equal(view.getByAltText('Attachment').getAttribute('src'), 'blob:preview-0'));
    state.attachments = []; view.rerender(tree());
    await waitFor(() => assert.ok(revoked.includes('blob:preview-0')));
    assert.equal(view.queryByAltText('Attachment'), null);
    state.attachments = [entry]; view.rerender(tree());
    await waitFor(() => assert.equal(created.length, 2));
    let release;
    globalThis.fetch = () => new Promise(resolve => { release = resolve; });
    state.token = 'account-b'; view.rerender(tree());
    assert.equal(view.queryByAltText('Attachment'), null);
    assert.ok(revoked.includes('blob:preview-1'));
    view.unmount();
    await act(async () => { release(new Response('late other account bytes')); });
    assert.equal(created.length, 2);
    assert.equal(calls[0][1].redirect, 'error');
  } finally {
    view.unmount(); cleanup(); globalThis.fetch = previous.fetch; URL.createObjectURL = previous.create; URL.revokeObjectURL = previous.revoke;
  }
});

test('app cache purge removes broker, legacy signed download and resource bytes without deleting unrelated caches or shell assets', async () => {
  const urls = ['https://app.test/api/attachments/download?itemId=I', 'https://bucket.storage.railway.app/attachments/I/a?X-Amz-Signature=old', 'https://app.test/d/user/resources/list-L', 'https://app.test/assets/main.js'];
  const deleted = [], opened = [];
  await purgeAppDownloadCaches({ keys: async () => ['lisa-old', 'unrelated-app'], open: async name => {
    opened.push(name); return { keys: async () => urls.map(url => new Request(url)), delete: async request => { deleted.push(request.url); return true; } };
  } });
  assert.deepEqual(opened, ['lisa-old']); assert.deepEqual(deleted, urls.slice(0, 3));
  assert.equal(isUncacheableResource(new URL(urls[0])), true);
  assert.equal(isUncacheableResource(new URL(urls[3])), false);
});
