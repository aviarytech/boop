import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { fixture, credentials, sessions, PRIVATE_SHARING_JWT_SECRET } from './helpers/private-sharing-fixture.mjs';

const names = ['items', 'lists', 'attachments', 'attachmentDownload', 'listGrants', 'actorSession'];
const storage = globalThis.__revocationStorage = { reads: 0, duringRead: undefined };
await build({ entryPoints: [...names.map(n => `convex/${n}.ts`), 'src/lib/offline.ts', 'src/lib/optimisticItems.ts', 'src/lib/attachmentFetch.ts'],
  outdir: 'tmp/revocation', outbase: '.', bundle: true, splitting: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, external: ['convex/*', 'idb'],
  define: { 'process.env.JWT_SECRET': JSON.stringify(PRIVATE_SHARING_JWT_SECRET), 'process.env.CONVEX_SITE_URL': '"https://test.convex.site"' },
  plugins: [{ name: 'private-storage', setup(b) {
    b.onResolve({ filter: /\/lib\/bucket$/ }, () => ({ path: 'bucket', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
      export const getObjectBody=async()=>{const s=globalThis.__revocationStorage;s.reads++;await s.duringRead?.();return new Blob(['private bytes']);};
      export const bucketKey=(...p)=>p.join('/'); export const presignPut=async()=>{throw Error('not used')};
      export const deleteObject=async()=>{};
    ` }));
  } }],
});
const load = p => import(pathToFileURL(`${process.cwd()}/tmp/revocation/${p}.mjs`));
const modules = Object.fromEntries(await Promise.all(names.map(async n => [n, await load(`convex/${n}`)])));
const store = await load('src/lib/offline');
const { projectItems } = await load('src/lib/optimisticItems');
const { fetchAttachment } = await load('src/lib/attachmentFetch');
const call = (ctx, mod, name, args) => modules[mod][name]._handler(ctx, args);
function make(options) {
  const ctx = fixture(modules, options);
  ctx.rows.items[0].attachments = [{ key: 'attachments/I/photo.png', contentType: 'image/png', size: 13, sha256: 'digest' }];
  storage.reads = 0; storage.duringRead = undefined;
  return ctx;
}
const manifest = (ctx, who = 'editor') => call(ctx, 'items', 'getOfflineAccess', { ...credentials(who), listIds: ['L', 'N', 'X'] });
const revoke = ctx => call(ctx, 'listGrants', 'revokeListGrant', { ...credentials('owner'), listId: 'L', grantId: 'G-L-editor' });
const retrieve = (ctx, url, who = 'editor') => call(ctx.action, 'attachmentDownload', 'download', new Request(url, { headers: who === 'anonymous' ? {} : { Authorization: `Bearer ${sessions[who].authToken}` } }));

test('the exact broker URL from before revocation cannot authorize a fresh private retrieval, and never redirects to storage', async () => {
  const ctx = make();
  const [attachment] = await call(ctx, 'attachments', 'getAttachmentUrls', { ...credentials('editor'), itemId: 'I' });
  assert.equal(new URL(attachment.url).origin, 'https://test.convex.site');
  assert.ok(!attachment.url.includes('X-Amz-'));
  let response = await retrieve(ctx, attachment.url);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'private bytes');
  assert.equal(response.headers.get('location'), null);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await retrieve(ctx, attachment.url, 'anonymous')).status, 403);
  const reads = storage.reads;
  await revoke(ctx);
  response = await retrieve(ctx, attachment.url);
  assert.equal(response.status, 403); assert.equal(storage.reads, reads);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.ok(!(await response.text()).includes('private bytes'));
  await assert.rejects(() => call(ctx, 'attachments', 'getAttachmentUrls', { ...credentials('editor'), itemId: 'I' }), /Resource unavailable/);
  await assert.rejects(() => call(ctx, 'items', 'getListItemsForReplay', { ...credentials('editor'), listId: 'L', operationIds: [] }), /Resource unavailable/);
});

test('download rechecks revocation during bucket I/O; alternate keys and credentials cannot bypass it', async () => {
  const ctx = make();
  const [entry] = await call(ctx, 'attachments', 'getAttachmentUrls', { ...credentials('editor'), itemId: 'I' });
  storage.duringRead = () => revoke(ctx);
  assert.equal((await retrieve(ctx, entry.url)).status, 403);
  storage.duringRead = undefined;
  for (const key of ['attachments/IX/photo.png', 'attachments/I/../IX/photo.png', 'attachments/I/unregistered.png']) {
    const url = new URL(entry.url); url.searchParams.set('key', key);
    assert.equal((await retrieve(ctx, url, 'owner')).status, 403);
  }
  ctx.rows.agentApiKeys.find(k => k._id === 'KEY-owner').scopes = ['lists:read'];
  const response = await call(ctx.action, 'attachmentDownload', 'download', new Request(entry.url, { headers: { 'X-API-Key': 'key-owner' } }));
  assert.equal(response.status, 403);
});

test('viewer downgrade keeps reads, denies writes; public publication still permits anonymous bytes until unpublish', async () => {
  const ctx = make({ published: true });
  const [entry] = await call(ctx, 'attachments', 'getAttachmentUrls', { ...credentials('editor'), itemId: 'I' });
  await call(ctx, 'listGrants', 'updateListGrant', { ...credentials('owner'), listId: 'L', grantId: 'G-L-editor', role: 'viewer' });
  assert.equal((await retrieve(ctx, entry.url)).status, 200);
  await assert.rejects(() => call(ctx, 'attachments', 'addAttachment', { ...credentials('editor'), itemId: 'I', bucketKey: 'attachments/I/new.png', contentType: 'image/png', size: 1, sha256: 'x' }), /Resource unavailable/);
  const access = (await manifest(ctx))[0];
  assert.equal(access.canRead, true); assert.equal(access.canEdit, false);
  await revoke(ctx);
  assert.equal((await retrieve(ctx, entry.url, 'anonymous')).status, 200);
  ctx.rows.publications[0].status = 'inactive';
  assert.equal((await retrieve(ctx, entry.url, 'anonymous')).status, 403);
});

test('recipient leave and source deletion use the same private revocation lifecycle; leave preserves ownership and other recipients', async () => {
  const ctx = make();
  const [entry] = await call(ctx, 'attachments', 'getAttachmentUrls', { ...credentials('editor'), itemId: 'I' });
  for (let i = 0; i < 2; i++) await call(ctx, 'listGrants', 'leaveList', { ...credentials('editor'), listId: 'L' });
  assert.equal(ctx.rows.listGrants.some(g => g._id === 'G-L-editor'), false);
  assert.equal(ctx.rows.listGrants.some(g => g._id === 'G-L-viewer'), true);
  assert.equal(ctx.rows.lists[0].ownerDid, 'did:owner');
  assert.equal(ctx.rows.listGrantRevocations[0].recipientId, 'U-editor');
  assert.equal((await manifest(ctx))[0].canRead, false);
  assert.equal((await retrieve(ctx, entry.url)).status, 403);
  ctx.rows.lists.splice(0, 1);
  assert.equal((await retrieve(ctx, entry.url, 'owner')).status, 403);
  assert.equal((await manifest(ctx, 'viewer'))[0].canRead, false);
});

test('unopened offline caches purge on authoritative contact; stale tab writes cannot resurrect content; other accounts remain isolated', async () => {
  const ctx = make(), account = 'revocation-cache';
  const source = structuredClone(ctx.rows.items[0]);
  await store.cacheAllLists(account, ctx.rows.lists.slice(0, 1));
  await store.cacheItems(account, [source], 'L');
  await store.cacheItems('another-account', [source], 'L');
  await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I', name: 'My unsent name' } }, [source]);
  await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I', name: 'Dependent name' } }, [source]);
  const allowed = (await manifest(ctx)).map(entry => ({ ...entry, checkedAt: 1 }));
  await revoke(ctx);
  // Offline device cannot know yet. Contact, rather than wall-clock time, purges.
  assert.equal((await store.getCachedItemsByList(account, 'L')).length, 1);
  await store.reconcileOfflineAccess(account, (await manifest(ctx)).map(entry => ({ ...entry, checkedAt: 2 })));
  assert.deepEqual(await store.getCachedItemsByList(account, 'L'), []);
  assert.deepEqual(await store.getAllCachedLists(account), []);
  assert.equal((await store.getCachedItemsByList('another-account', 'L')).length, 1);
  await store.reconcileOfflineAccess(account, allowed); // stale second tab
  assert.equal(await store.cacheListSnapshot(account, 'L', [source], [], 100), false);
  await store.cacheAllLists(account, ctx.rows.lists.slice(0, 1));
  assert.deepEqual(await store.getCachedItemsByList(account, 'L'), []);
  assert.deepEqual(await store.getAllCachedLists(account), []);
  const edits = await store.getOperations(account);
  assert.ok(edits.every(m => m.denied && m.state === 'conflict'));
  assert.equal(edits[0].payload.name, 'My unsent name');
  assert.ok(!JSON.stringify(edits).includes('Secret description'));
  assert.deepEqual(projectItems([], edits, 'L'), []);
  await store.retryOperations(account);
  assert.ok((await store.getOperations(account)).every(m => m.denied && m.state === 'conflict'));
  // A late in-flight error cannot unpark a denied entry.
  await store.saveOperation(account, { ...edits[0], denied: undefined, state: 'failed' });
  assert.equal((await store.getOperations(account))[0].state, 'conflict');
});

test('downgrade retains the readable cache but removes denied overlays, including edits enqueued by a stale form after contact', async () => {
  const ctx = make(), account = 'revocation-downgrade', source = structuredClone(ctx.rows.items[0]);
  await store.cacheItems(account, [source], 'L');
  await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I', name: 'Local' } }, [source]);
  ctx.rows.listGrants.find(g => g._id === 'G-L-editor').role = 'viewer';
  await store.reconcileOfflineAccess(account, await manifest(ctx));
  await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I', name: 'Late' } }, [source]);
  const edits = await store.getOperations(account);
  assert.ok(edits.every(m => m.denied));
  assert.equal(projectItems(await store.getCachedItemsByList(account, 'L'), edits, 'L')[0].name, 'Secret item');
  await store.retainItemDraft(account, 'form-draft', 'L', 'I', { name: 'Still typing' });
  const draft = (await store.getOperations(account)).find(m => m.operationId === 'form-draft');
  assert.deepEqual(draft.payload, { itemId: 'I', draftFields: { name: 'Still typing' } });
  assert.ok(!JSON.stringify(draft).includes('Secret description'));
});

test('credential-bearing client retrieval rejects old bucket URLs, hostile origins, credentials and redirects', async () => {
  const originalFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (...args) => { calls.push(args); return new Response('bytes'); };
  try {
    const trusted = 'https://test.convex.site';
    for (const url of ['https://storage.railway.app/attachments/I/a?X-Amz-Signature=old', 'https://evil.test/api/attachments/download', `${trusted}/other`, 'https://test.convex.site.evil.test/api/attachments/download', 'https://user:password@test.convex.site/api/attachments/download']) {
      await assert.rejects(() => fetchAttachment(url, trusted, 'secret-session'));
    }
    assert.equal(calls.length, 0, 'unsafe locators must not make any network request');
    await fetchAttachment(`${trusted}/api/attachments/download?itemId=I&key=attachments%2FI%2Fa`, trusted, 'secret-session');
    assert.equal(calls[0][1].headers.Authorization, 'Bearer secret-session');
    assert.equal(calls[0][1].redirect, 'error');
    assert.equal(calls[0][1].cache, 'no-store');
    assert.equal(calls[0][1].credentials, 'omit');
  } finally { globalThis.fetch = originalFetch; }
});

test('inaccessible list/item pairs have an indistinguishable manifest and do not inspect item membership', async () => {
  const ctx = make();
  const result = await call(ctx, 'items', 'getOfflineAccess', { ...credentials('outsider'), listIds: ['L'], items: ['I', 'absent', 'IX'].map(itemId => ({ itemId, listId: 'L' })) });
  assert.equal(result[0].canRead, false);
  assert.deepEqual(result[0].missingItemIds, ['I', 'absent', 'IX']);
  assert.ok(!ctx.reads.some(read => ['I', 'absent', 'IX'].includes(read.id)), 'do not inspect membership without list read authority');
});

test('individual source deletion purges an unopened cached item on contact even while its list remains readable', async () => {
  const ctx = make(), account = 'item-deletion', source = structuredClone(ctx.rows.items[0]);
  await store.cacheItems(account, [source], 'L');
  await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I', name: 'Unsent authored name' } }, [source]);
  await ctx.db.delete('I');
  const access = await call(ctx, 'items', 'getOfflineAccess', { ...credentials('editor'), listIds: ['L'], items: [{ itemId: 'I', listId: 'L' }] });
  assert.equal(access[0].canRead, true); assert.deepEqual(access[0].missingItemIds, ['I']);
  await store.reconcileOfflineAccess(account, access);
  assert.deepEqual(await store.getCachedItemsByList(account, 'L'), []);
  await store.cacheItems(account, [source], 'L');
  assert.deepEqual(await store.getCachedItemsByList(account, 'L'), [], 'stale tab cannot resurrect a deleted item');
  assert.deepEqual((await store.getOfflineState(account)).unavailableItemIds, ['I']);
  assert.equal((await store.getOperations(account))[0].denied, true);
});

test('legacy full-form queues recover only changed fields with a proven baseline; ambiguous work is retained without display/export or silent loss', async () => {
  for (const matching of [true, false]) {
    const ctx = make(), account = `legacy-recovery-${matching}`, source = structuredClone(ctx.rows.items[0]);
    source.url = 'https://private.test/unchanged'; source.recurrence = { frequency: 'daily' };
    await store.cacheItems(account, [source], 'L');
    await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I', name: 'Authored name' } }, [source]);
    const [m] = await store.getOperations(account);
    delete m.authoredFields;
    m.payload = { itemId: 'I', name: 'Authored name', description: source.description, url: source.url, recurrence: source.recurrence };
    const original = structuredClone(m.payload);
    await (await store.getOfflineDB(account)).put('mutations', m);
    if (!matching) await store.cacheItems(account, [{ ...source, description: 'A different revision' }], 'L');
    await store.reconcileOfflineAccess(account, [{ listId: 'L', canRead: false, canEdit: false }]);
    const [denied] = await store.getOperations(account);
    const exported = store.exportSavedEdits([denied]);
    assert.deepEqual(await store.getCachedItemsByList(account, 'L'), []);
    assert.ok(!JSON.stringify(exported).includes(source.description));
    assert.ok(!JSON.stringify(exported).includes(source.url));
    if (matching) {
      assert.deepEqual(denied.payload, { itemId: 'I', name: 'Authored name' });
      assert.equal(exported.edits[0].payload.name, 'Authored name');
    } else {
      assert.equal(denied.legacyRecoveryPending, true);
      assert.deepEqual(denied.payload, original, 'do not destroy genuine work whose provenance is ambiguous');
      assert.deepEqual(exported.edits, []); assert.equal(exported.retainedLegacyCount, 1);
      assert.match(denied.error, /no matching baseline/);
    }
  }
});

for (const lifecycle of ['revoke/regrant', 'leave/reinvite']) test(`${lifecycle} restores readable cache and new edits without restoring denied overlays or false deletion tombstones`, async () => {
  const ctx = make(), account = `restored-${lifecycle}`, source = structuredClone(ctx.rows.items[0]);
  await store.cacheItems(account, [source], 'L');
  await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I', name: 'Before loss' } }, [source]);
  if (lifecycle === 'revoke/regrant') await revoke(ctx);
  else await call(ctx, 'listGrants', 'leaveList', { ...credentials('editor'), listId: 'L' });
  const args = { ...credentials('editor'), listIds: ['L'], items: [{ itemId: 'I', listId: 'L' }] };
  const denied = await call(ctx, 'items', 'getOfflineAccess', args);
  await store.reconcileOfflineAccess(account, denied.map(entry => ({ ...entry, checkedAt: 10 })));
  assert.deepEqual((await store.getOfflineState(account)).unavailableItemIds, []);
  // Fresh acceptance creates a new accepted grant (invitation replay/authorization
  // is exercised with actual invitation handlers in invitations.test.mjs).
  ctx.rows.listGrants.push({ _id: 'new-grant', listId: 'L', recipientId: 'U-editor', role: 'editor', acceptedAt: 20 });
  const restored = await call(ctx, 'items', 'getOfflineAccess', args);
  await store.reconcileOfflineAccess(account, restored.map(entry => ({ ...entry, checkedAt: 20 })));
  await store.cacheItems(account, [source], 'L');
  assert.equal((await store.getCachedItemsByList(account, 'L')).length, 1);
  assert.equal(projectItems([source], await store.getOperations(account), 'L')[0].name, source.name);
  await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I', name: 'New authorized edit' } }, [source]);
  const fresh = (await store.getOperations(account)).at(-1);
  assert.equal(fresh.state, 'pending'); assert.ok(!fresh.denied); assert.equal(fresh.expected[0].predecessor, undefined);
  assert.ok(await store.prepareOperationForSync(account, fresh.id, fresh.operationId));
});

test('independent item subset clocks survive list-first and later-subset-first delivery across more than 128 items; ack payloads are scrubbed', async () => {
  const account = 'out-of-order-items', source = make().rows.items[0];
  const items = Array.from({ length: 130 }, (_, n) => ({ ...source, _id: `I${n}` }));
  await store.cacheItems(account, items, 'L');
  await store.queueMutation(account, { type: 'updateItem', payload: { itemId: 'I0', name: 'Acknowledged name' } }, [items[0]]);
  const [operation] = await store.getOperations(account);
  const ack = { operationId: operation.operationId, result: null, revisions: { I0: 'digest' }, sequence: 1 };
  await store.saveOperation(account, { ...operation, payload: { itemId: 'I0', description: 'Legacy acknowledged private body' }, state: 'acked', ack });
  // Newer list-only result, then the newer second subset, precede the older
  // first subset's independently authoritative deletion observation.
  await store.reconcileOfflineAccess(account, [{ listId: 'L', canRead: true, canEdit: true, checkedAt: 30 }]);
  await store.reconcileOfflineAccess(account, [{ listId: 'L', canRead: true, canEdit: true, checkedAt: 20, missingItemIds: ['I129'], presentItemIds: ['I128'] }]);
  await store.reconcileOfflineAccess(account, [{ listId: 'L', canRead: true, canEdit: true, checkedAt: 10, missingItemIds: ['I0'], presentItemIds: items.slice(1, 128).map(i => i._id) }]);
  const cached = await store.getCachedItemsByList(account, 'L');
  assert.equal(cached.length, 128); assert.ok(!cached.some(item => ['I0', 'I129'].includes(item._id)));
  const [receipt] = await store.getOperations(account);
  assert.deepEqual(receipt.payload, {}); assert.deepEqual(receipt.ack, ack);
  // Older evidence for the SAME item cannot resurrect it.
  await store.reconcileOfflineAccess(account, [{ listId: 'L', canRead: true, canEdit: true, checkedAt: 9, presentItemIds: ['I0'] }]);
  await store.cacheItems(account, items, 'L');
  assert.equal((await store.getCachedItemsByList(account, 'L')).length, 128);
  // A newer positive existence check can clear even a previous unavailable marker.
  await store.reconcileOfflineAccess(account, [{ listId: 'L', canRead: true, canEdit: true, checkedAt: 40, presentItemIds: ['I0'] }]);
  await store.cacheItems(account, items, 'L');
  assert.equal((await store.getCachedItemsByList(account, 'L')).length, 129);
});
