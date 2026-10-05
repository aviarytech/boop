import { expect } from 'e2e';
import { test } from './fixtures/app';
import { AGENT_RUNBOOKS } from '../convex/lib/templateCatalog';

test('public gallery exposes all ten linked runbooks and handles unknown slugs', async ({ scenario, screen, app }) => {
  await scenario.open('/templates', { authenticated: false });
  await expect(screen.getByRole('heading', 'Agent runbooks for work you can review.')).toBeVisible({ timeout: 15000 });
  for (const template of AGENT_RUNBOOKS) {
    await expect(screen.getByRole('link', `${template.name} →`)).toHaveAttribute('href', `/templates/${template.id}`);
  }
  await app.open('/templates/not-a-public-template');
  await expect(screen.getByRole('heading', 'Template not found')).toBeVisible();
});

test('template selection survives signup and creates every runbook step', async ({ scenario, screen, browser }) => {
  await scenario.open('/templates/release-checklist', { authenticated: false, onboarding: false, pendingReferralCode: 'friend-code' });
  await expect(screen.getByRole('heading', 'Release checklist', { level: 1 })).toBeVisible();
  await screen.getByRole('button', 'Use this template').click();
  await expect(browser).toHaveURL('/login?template=release-checklist');
  await screen.getByLabel('Email address').fill('new@example.test');
  await screen.getByRole('button', 'Send Code').click();
  for (let i = 1; i <= 6; i++) await screen.getByLabel(`Digit ${i}`, { exact: true }).fill(String(i));
  await expect(screen.getByRole('heading', 'Release checklist', { level: 1 })).toBeVisible({ timeout: 15000 });
  const state = await scenario.state();
  expect(state.lists.length).toBe(1);
  expect(state.items.map(i => i.name)).toEqual(AGENT_RUNBOOKS[0].items.map(i => i.name));
  expect(state.calls.filter(c => c.path === 'templates:createListFromTemplate').length).toBe(1);
  expect(state.calls.findIndex(c => c.path === 'referrals:redeemReferral') < state.calls.findIndex(c => c.path === 'templates:createListFromTemplate')).toBe(true);
  expect(state.calls.some(c => c.path === 'referrals:redeemReferral')).toBe(true);
});

test('authenticated continuation creates once and quota failure remains retryable', async ({ scenario, screen, browser }) => {
  await scenario.open('/login?template=ci-triage', { lists: 5, failCreateList: true });
  await expect(screen.getByRole('alert')).toContainText("You've reached the free plan limit");
  await expect(browser).toHaveURL('/templates/ci-triage/use');
  expect((await scenario.state()).lists.length).toBe(5);
  await screen.getByRole('button', 'Retry template creation').click();
  await expect(screen.getByRole('alert')).toContainText("You've reached the free plan limit");
  expect((await scenario.state()).items.length).toBe(0);
});

test('arbitrary login destinations cannot become template continuations', async ({ scenario, browser }) => {
  await scenario.open('/login?template=https://evil.test');
  await expect(browser).toHaveURL('/d');
  expect((await scenario.state()).lists.length).toBe(0);
});

test('lost success response and reload retry reuse the committed template at quota', async ({ scenario, screen, app, browser }) => {
  await scenario.open('/templates/release-checklist/use', { lists: 4, loseTemplateResponseOnce: true });
  await expect.poll(async () => (await scenario.state()).lists.length).toBe(5);
  await expect(screen.getByRole('alert')).toContainText('Failed to create list');
  expect((await scenario.state()).lists.length).toBe(5);
  await app.open('/templates/release-checklist');
  await scenario.resumeTemplateResponses();
  await screen.getByRole('button', 'Use this template').click();
  await expect(screen.getByRole('heading', 'Release checklist', { level: 1 })).toBeVisible();
  // Wait for the app list instead of the same heading on the source page.
  await expect(browser).toHaveURL(/\/list\/lists:created/);
  const state = await scenario.state();
  expect(state.lists.length).toBe(5);
  expect(state.items.length).toBe(6);
  const attempts = state.calls.filter(c => c.path === 'templates:createListFromTemplate');
  expect(attempts.length >= 2).toBe(true);
  expect(new Set(attempts.map(a => a.args.assetDid)).size).toBe(1);
});
