// Test-only Convex wire-protocol fixture. Never imported by the application.
// Runs beside Vite on loopback; each test owns a separate in-memory account.
import { createServer } from 'vite';
import { randomUUID } from 'node:crypto';
import { BUILTIN_TEMPLATES } from '../../convex/lib/templateCatalog.ts';
import { canonical, revision, replayTargets } from '../../shared/replay.ts';

const TS_ZERO = 'AAAAAAAAAAA=';
const accounts = new Map();
const sockets = new Set();
const user = {
  _id: 'users:e2e', _creationTime: 1, turnkeySubOrgId: 'e2e-account',
  email: 'e2e@example.test', did: 'did:webvh:e2e:boop.ad:user-e2e', displayName: 'E2E User',
};

function seed(options) {
  const key = randomUUID();
  const token = `e2e.${Buffer.from(JSON.stringify({ sub: key, exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url')}.fixture`;
  const lists = Array.from({ length: options.lists ?? 0 }, (_, i) => ({
    _id: `lists:mocklist${i}`, _creationTime: i + 1, name: `Test List ${i + 1}`,
    ownerDid: user.did, assetDid: `did:cel:fixture-${i}`, createdAt: i + 1,
  }));
  const items = (options.items ?? []).map((item, i) => ({
    _id: `items:mockitem${i}`, _creationTime: i + 1, listId: 'lists:mocklist0',
    name: item.name, checked: item.checked ?? false, createdByDid: user.did,
    createdAt: i + 1, updatedAt: i + 1, order: i,
  }));
  const account = { key, token, options, lists, items, published: options.published ?? false,
    sequence: 0, receipts: [], calls: [], errors: [], nextId: 0, offline: false, dropReplayResponses: 0 };
  accounts.set(token, account);
  return account;
}

function query(account, path, args) {
  switch (path) {
    case 'auth:getUserByTurnkeyId': return user;
    case 'lists:getUserLists': return account.lists;
    case 'lists:getList': return account.lists.find(l => l._id === args.listId) ?? null;
    case 'items:getListItems': return account.items.filter(i => i.listId === args.listId);
    case 'items:getListItemsForReplay': return {
      items: account.items.filter(i => i.listId === args.listId),
      acknowledgments: account.receipts.filter(r => args.operationIds.includes(r.operationId)).map(r => r.ack),
      sequence: account.sequence,
    };
    case 'items:getItemForSync': {
      // Production throws resourceUnavailable() for missing and unreadable items alike.
      const item = account.items.find(i => i._id === args.itemId);
      if (!item) throw Object.assign(new Error('Resource unavailable'), { errorData: { kind: 'auth', code: 'FORBIDDEN', message: 'Resource unavailable' } });
      return item;
    }
    case 'items:getOfflineAccount': return { accountId: user.turnkeySubOrgId, did: user.did };
    case 'items:getOfflineAccess': return [...new Set([...args.listIds, ...(args.items ?? []).map(i => i.listId)])].map(listId => {
      const canRead = account.lists.some(l => l._id === listId);
      const locators = (args.items ?? []).filter(i => i.listId === listId);
      const present = id => canRead && account.items.some(i => i._id === id && i.listId === listId);
      return { listId, canRead, canEdit: canRead, checkedAt: Date.now(),
        presentItemIds: locators.filter(i => present(i.itemId)).map(i => i.itemId),
        missingItemIds: locators.filter(i => !present(i.itemId)).map(i => i.itemId) };
    });
    case 'items:getOfflineDraftAccess': return args.resources.map(resource => ({ ...resource, checkedAt: Date.now(),
      canEdit: resource.kind === 'note' ? account.lists.some(l => l._id === resource.id) : account.items.some(i => i._id === resource.id && account.lists.some(l => l._id === i.listId)) }));
    case 'listGrants:getMyListAccess': return { ownerDid: user.did, role: account.lists.some(l => l._id === args.listId) ? 'owner' : null };
    case 'users:getMyPublicDisplayName': return { displayName: null };
    case 'billing:getUserPlan': return 'free';
    case 'billing:getUserSubscription': return null;
    case 'publication:getPublicationStatus': return account.published ? {
      status: 'active', webvhDid: `${user.did}/resources/list-${args.listId}`,
      publishedAt: 1, publishedByDid: user.did,
    } : null;
    case 'publication:isBookmarked': return false;
    case 'users:getUsersByDids': return Object.fromEntries(args.dids.map(did => [did, { displayName: user.displayName, email: user.email }]));
    case 'users:getUserStats': return { totalItems: account.items.length, completedItems: account.items.filter(i => i.checked).length };
    case 'referrals:getReferralStats': return { referralCount: 0, totalCredits: 0, earnedMonths: 0 };
    case 'referrals:getReferralCode': return { code: 'e2e-code' };
    case 'notifications:hasSubscription': return false;
    case 'lists:getListEnvelope': return null;
    case 'listGrants:getSharedWithMe':
    case 'listGrants:getListGrants':
    case 'invitations:getListInvitations':
    case 'invitations:getPendingInvitations':
    case 'lists:getLegacyListIds':
    case 'publication:getUserBookmarkIds':
    case 'categories:getUserCategories':
    case 'templates:getPublicTemplates':
    case 'templates:getUserTemplates':
    case 'bitcoinAnchors:getListAnchors':
    case 'bitcoinAnchors:getItemAnchors':
    case 'items:getSubItems':
    case 'comments:getItemComments':
    case 'tags:getListTags': return [];
    default: throw new Error(`Unimplemented fixture query: ${path}`);
  }
}

// Mirrors convex/lib/replay.ts: receipts are keyed by operation ID, and the
// expected revision (or the acknowledged predecessor's revision) is checked in
// the same step as the write. Client clocks are never consulted.
const REPLAY_TYPES = {
  'items:addItemReplay': 'addItem', 'items:checkItemReplay': 'checkItem', 'items:uncheckItemReplay': 'uncheckItem',
  'items:updateItemReplay': 'updateItem', 'items:removeItemReplay': 'removeItem', 'items:reorderItemsReplay': 'reorderItem',
  'items:batchCheckItemsReplay': 'batchCheckItems', 'items:batchUncheckItemsReplay': 'batchUncheckItems',
  'items:batchDeleteItemsReplay': 'batchDeleteItems', 'lists:createListReplay': 'createList',
  'lists:renameListReplay': 'renameList', 'lists:deleteListReplay': 'deleteList',
};
class ReplayConflict extends Error {
  constructor(message) { super(message); this.errorData = { code: 'REPLAY_CONFLICT', message }; }
}
const findDoc = (account, id) => account.items.find(i => i._id === id) ?? account.lists.find(l => l._id === id);

async function mutation(account, path, args) {
  if (!args.replay) return apply(account, path.replace(/Replay$/, ''), args);
  const operation = REPLAY_TYPES[path];
  if (!operation) throw new Error(`Unimplemented fixture replay: ${path}`);
  const { authToken: _authToken, replay, ...payload } = args;
  const fingerprint = await revision({ operation, payload, expected: replay.expected });
  const previous = account.receipts.find(r => r.operationId === replay.operationId);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new Error('Operation ID reused with different content');
    return previous.ack;
  }
  const targets = replayTargets(operation, payload);
  if (canonical([...targets].sort()) !== canonical(replay.expected.map(e => e.id).sort())) throw new ReplayConflict('Missing expected revision. Review this saved edit before applying it.');
  for (const expected of replay.expected) {
    let wanted = expected.revision;
    if (expected.predecessor) {
      const prior = account.receipts.find(r => r.operationId === expected.predecessor);
      if (!prior?.ack.revisions[expected.id]) throw new ReplayConflict('A preceding local edit has not been acknowledged.');
      wanted = prior.ack.revisions[expected.id];
    }
    const doc = findDoc(account, expected.id);
    if (!doc || await revision(doc) !== wanted) throw new ReplayConflict('This item changed on the server. Your edit is saved for review.');
  }
  const result = await apply(account, path.replace(/Replay$/, ''), payload);
  const revisions = {};
  for (const id of targets) revisions[id] = await revision(findDoc(account, id) ?? null);
  if (typeof result === 'string' && (operation === 'addItem' || operation === 'createList')) revisions[result] = await revision(findDoc(account, result));
  const ack = { operationId: replay.operationId, result, revisions, sequence: ++account.sequence };
  account.receipts.push({ operationId: replay.operationId, fingerprint, ack });
  return ack;
}

async function apply(account, endpoint, args) {
  let result = null;
  const item = account.items.find(i => i._id === args.itemId);
  const list = account.lists.find(l => l._id === args.listId);
  switch (endpoint) {
    case 'actorSession:establish': break;
    case 'referrals:redeemReferral': {
      account.referralRedeemed = true;
      result = {success:true};
      break;
    }
    case 'templates:createListFromTemplate': {
      if (account.options.pendingReferralCode && !account.referralRedeemed) throw new Error('Template created before referral redemption');
      if (args.expectedOwnerDid && args.expectedOwnerDid !== user.did) throw new Error('Account changed');
      const template = BUILTIN_TEMPLATES.find(t => t.id === args.builtinId);
      if (!template) throw new Error('Template not found');
      const previous = account.lists.find(l => l.assetDid === args.assetDid);
      if (previous) { result = previous._id; break; }
      if (account.options.failCreateList || account.lists.length >= 5) throw new Error('PLAN_LIMIT: Free plan allows a maximum of 5 lists');
      result = `lists:created${++account.nextId}`;
      account.lists.push({ _id: result, _creationTime: Date.now(), name: args.listName,
        assetDid: args.assetDid, ownerDid: user.did, createdAt: Date.now() });
      account.items.push(...template.items.map((item, i) => ({ ...item, _id: `items:template${++account.nextId}`,
        _creationTime: Date.now(), listId: result, checked: false, createdByDid: user.did, createdAt: Date.now(), order: i })));
      break;
    }
    case 'lists:createList': {
      if (account.options.failCreateList) throw new Error('PLAN_LIMIT: Free plan allows a maximum of 5 lists');
      result = `lists:created${++account.nextId}`;
      account.lists.push({ _id: result, _creationTime: Date.now(), name: args.name,
        assetDid: args.assetDid, ownerDid: user.did, createdAt: args.createdAt });
      break;
    }
    case 'lists:renameList':
      if (!list) throw new Error('List not found');
      list.name = args.name;
      break;
    case 'lists:deleteList': account.lists = account.lists.filter(l => l._id !== args.listId); break;
    case 'items:addItem': {
      result = `items:created${++account.nextId}`;
      account.items.push({ _id: result, _creationTime: Date.now(), listId: args.listId,
        name: args.name, checked: false, createdByDid: user.did,
        createdAt: args.createdAt, updatedAt: args.createdAt, order: account.items.length });
      break;
    }
    case 'items:checkItem':
    case 'items:uncheckItem':
      if (!item) throw new Error('Item not found');
      item.checked = endpoint === 'items:checkItem';
      item.updatedAt = Date.now();
      break;
    case 'items:removeItem': account.items = account.items.filter(i => i._id !== args.itemId); break;
    case 'publication:publishList': account.published = true; break;
    case 'publication:unpublishList': account.published = false; break;
    case 'referrals:getOrCreateReferralCode': result = 'e2e-code'; break;
    default: throw new Error(`Unimplemented fixture mutation: ${endpoint}`);
  }
  return result;
}

function transition(ws, newVersion = ws.data.version) {
  const account = ws.data.account;
  const modifications = [...ws.data.queries].map(([queryId, { path, args }]) => {
    try {
      return { type: 'QueryUpdated', queryId, value: query(account, path, args), logLines: [] };
    } catch (error) {
      if (!error.errorData) account.errors.push(error.message);
      return { type: 'QueryFailed', queryId, errorMessage: error.message, logLines: [],
        ...(error.errorData ? { errorData: error.errorData } : {}) };
    }
  });
  ws.send(JSON.stringify({ type: 'Transition',
    startVersion: { querySet: ws.data.version, ts: TS_ZERO, identity: 0 },
    endVersion: { querySet: newVersion, ts: TS_ZERO, identity: 0 }, modifications }));
  ws.data.version = newVersion;
}

const backend = Bun.serve({
  hostname: '127.0.0.1', port: 0,
  async fetch(request, server) {
    const url = new URL(request.url);
    if (/\/api\/[^/]+\/sync$/.test(url.pathname)) {
      if (server.upgrade(request, { data: { queries: new Map(), version: 0, account: null, pending: Promise.resolve() } })) return;
    }
    if (url.pathname === '/__e2e/seed' && request.method === 'POST') {
      const account = seed(await request.json());
      return Response.json({ token: account.token, user });
    }
    if (url.pathname === '/__e2e/start') {
      const account = accounts.get(url.searchParams.get('token'));
      const path = url.searchParams.get('path');
      if (!account || !path?.startsWith('/') || path.startsWith('//')) return new Response('Invalid fixture', { status: 400 });
      const storage = { 'poo-cookie-consent': 'declined' };
      if (account.options.pendingReferralCode) storage['poo-referral-code'] = account.options.pendingReferralCode;
      if (account.options.authenticated !== false) {
        storage['lisa-auth-state'] = JSON.stringify({ token: account.token, user });
        storage['lisa-jwt-token'] = account.token;
      }
      if (!account.options.onboarding) {
        storage['poo_onboarding_v1'] = 'done';
        storage['boop:onboarding_demo_created'] = 'done';
      }
      if (account.options.inviteNudgeDone !== false) storage['boop:onboarding_invite_nudge_done'] = 'done';
      const literal = value => JSON.stringify(value).replaceAll('<', '\\u003c');
      return new Response(`<script>for (const [k,v] of Object.entries(${literal(storage)})) localStorage.setItem(k,v); location.replace(${literal(path)});</script>`, {
        headers: { 'content-type': 'text/html' },
      });
    }
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
    const account = accounts.get(token);
    if (url.pathname === '/__e2e/state' && account) {
      return Response.json({ lists: account.lists, items: account.items, calls: account.calls,
        errors: account.errors, published: account.published, receipts: account.receipts.map(r => r.ack) });
    }
    if (url.pathname === '/__e2e/network' && account && request.method === 'POST') {
      // A backend outage for this account only: live sockets drop, and new ones
      // are closed as soon as they identify the account, until it is restored.
      const { online, dropReplayResponses } = await request.json();
      account.offline = !online;
      if (dropReplayResponses !== undefined) account.dropReplayResponses = dropReplayResponses;
      if (account.offline) for (const socket of sockets) if (socket.data.account === account) socket.close();
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/__e2e/collaborator-edit' && account && request.method === 'POST') {
      // Another member's write, committed without any of this client's receipts.
      const { itemId, changes } = await request.json();
      const item = account.items.find(i => i._id === itemId);
      if (!item) return new Response('Unknown item', { status: 404 });
      Object.assign(item, changes, { updatedAt: Date.now() });
      for (const socket of sockets) if (socket.data.account === account) transition(socket);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/__e2e/resume-template' && account && request.method === 'POST') {
      account.options.loseTemplateResponseOnce = false;
      return new Response(null, {status:204});
    }
    if (url.pathname === '/__e2e/account' && request.method === 'DELETE' && account) {
      accounts.delete(token);
      return new Response(null, { status: 204 });
    }
    return new Response('Unknown test endpoint', { status: 404 });
  },
  websocket: {
    open(ws) { sockets.add(ws); },
    close(ws) { sockets.delete(ws); },
    message(ws, raw) {
      // Keep mutations and query-set changes ordered, like Convex's stream.
      ws.data.pending = ws.data.pending.then(async () => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'Connect' || msg.type === 'Authenticate' || msg.type === 'Event') return;
        const args = msg.args?.[0] ?? {};
        if (args.authToken) ws.data.account = accounts.get(args.authToken);
        if (ws.data.account?.offline) { ws.close(); return; }
        if (msg.type === 'ModifyQuerySet') {
          for (const mod of msg.modifications) {
            if (mod.type === 'Remove') ws.data.queries.delete(mod.queryId);
            else {
              const queryArgs = mod.args?.[0] ?? {};
              if (queryArgs.authToken) ws.data.account = accounts.get(queryArgs.authToken);
              if (ws.data.account?.offline) { ws.close(); return; }
              ws.data.queries.set(mod.queryId, { path: mod.udfPath, args: queryArgs });
            }
          }
          transition(ws, msg.newVersion);
          return;
        }
        if (msg.type === 'Mutation') {
          const account = ws.data.account;
          try {
            if (!account) throw new Error('No seeded test account');
            account.calls.push({ path: msg.udfPath, args });
            const result = await mutation(account, msg.udfPath, args);
            if (msg.udfPath === 'templates:createListFromTemplate' && account.options.loseTemplateResponseOnce) {
              // The write committed, but the caller receives an error instead
              // of its acknowledgment. Keep failing retries until the test resumes.
              ws.send(JSON.stringify({ type: 'MutationResponse', requestId: msg.requestId, success: false, result: 'Fixture: committed response lost', logLines: [] }));
              return;
            }
            if (args.replay && account.dropReplayResponses > 0) {
              // The write and its receipt committed; the connection dies first.
              account.dropReplayResponses--;
              for (const socket of sockets) if (socket !== ws && socket.data.account === account) transition(socket);
              ws.close();
              return;
            }
            ws.send(JSON.stringify({ type: 'MutationResponse', requestId: msg.requestId, success: true, result, ts: TS_ZERO, logLines: [] }));
            for (const socket of sockets) if (socket.data.account === account) transition(socket);
          } catch (error) {
            if (!error.message.startsWith('PLAN_LIMIT') && !error.errorData) account?.errors.push(error.message);
            ws.send(JSON.stringify({ type: 'MutationResponse', requestId: msg.requestId, success: false, result: error.message,
              ...(error.errorData ? { errorData: error.errorData } : {}), logLines: [] }));
          }
          return;
        }
        throw new Error(`Unimplemented fixture message: ${msg.type}`);
      }).catch(error => {
        ws.data.account?.errors.push(error.message);
        console.error(error);
      });
    },
  },
});

const backendUrl = `http://127.0.0.1:${backend.port}`;
Object.assign(process.env, {
  VITE_CONVEX_URL: backendUrl, VITE_CONVEX_HTTP_URL: backendUrl,
  VITE_STRIPE_PRO_MONTHLY_PRICE_ID: 'price_e2e_monthly',
  VITE_STRIPE_PRO_YEARLY_PRICE_ID: 'price_e2e_yearly',
  VITE_STRIPE_TEAM_PRICE_ID: 'price_e2e_team',
  VITE_WEBVH_DOMAIN: 'boop.ad', VITE_POSTHOG_KEY: '', VITE_POSTHOG_API_KEY: '', VITE_SENTRY_DSN: '',
});
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
if (!Number.isInteger(port) || port <= 0) throw new Error('Expected --port from the E2E runner');
const vite = await createServer({ server: { host: '127.0.0.1', port, strictPort: true,
  proxy: { '/__e2e': backendUrl } } });
await vite.listen();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  await vite.close();
  backend.stop(true);
  process.exit(0);
});
