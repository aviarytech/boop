// Execute the actual component handlers with synchronous hook-state doubles.
// This covers the async state race, not React rendering or browser behavior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(process.env.ADD_ITEM_SOURCE ?? new URL('../src/components/AddItemInput.tsx', import.meta.url), 'utf8');
const start = source.includes('  const submitItem = async') ? source.indexOf('  const submitItem = async') : source.indexOf('  const handleSubmit = async');
assert.ok(start >= 0, 'component submission handlers must exist');
const end = source.indexOf('\n  return (', start);
assert.ok(end > start, 'handler boundary must exist');
// The handler block uses just these two type annotations; do not duplicate its logic.
const handlers = source.slice(start, end).replace(/: (ItemSubmission|FormEvent)\b/g, '');
const keys = ['name', 'isAdding', 'did', 'legacyDid', 'setName', 'setIsAdding', 'setFailedItems', 'pendingRef', 'nextSubmissionId', 'submissionsRef', 'mountedRef', 'inputRef', 'haptic', 'onAddItem', 'console'];
const compile = new Function(...keys, handlers + '\nreturn { handleSubmit, handleRetry: typeof handleRetry === "function" ? handleRetry : undefined };');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture() {
  const state = { name: '', isAdding: false, failedItems: [], calls: [], requests: [], feedback: [], focus: 0 };
  const env = {
    did: 'did:owner', legacyDid: undefined,
    setName: value => { state.name = typeof value === 'function' ? value(state.name) : value; },
    setIsAdding: value => { state.isAdding = value; },
    setFailedItems: value => { state.failedItems = typeof value === 'function' ? value(state.failedItems) : value; },
    pendingRef: { current: false }, nextSubmissionId: { current: 0 }, submissionsRef: { current: new Map() }, mountedRef: { current: true },
    inputRef: { current: { focus: () => state.focus++ } },
    haptic: value => state.feedback.push(value), console: { error() {} },
    onAddItem: args => { const request = deferred(); state.calls.push(args); state.requests.push(request); return request.promise; },
  };
  const render = () => compile(...keys.map(key => key in state ? state[key] : env[key]));
  return { state, env, render, submit: () => render().handleSubmit({ preventDefault() {} }) };
}

test('reject A after typing B: preserve B and retain A for explicit retry', async () => {
  const f = fixture(); f.state.name = ' A ';
  const pending = f.submit();
  assert.equal(f.state.name, '');
  f.state.name = 'B'; f.state.requests[0].reject(new Error('queue unavailable')); await pending;
  assert.equal(f.state.name, 'B');
  assert.equal(f.state.failedItems.length, 1);
  assert.equal(f.state.failedItems[0].args.name, 'A');
  assert.equal(f.state.isAdding, false);
});

test('retry A preserves newer input and removes only A after local acceptance', async () => {
  const f = fixture(); f.state.name = 'A'; const first = f.submit();
  f.state.name = 'B'; f.state.requests[0].reject(new Error('queue unavailable')); await first;
  const a = f.state.failedItems[0];
  const retry = f.render().handleRetry(a);
  assert.equal(f.state.name, 'B');
  assert.deepEqual(f.state.calls[1], f.state.calls[0]);
  f.state.name = 'B edited'; f.state.requests[1].resolve(); await retry;
  assert.equal(f.state.name, 'B edited'); assert.deepEqual(f.state.failedItems, []);
  await f.render().handleRetry(a); // a stale click cannot add an accepted item again
  assert.equal(f.state.calls.length, 2);
});

test('repeated failure keeps one retry entry; multiple failed items do not overwrite each other', async () => {
  const f = fixture(); f.state.name = 'A'; const a = f.submit(); f.state.requests[0].reject(new Error('no space')); await a;
  const retry = f.render().handleRetry(f.state.failedItems[0]); f.state.requests[1].reject(new Error('no space')); await retry;
  assert.equal(f.state.failedItems.length, 1);
  f.state.name = 'A'; const another = f.submit(); f.state.requests[2].reject(new Error('no space')); await another;
  assert.equal(f.state.failedItems.length, 2);
  assert.notEqual(f.state.failedItems[0].id, f.state.failedItems[1].id);
  const successfulRetry = f.render().handleRetry(f.state.failedItems[0]); f.state.requests[3].resolve(); await successfulRetry;
  assert.equal(f.state.failedItems.length, 1);
});

test('two immediate submits or retry clicks make only one local acceptance attempt', async () => {
  const f = fixture(); f.state.name = 'A';
  const rendered = f.render(); const first = rendered.handleSubmit({ preventDefault() {} });
  await rendered.handleSubmit({ preventDefault() {} });
  assert.equal(f.state.calls.length, 1);
  f.state.requests[0].reject(new Error('no space')); await first;
  const failed = f.state.failedItems[0]; const retry = f.render(); const next = retry.handleRetry(failed);
  await retry.handleRetry(failed); assert.equal(f.state.calls.length, 2);
  f.state.requests[1].resolve(); await next;
});

for (const fails of [false, true]) test(`late ${fails ? 'failure' : 'success'} after unmount cannot change draft or feedback`, async () => {
  const f = fixture(); f.state.name = 'A'; const pending = f.submit();
  f.state.name = 'New context'; f.env.mountedRef.current = false;
  const before = structuredClone(f.state.feedback);
  if (fails) f.state.requests[0].reject(new Error('late')); else f.state.requests[0].resolve();
  await pending;
  assert.equal(f.state.name, 'New context'); assert.deepEqual(f.state.feedback, before); assert.deepEqual(f.state.failedItems, []);
});

test('empty input or missing identity never submits; success preserves the next draft', async () => {
  const f = fixture(); f.state.name = ' '; await f.submit();
  f.state.name = 'A'; f.env.did = undefined; await f.submit(); assert.equal(f.state.calls.length, 0);
  f.env.did = 'did:owner'; const pending = f.submit(); f.state.name = 'B'; f.state.requests[0].resolve(); await pending;
  assert.equal(f.state.name, 'B'); assert.equal(f.state.isAdding, false); assert.deepEqual(f.state.failedItems, []);
});

test('source integration scopes draft by account/list and exposes explicitly ephemeral retries', () => {
  assert.match(source, /key=\{JSON\.stringify\(\[did, props\.assetDid\]\)\}/);
  assert.match(source, /return \(\) => \{ mountedRef\.current = false; \}/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /Keep this page open to retry them/);
  assert.match(source, /onClick=\{\(\) => void handleRetry\(item\)\}/);
  assert.match(source, /aria-label=\{`Retry adding \$\{item\.args\.name\}`\}/);
});
