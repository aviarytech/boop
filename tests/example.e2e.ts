import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('landing page renders', async ({ app, browser }) => {
  await app.open('/');
  // body is always visible once CSS loads; landing copy proves React rendered.
  await expect(browser.locator('h1')).toContainText('with receipts');
});

// With the model key in the environment, uncomment:
// test('the agent drives a flow', async ({ app, agent }) => {
//   await app.open('/');
//   await agent.act('one goal in natural language');
//   await agent.assert('one question about the screen');
// });
