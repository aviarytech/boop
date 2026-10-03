import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('landing page renders the hero and signup link', async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByRole('heading', /The todo list your AI agents can use/, { level: 1 }))
    .toContainText('with receipts.');
  await expect(screen.getByRole('link', 'Get boop — free')).toBeVisible();
  await expect(screen.getByRole('link', 'Get boop — free')).toHaveAttribute('href', '/login');
});

test('landing quickstart link opens the docs', async ({ app, screen, browser }) => {
  await app.open('/');
  await screen.getByRole('link', 'Read the API quickstart →').tap();
  await expect(browser).toHaveURL('/docs/quickstart');
  await expect(screen.getByRole('heading', 'An agent completing a task in 5 minutes, with curl.', { level: 1 }))
    .toBeVisible();
});

test('quickstart loads directly with the task walkthrough and endpoint reference', async ({ app, screen, browser }) => {
  await app.open('/docs/quickstart');
  await expect(browser).toHaveURL('/docs/quickstart');
  await expect(screen.getByRole('heading', 'An agent completing a task in 5 minutes, with curl.', { level: 1 }))
    .toBeVisible();
  for (const heading of ['0 · Grab a list', '1 · Get a token', '2 · Add an item', '3 · Check it off', '4 · See what happened', 'Endpoint reference']) {
    await expect(screen.getByRole('heading', heading, { level: 2 })).toBeVisible();
  }
  await expect(screen.getByRole('table')).toContainText('POST /api/items/add');
  await expect(screen.getByRole('table')).toContainText('POST /api/items/check');

  await screen.getByRole('link', 'boop').tap();
  await expect(browser).toHaveURL('/');
  await expect(screen.getByRole('heading', /The todo list your AI agents can use/, { level: 1 }))
    .toContainText('with receipts.');
});
