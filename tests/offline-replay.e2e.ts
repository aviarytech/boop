// Issue #238: queued offline edits replay against a fixture that enforces the
// same receipt and expected-revision rules as convex/lib/replay.ts.
import { expect, type TestFixtures } from 'e2e';
import type { Browser } from '@e2e-dev/web';
import { test, openList, type Scenario } from './fixtures/app';

const BREAD = 'items:mockitem0';

async function goOffline(scenario: Scenario, browser: Browser) {
  await scenario.setBackend({ online: false });
  await browser.evaluate(() => window.dispatchEvent(new Event('offline')));
}

async function goOnline(scenario: Scenario, browser: Browser, dropReplayResponses?: number) {
  await scenario.setBackend({ online: true, dropReplayResponses });
  await browser.evaluate(() => window.dispatchEvent(new Event('online')));
}

async function checkBread(screen: TestFixtures['screen']) {
  await screen.getByRole('button', { name: 'Check Bread' }).click();
  // Checked items move into the collapsible Done section.
  await screen.getByRole('button', { name: /^Done/ }).click({ timeout: 5000 });
  await expect(screen.getByRole('button', { name: 'Uncheck Bread' })).toBeVisible({ timeout: 5000 });
}

async function eventually<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeout = 20_000): Promise<T> {
  const deadline = Date.now() + timeout;
  let value = await read();
  while (!accept(value) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
    value = await read();
  }
  return value;
}

test.describe('Offline replay', () => {
  test('check then uncheck while offline, across a reload, replays both edits in order', async ({ screen, browser, scenario }) => {
    await openList(scenario, screen, { items: [{ name: 'Bread' }] });
    await goOffline(scenario, browser);

    await checkBread(screen);
    await screen.getByRole('button', { name: 'Uncheck Bread' }).click();
    await expect(screen.getByRole('button', { name: 'Check Bread' })).toBeVisible({ timeout: 5000 });

    // Both edits must survive a reload before the backend is reachable again.
    // (The signed-in shell itself waits for the backend, so nothing renders yet.)
    await browser.reload();
    await expect(screen.getByText('Loading...')).toBeVisible({ timeout: 10_000 });
    expect((await scenario.state()).receipts).toEqual([]);

    await goOnline(scenario, browser);
    await eventually(scenario.state, s => s.receipts.length >= 2 || s.calls.some(c => c.path === 'items:uncheckItemReplay'));
    await expect(screen.getByRole('button', { name: 'Check Bread' })).toBeVisible({ timeout: 10_000 });
    const state = await eventually(scenario.state, s => s.receipts.length >= 2, 5000);
    // The user's final intent (unchecked) reached the server, and neither edit was dropped.
    expect(state.items.find(i => i._id === BREAD)?.checked).toBe(false);
    expect(state.receipts).toHaveLength(2);

    const replays = state.calls.filter(c => c.path.endsWith('Replay'));
    expect(replays.map(c => c.path)).toEqual(['items:checkItemReplay', 'items:uncheckItemReplay']);
    const [check, uncheck] = replays.map(c => c.args.replay as { operationId: string; expected: { id: string; predecessor?: string }[] });
    // The uncheck is based on the check's acknowledgment, not on a clock or a
    // fresh read, so the check's own write is never mistaken for a conflict.
    expect(uncheck.expected).toEqual([expect.objectContaining({ id: BREAD, predecessor: check.operationId })]);
    expect(state.receipts.map(r => r.operationId)).toEqual([check.operationId, uncheck.operationId]);
    await expect(screen.getByText(/saved edit\(s\) awaiting sync/)).not.toBeVisible({ timeout: 10_000 });
  });

  test('a lost acknowledgment is retried with the same operation ID and applied once', async ({ screen, browser, scenario }) => {
    await openList(scenario, screen, { items: [{ name: 'Bread' }] });
    await goOffline(scenario, browser);
    await checkBread(screen);

    // The check commits on reconnect, but its response never reaches the client.
    await goOnline(scenario, browser, 1);
    let state = await eventually(scenario.state, s => s.calls.filter(c => c.path === 'items:checkItemReplay').length >= 2);
    const sent = state.calls.filter(c => c.path === 'items:checkItemReplay').map(c => (c.args.replay as { operationId: string }).operationId);
    expect(new Set(sent).size).toBe(1);
    expect(state.receipts.map(r => r.operationId)).toEqual([sent[0]]);

    // A later edit chains through the recovered receipt instead of conflicting.
    await screen.getByRole('button', { name: 'Uncheck Bread' }).click();
    state = await eventually(scenario.state, s => s.receipts.length >= 2);
    expect(state.receipts).toHaveLength(2);
    expect(state.items.find(i => i._id === BREAD)?.checked).toBe(false);
    await expect(screen.getByText(/saved edit\(s\) awaiting sync/)).not.toBeVisible({ timeout: 10_000 });
  });

  test("another member's concurrent edit surfaces as a recoverable conflict", async ({ screen, browser, scenario }) => {
    await openList(scenario, screen, { items: [{ name: 'Bread' }] });
    await goOffline(scenario, browser);
    await checkBread(screen);

    await scenario.collaboratorEdit(BREAD, { name: 'Rye bread' });
    await goOnline(scenario, browser);

    // Never last-write-wins over the collaborator, and never silently dropped.
    const recovery = screen.getByText('1 saved edit(s) awaiting sync');
    await expect(recovery).toBeVisible({ timeout: 20_000 });
    let state = await scenario.state();
    expect(state.receipts).toEqual([]);
    expect(state.items.find(i => i._id === BREAD)).toEqual(expect.objectContaining({ name: 'Rye bread', checked: false }));

    await recovery.click();
    await expect(screen.getByText('This item changed on the server. Your edit is saved for review.')).toBeVisible();
    await screen.getByRole('button', 'Review conflict').click();
    await screen.getByRole('button', 'Apply saved edit to this version').click();

    state = await eventually(scenario.state, s => s.receipts.length >= 1);
    expect(state.items.find(i => i._id === BREAD)).toEqual(expect.objectContaining({ name: 'Rye bread', checked: true }));
    await expect(screen.getByText(/saved edit\(s\) awaiting sync/)).not.toBeVisible({ timeout: 10_000 });
  });
});
