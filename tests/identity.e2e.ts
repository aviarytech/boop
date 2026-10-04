import { expect } from 'e2e';
import { test } from './fixtures/app';

test('unauthenticated user at /d redirects to /login', async ({ scenario, browser }) => {
  await scenario.open('/d', { authenticated: false });
  await expect(browser).toHaveURL('/login');
});

test('login page shows email OTP form', async ({ scenario, screen }) => {
  await scenario.open('/login', { authenticated: false });
  await expect(screen.getByLabel('boop')).toBeVisible();
  await expect(screen.getByPlaceholder('you@example.com')).toBeVisible();
  await expect(screen.getByRole('button', /Send Code/i)).toBeVisible();
});

test('authenticated user at /login is redirected to /d', async ({ scenario, browser, screen }) => {
  await scenario.open('/login');
  await expect(browser).toHaveURL('/d');
  await expect(screen.getByRole('heading', /Your lists|Welcome in/i)).toBeVisible();
  expect((await scenario.state()).calls.some(call => call.path === 'actorSession:establish')).toBe(true);
});

test('auth session persists after page reload', async ({ scenario, browser, screen }) => {
  await scenario.open('/d');
  await expect(screen.getByRole('heading', /Your lists|Welcome in/i)).toBeVisible();
  const before = (await scenario.state()).calls.filter(call => call.path === 'actorSession:establish').length;
  await browser.reload();
  await expect(browser).toHaveURL('/d');
  await expect(screen.getByRole('heading', /Your lists|Welcome in/i)).toBeVisible();
  expect((await scenario.state()).calls.filter(call => call.path === 'actorSession:establish').length).toBeGreaterThan(before);
});
