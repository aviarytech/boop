// Edit sessions on the device (src/lib/editSessions.ts): a run of saves of one
// item is signed once, when the run ends. The server half is covered in
// scripts/signed-action-records.test.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

await build({
  stdin: { contents: 'export * from "./src/lib/actionSigner.ts"; export * from "./src/lib/editSessions.ts";', resolveDir: process.cwd(), loader: 'ts' },
  outfile: 'tmp/edit-sessions/client.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
});
const client = await import(pathToFileURL(`${process.cwd()}/tmp/edit-sessions/client.mjs`));
const { sendWithActionRecords, setActionSigner, setEditRecorder, flushEditSession, flushEditSessions, resetEditSessions, EDIT_SESSION_IDLE_MS } = client;
const digest = text => ({ sha256: createHash('sha256').update(text).digest('hex') });

// The idle timer, held still: tests see what was armed and fire it themselves.
const realTimers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
let timers;
function holdTimers() {
  timers = new Map();
  let next = 0;
  globalThis.setTimeout = (fn, ms) => { timers.set(++next, { fn, ms }); return next; };
  globalThis.clearTimeout = id => { timers.delete(id); };
}
const armed = () => [...timers.values()].map(t => t.ms);
async function idle() {
  const due = [...timers.entries()];
  timers.clear();
  for (const [, timer] of due) await timer.fn();
  await new Promise(resolve => realTimers.setTimeout(resolve, 0));
}
afterEach(() => { Object.assign(globalThis, realTimers); resetEditSessions(); setEditRecorder(null); setActionSigner(null); });

/** A device with a recorder installed, a server that takes saves, and a log of both. */
function device({ failRecords = 0 } = {}) {
  holdTimers();
  const sent = [], records = [], signedDirectly = [];
  setActionSigner(async (mutation, args) => { signedDirectly.push([mutation, args]); return { signatures: [] }; });
  setEditRecorder(async (itemId, editSession, after) => {
    if (failRecords-- > 0) throw new Error('offline');
    records.push({ itemId, editSession, after });
  });
  const save = (args, server = async () => 'ok') => sendWithActionRecords('updateItem', args, async prepared => { sent.push(prepared); return server(prepared); });
  return { sent, records, signedDirectly, save };
}

test('successive saves of one item share a session and are recorded once, after the idle period, with each field\'s final value', async () => {
  const d = device();
  assert.equal(EDIT_SESSION_IDLE_MS, 5000);
  assert.equal(await d.save({ itemId: 'I1', description: 'Dra', expectedDescription: '' }), 'ok');
  await d.save({ itemId: 'I1', description: 'Draft', expectedDescription: 'Dra' });
  await d.save({ itemId: 'I1', name: 'Plan', url: 'https://a.example' });
  await d.save({ itemId: 'I1', description: 'Draft two', clearUrl: true, priority: 'high' });

  // Every save went out at once, unsigned, under one session id; nothing is recorded while the run continues.
  assert.equal(d.sent.length, 4);
  assert.deepEqual([...new Set(d.sent.map(args => args.editSession))].length, 1);
  assert.match(d.sent[0].editSession, /^[0-9a-f-]{36}$/);
  assert.ok(d.sent.every(args => args.signed === undefined));
  assert.deepEqual([d.signedDirectly, d.records], [[], []]);
  // One timer is armed, counted from the last save.
  assert.deepEqual(armed(), [EDIT_SESSION_IDLE_MS]);

  await idle();
  assert.deepEqual(d.records, [{ itemId: 'I1', editSession: d.sent[0].editSession,
    after: { description: digest('Draft two'), name: 'Plan', url: null, priority: 'high' } }]);
  assert.deepEqual(armed(), []);

  // The next save opens a new session, with its own record.
  await d.save({ itemId: 'I1', name: 'Plan B' });
  assert.notEqual(d.sent[4].editSession, d.sent[0].editSession);
  await idle();
  assert.deepEqual(d.records.map(r => r.after), [d.records[0].after, { name: 'Plan B' }]);
});

test('each item has its own session, a failed save is no part of one, and a save that sets nothing recordable leaves nothing to sign', async () => {
  const d = device();
  await d.save({ itemId: 'I1', name: 'One' });
  await d.save({ itemId: 'I2', name: 'Two' });
  await assert.rejects(d.save({ itemId: 'I1', name: 'Rejected', priority: 'low' }, async () => { throw new Error('NOTE_CONFLICT'); }), /NOTE_CONFLICT/);
  await d.save({ itemId: 'I3', assigneeDids: ['did:someone'] });
  assert.notEqual(d.sent[0].editSession, d.sent[1].editSession);
  assert.equal(d.sent[2].editSession, d.sent[0].editSession);
  assert.deepEqual(armed(), [EDIT_SESSION_IDLE_MS, EDIT_SESSION_IDLE_MS], 'nothing is armed for the assignment-only save');
  await idle();
  assert.deepEqual(d.records.map(r => [r.itemId, r.after]).sort(), [['I1', { name: 'One' }], ['I2', { name: 'Two' }]]);
});

test('closing a session records it at once; with a save in flight it waits for the answer, so the record never races the save', async () => {
  const d = device();
  await d.save({ itemId: 'I1', name: 'One' });
  await flushEditSession('I1');
  assert.deepEqual(d.records.map(r => r.after), [{ name: 'One' }]);
  assert.deepEqual(armed(), [], 'the idle timer is cancelled by the flush');
  await flushEditSession('I1');
  assert.equal(d.records.length, 1, 'a closed session is not recorded twice');

  let answer;
  const inflight = d.save({ itemId: 'I1', description: 'slow' }, () => new Promise(resolve => { answer = resolve; }));
  await d.save({ itemId: 'I1', name: 'Two' });
  assert.deepEqual(armed(), [], 'not while a save of the item is unanswered');
  await flushEditSession('I1');
  assert.equal(d.records.length, 1);
  answer('ok');
  await inflight;
  await new Promise(resolve => realTimers.setTimeout(resolve, 0));
  assert.deepEqual(d.records[1].after, { name: 'Two', description: digest('slow') });
  assert.deepEqual(armed(), []);
});

test('flushing everything closes each open session (navigation, list switch, tab hidden, unload) and retries records that could not be sent', async () => {
  const d = device({ failRecords: 1 });
  await d.save({ itemId: 'I1', name: 'One' });
  await d.save({ itemId: 'I2', description: 'Two' });
  await flushEditSessions();
  // One record went out; the other could not be sent and is kept, under its own session id.
  assert.equal(d.records.length, 1);
  assert.deepEqual(armed(), []);
  await d.save({ itemId: d.records[0].itemId === 'I1' ? 'I2' : 'I1', priority: 'low' });
  await flushEditSessions();
  assert.deepEqual(d.records.map(r => [r.itemId, r.after]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), [
    ['I1', { name: 'One' }], ['I2', { description: digest('Two') }], [d.sent[2].itemId, { priority: 'low' }],
  ].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  assert.equal(new Set(d.records.map(r => r.editSession)).size, 3, 'the retried record keeps the session the server filed its saves under');
  await flushEditSessions();
  assert.equal(d.records.length, 3, 'nothing is left to flush');

  // A record that keeps failing is given up after three attempts, not retried for ever.
  const e = device({ failRecords: 10 });
  const warn = console.warn; const warnings = []; console.warn = (...args) => warnings.push(args);
  try {
    await e.save({ itemId: 'I1', name: 'Lost' });
    for (let attempt = 0; attempt < 5; attempt++) await flushEditSessions();
  } finally { console.warn = warn; }
  assert.deepEqual([e.records, warnings.length], [[], 1]);
});

test('without a recorder each save is signed and recorded on its own, and other mutations are signed as before', async () => {
  holdTimers();
  const signedDirectly = [], sent = [];
  setActionSigner(async (mutation, args) => { signedDirectly.push(mutation); return { signatures: [], for: args.itemId }; });
  const send = (mutation, args) => sendWithActionRecords(mutation, args, async prepared => { sent.push(prepared); });
  await send('updateItem', { itemId: 'I1', name: 'One' });
  assert.deepEqual([sent[0].editSession, sent[0].signed, armed()], [undefined, { signatures: [], for: 'I1' }, []]);

  setEditRecorder(async () => {});
  await send('checkItem', { itemId: 'I1' });
  await send('removeItem', { itemId: 'I1' });
  await send('reorderItems', { listId: 'L1', itemIds: ['I1'] });
  assert.deepEqual(sent.slice(1).map(args => [args.editSession, args.signed !== undefined]), [[undefined, true], [undefined, true], [undefined, false]]);
  assert.deepEqual(signedDirectly, ['updateItem', 'checkItem', 'removeItem']);
  // A save a caller already signed, or already filed under a session, is sent as given.
  await send('updateItem', { itemId: 'I1', name: 'Two', signed: { signatures: [] } });
  await send('updateItem', { itemId: 'I1', name: 'Three', editSession: 'chosen' });
  assert.deepEqual(sent.slice(4).map(args => args.editSession), [undefined, 'chosen']);
  assert.deepEqual(armed(), []);
});
