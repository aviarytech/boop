// Ported from e2e/onboarding.spec.ts at 1c61e19^.
import { expect, type TestFixtures } from 'e2e';
import { test, openCreateList } from './fixtures/app';

async function createList(screen: TestFixtures['screen'], name = 'My First Real List') {
  await openCreateList(screen);
  await screen.getByLabel('List name').fill(name);
  await screen.getByLabel('List name').press('Enter');
  await expect(screen.getByRole('heading', 'List created!')).toBeVisible();
}

test('new user: the two-step onboarding suppresses the legacy four-step overlay', async ({ scenario, screen }) => {
  await scenario.open('/d', { onboarding: true });
  await expect(screen.getByRole('heading', 'Getting Started')).toBeVisible();
  await expect(screen.getByRole('heading', 'Welcome to boop.')).toHaveCount(0);
});

test('new user: demo creation finishes and sets the persisted flag', async ({ scenario, screen, browser }) => {
  await scenario.open('/d', { onboarding: true });
  await expect(screen.getByRole('heading', 'Getting Started')).toBeVisible();
  await expect.poll(() => browser.evaluate(() => localStorage.getItem('boop:onboarding_demo_created'))).toBe('done');
  const state = await scenario.state();
  expect(state.lists.map(list => list.name)).toEqual(['Getting Started']);
  expect(state.items.map(item => item.name)).toEqual(['Add your first item', 'Share this list with someone', 'Check off a task']);
});

test('existing user: demo creation is skipped and marked done', async ({ scenario, screen, browser }) => {
  await scenario.open('/d', { lists: 1, onboarding: true });
  await expect(screen.getByRole('heading', 'Test List 1')).toBeVisible();
  await expect.poll(() => browser.evaluate(() => localStorage.getItem('boop:onboarding_demo_created'))).toBe('done');
  expect((await scenario.state()).calls.filter(call => call.path === 'lists:createList')).toEqual([]);
});

test('InviteNudge appears after the first real list is created', async ({ scenario, screen }) => {
  await scenario.open('/d', { lists: 1, onboarding: true, inviteNudgeDone: false });
  await createList(screen);
  await expect(screen.getByRole('heading', 'Invite someone to collaborate')).toBeVisible();
  await expect(screen.getByRole('button', 'Invite someone →')).toBeVisible();
  await expect(screen.getByRole('button', 'Later')).toBeVisible();
});

test('Later dismisses InviteNudge and persists the dismissal', async ({ scenario, screen, browser }) => {
  await scenario.open('/d', { lists: 1, onboarding: true, inviteNudgeDone: false });
  await createList(screen);
  await expect(screen.getByRole('heading', 'Invite someone to collaborate')).toBeVisible();
  await screen.getByRole('button', 'Later').tap();
  await expect(screen.getByRole('heading', 'Invite someone to collaborate')).toBeHidden();
  expect(await browser.evaluate(() => localStorage.getItem('boop:onboarding_invite_nudge_done'))).toBe('done');
});

test('a dismissed InviteNudge does not appear after another list is created', async ({ scenario, screen }) => {
  await scenario.open('/d', { lists: 1, onboarding: true, inviteNudgeDone: true });
  await createList(screen, 'Another List');
  await expect(screen.getByRole('heading', 'Invite someone to collaborate')).toHaveCount(0);
});
