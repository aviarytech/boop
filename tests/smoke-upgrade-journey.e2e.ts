// Ported from e2e/smoke-upgrade-journey.spec.ts at 1c61e19^.
import { expect, type TestFixtures } from 'e2e';
import { test, openCreateList, CHECKOUT_URL } from './fixtures/app';

async function submitEmail(screen: TestFixtures['screen']) {
  await screen.getByPlaceholder('you@example.com').fill('e2e@example.test');
  await screen.getByRole('button', /Send Code/i).tap();
  await expect(screen.getByLabel('Digit 1')).toBeVisible();
}

test('landing page loads with branding', async ({ scenario, screen }) => {
  await scenario.open('/', { authenticated: false });
  await expect(screen.getByRole('heading', /The todo list your AI agents can use/, { level: 1 })).toBeVisible();
});

test('direct navigation to pricing shows the headline', async ({ scenario, screen }) => {
  await scenario.open('/pricing', { authenticated: false });
  await expect(screen.getByRole('heading', 'Simple, honest pricing')).toBeVisible();
});

test('pricing shows Free, Pro, and Team plans and their limits', async ({ scenario, screen }) => {
  await scenario.open('/pricing', { authenticated: false });
  for (const name of ['Free', 'Pro', 'Team']) await expect(screen.getByRole('heading', name)).toBeVisible();
  await expect(screen.getByText('Up to 5 lists')).toBeVisible();
  await expect(screen.getByText('Unlimited lists', { exact: true })).toBeVisible();
});

test('pricing switches between monthly and yearly billing', async ({ scenario, screen }) => {
  await scenario.open('/pricing', { authenticated: false });
  await expect(screen.getByRole('button', /Yearly/)).toHaveAttribute('aria-pressed', 'true');
  await expect(screen.getByText('$48/yr')).toBeVisible();
  await screen.getByRole('button', 'Monthly').tap();
  await expect(screen.getByRole('button', 'Monthly')).toHaveAttribute('aria-pressed', 'true');
  await expect(screen.getByText('$5/mo')).toBeVisible();
  await screen.getByRole('button', /Yearly/).tap();
  await expect(screen.getByText('$48/yr')).toBeVisible();
});

test('unauthenticated upgrade redirects to login', async ({ scenario, screen, browser }) => {
  await scenario.open('/pricing', { authenticated: false });
  await screen.getByRole('button', 'Upgrade to Pro').tap();
  await expect(browser).toHaveURL('/login');
});

test('sign-up email entry shows the send-code button', async ({ scenario, screen }) => {
  await scenario.open('/login', { authenticated: false });
  await expect(screen.getByPlaceholder('you@example.com')).toBeVisible();
  await expect(screen.getByRole('button', /Send Code/i)).toBeVisible();
});

test('sending a code transitions to OTP entry', async ({ scenario, screen }) => {
  await scenario.open('/login', { authenticated: false });
  await submitEmail(screen);
  await expect(screen.getByText(/We sent a code to/)).toBeVisible();
  expect(scenario.httpCalls.find(call => call.path === '/auth/initiate')?.body.email).toBe('e2e@example.test');
});

test('completing OTP establishes the session and opens the dashboard', async ({ scenario, screen, browser }) => {
  await scenario.open('/login', { authenticated: false });
  await submitEmail(screen);
  await screen.getByLabel('Digit 1').tap();
  await browser.keyboard.type('123456');
  await expect(browser).toHaveURL('/d');
  await expect(screen.getByRole('heading', /Your lists|Welcome in/i)).toBeVisible();
  expect(scenario.httpCalls.find(call => call.path === '/auth/verify')?.body.code).toBe('123456');
  expect((await scenario.state()).calls.some(call => call.path === 'actorSession:establish')).toBe(true);
});

test('authenticated home renders the new-list action', async ({ scenario, screen }) => {
  await scenario.open('/d');
  await expect(screen.getByRole('button', 'Create new list or note')).toBeVisible();
});

test('authenticated home opens the create-list form', async ({ scenario, screen }) => {
  await scenario.open('/d');
  await openCreateList(screen);
  await expect(screen.getByRole('heading', 'Create New List')).toBeVisible();
});

test('free-tier server rejection shows the upgrade CTA', async ({ scenario, screen }) => {
  await scenario.open('/d', { lists: 5, failCreateList: true });
  await openCreateList(screen);
  await screen.getByLabel('List name').fill('Sixth List');
  await screen.getByRole('button', 'Create List').tap();
  await expect(screen.getByRole('link', 'View pricing →')).toBeVisible();
  expect((await scenario.state()).lists.length).toBe(5);
});

test('free-tier upgrade CTA opens pricing', async ({ scenario, screen, browser }) => {
  await scenario.open('/d', { lists: 5, failCreateList: true });
  await openCreateList(screen);
  await screen.getByLabel('List name').fill('Sixth List');
  await screen.getByRole('button', 'Create List').tap();
  await screen.getByRole('link', 'View pricing →').tap();
  await expect(browser).toHaveURL('/pricing');
});

test('authenticated Upgrade to Pro requests checkout and follows its URL', async ({ scenario, screen, browser }) => {
  await scenario.open('/pricing');
  await screen.getByRole('button', 'Upgrade to Pro').tap();
  await expect(browser).toHaveURL(CHECKOUT_URL);
  await expect(screen.getByRole('heading', 'Test checkout destination')).toBeVisible();
  const request = scenario.httpCalls.find(call => call.path === '/api/billing/checkout');
  expect(request?.body.priceId).toBe('price_e2e_yearly');
  expect(String(request?.body.successUrl)).toContain('/d?billing=success');
});
