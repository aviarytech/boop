// Settings → "Agent enrollment code" (docs/agent-enrollment-codes.md): the flag
// is off by default, and the section mints, shows, copies, counts down and
// revokes. Convex is a fixture; scripts/agent-enrollment-codes.test.mjs covers
// the server.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const React = await import('react');
const { render, fireEvent, screen, cleanup, waitFor, act } = await import('@testing-library/react');

const outdir = 'tmp/agent-enrollment-code-ui';
const CODE = 'BOOP-0123A-BCDEF-GHJKM-NPQRS-TVWXZ';
const state = globalThis.__enrollmentUi = { revision: 0, listeners: new Set() };
state.subscribe = listener => { state.listeners.add(listener); return () => state.listeners.delete(listener); };
state.notify = () => { state.revision++; for (const listener of state.listeners) listener(); };
function reset() {
  Object.assign(state, { listed: [], calls: [], mintError: null, copied: null });
}
Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async text => { state.copied = text; } }, configurable: true });

const convexFixture = `import {useSyncExternalStore} from "react"; import {getFunctionName} from "convex/server"; import {ConvexError} from "convex/values";
  const s = globalThis.__enrollmentUi;
  export function useQuery(){ useSyncExternalStore(s.subscribe, () => s.revision); return s.listed; }
  export function useAction(ref){ return async args => { s.calls.push([getFunctionName(ref), args]);
    if (s.mintError) throw new ConvexError(s.mintError);
    const row = { id: "C" + (s.listed.length + 1), label: args.label ?? null, createdAt: Date.now(), expiresAt: Date.now() + 15 * 60_000 };
    s.listed = [...s.listed, row]; s.notify(); return { ...row, code: ${JSON.stringify(CODE)} }; }; }
  export function useMutation(ref){ return async args => { s.calls.push([getFunctionName(ref), args]);
    s.listed = s.listed.filter(row => row.id !== args.codeId); s.notify(); return null; }; }`;
await build({
  entryPoints: ['src/components/AgentEnrollmentCode.tsx'], outfile: `${outdir}/section.mjs`, bundle: true, jsx: 'automatic', platform: 'node', format: 'esm',
  external: ['react', 'react/jsx-runtime', 'convex/*'], logLevel: 'error',
  plugins: [{ name: 'enrollment-ui-fixtures', setup(b) {
    b.onResolve({ filter: /lib\/authenticatedConvex$/ }, () => ({ path: 'convex', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: convexFixture, resolveDir: process.cwd() }));
  } }],
});
const { AgentEnrollmentCode } = await import(pathToFileURL(`${process.cwd()}/${outdir}/section.mjs`));
const mount = () => render(React.createElement(AgentEnrollmentCode));
afterEach(cleanup);

async function flag(value) {
  const outfile = `${outdir}/flags-${value}.mjs`;
  await build({ entryPoints: ['src/lib/featureFlags.ts'], outfile, bundle: true, format: 'esm', logLevel: 'error',
    define: { 'import.meta.env.VITE_AGENT_ENROLLMENT_CODES': value === undefined ? 'undefined' : JSON.stringify(value) } });
  return (await import(pathToFileURL(`${process.cwd()}/${outfile}`))).AGENT_ENROLLMENT_CODES_ENABLED;
}

test('the flag is off unless VITE_AGENT_ENROLLMENT_CODES is exactly "true"', async () => {
  assert.equal(await flag(undefined), false);
  assert.equal(await flag('1'), false);
  assert.equal(await flag('false'), false);
  assert.equal(await flag('true'), true);
});

test('creating a code shows it once with a countdown, and Copy copies it', async () => {
  reset(); mount();
  assert.equal(screen.queryByLabelText('Enrollment code'), null);
  fireEvent.change(screen.getByLabelText('Label for the code'), { target: { value: ' Shopping bot ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create code' }));
  const field = await screen.findByLabelText('Enrollment code');
  assert.equal(field.value, CODE);
  assert.deepEqual(state.calls, [['agentEnrollment:mintEnrollmentCode', { label: 'Shopping bot' }]]);
  assert.match(screen.getByRole('timer').textContent, /^Shopping bot · Expires in (15:00|14:5\d)$/);
  assert.equal(screen.queryByRole('button', { name: 'Create code' }), null, 'one code on screen at a time');

  fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  await screen.findByRole('button', { name: 'Copied!' });
  assert.equal(state.copied, CODE);
});

test('an unlabelled mint sends no label, and a refusal shows the server message', async () => {
  reset(); state.mintError = { kind: 'enrollment', code: 'TOO_MANY_ACTIVE', message: 'You have 5 unused codes. Revoke one or wait for it to expire.' };
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Create code' }));
  assert.match((await screen.findByRole('alert')).textContent, /5 unused codes/);
  assert.deepEqual(state.calls, [['agentEnrollment:mintEnrollmentCode', {}]]);
  assert.equal(screen.queryByLabelText('Enrollment code'), null);
  assert.ok(screen.getByRole('button', { name: 'Create code' }));
});

// The countdown is driven by hand: the clock and the section's one-second tick
// are stubbed, so the test doesn't wait on, or depend on, real timers.
test('the countdown runs down and the code leaves the screen when it expires', async () => {
  reset();
  const realNow = Date.now, realSetInterval = globalThis.setInterval;
  let now = realNow(), tick = null;
  Date.now = () => now;
  globalThis.setInterval = (fn, ms, ...rest) => (ms === 1000 ? (tick = fn, 0) : realSetInterval(fn, ms, ...rest));
  try {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Create code' }));
    await screen.findByLabelText('Enrollment code');
    assert.equal(screen.getByRole('timer').textContent, 'Expires in 15:00');
    now += 61_000; act(() => tick());
    assert.equal(screen.getByRole('timer').textContent, 'Expires in 13:59');
    now += 14 * 60_000 - 2000; act(() => tick());
    assert.equal(screen.getByRole('timer').textContent, 'Expires in 0:01');
    now += 1000; act(() => tick());
    assert.equal(screen.queryByLabelText('Enrollment code'), null);
    assert.ok(screen.getByRole('button', { name: 'Create code' }));
  } finally {
    Date.now = realNow; globalThis.setInterval = realSetInterval;
  }
});

test('the code leaves the screen once it is redeemed or revoked elsewhere', async () => {
  reset(); mount();
  fireEvent.click(screen.getByRole('button', { name: 'Create code' }));
  await screen.findByLabelText('Enrollment code');
  act(() => { state.listed = []; state.notify(); });
  await waitFor(() => assert.equal(screen.queryByLabelText('Enrollment code'), null));
});

test('codes from earlier are listed without their code and can be revoked', async () => {
  reset();
  state.listed = [
    { id: 'C1', label: 'Calendar sync', createdAt: Date.now(), expiresAt: Date.now() + 5 * 60_000 },
    { id: 'C2', label: null, createdAt: Date.now(), expiresAt: Date.now() - 1 },
  ];
  mount();
  const items = screen.getAllByRole('listitem');
  assert.equal(items.length, 1, 'an expired code is not listed');
  assert.match(items[0].textContent, /^Calendar sync · expires in (5:00|4:5\d)Revoke$/);
  assert.equal(screen.queryByLabelText('Enrollment code'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
  await waitFor(() => assert.equal(screen.queryAllByRole('listitem').length, 0));
  assert.deepEqual(state.calls, [['agentEnrollment:revokeEnrollmentCode', { codeId: 'C1' }]]);
});

test('revoking the code on screen returns to the create form', async () => {
  reset(); mount();
  fireEvent.click(screen.getByRole('button', { name: 'Create code' }));
  await screen.findByLabelText('Enrollment code');
  fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
  await screen.findByRole('button', { name: 'Create code' });
  assert.deepEqual(state.calls.at(-1), ['agentEnrollment:revokeEnrollmentCode', { codeId: 'C1' }]);
});
