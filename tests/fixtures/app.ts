import { test as webTest } from '@e2e-dev/web';
import { expect, type TestFixtures } from 'e2e';

export const LIST_ID = 'lists:mocklist0';
export const CHECKOUT_URL = 'https://checkout.stripe.com/pay/cs_test_e2e_fixture';

export interface ScenarioOptions {
  lists?: number;
  items?: { name: string; checked?: boolean }[];
  published?: boolean;
  failCreateList?: boolean;
  loseTemplateResponseOnce?: boolean;
  pendingReferralCode?: string;
  authenticated?: boolean;
  onboarding?: boolean;
  inviteNudgeDone?: boolean;
}

interface FixtureState {
  lists: { _id: string; name: string }[];
  items: { _id: string; name: string; checked: boolean }[];
  calls: { path: string; args: Record<string, unknown> }[];
  errors: string[];
  published: boolean;
  receipts: { operationId: string }[];
}

export interface Scenario {
  open(path: string, options?: ScenarioOptions): Promise<void>;
  state(): Promise<FixtureState>;
  resumeTemplateResponses(): Promise<void>;
  httpCalls: { path: string; body: Record<string, unknown> }[];
}

export const test = webTest.extend<{ scenario: Scenario }>({
  scenario: async ({ app, browser }, runTest) => {
    let token: string | undefined;
    const httpCalls: Scenario['httpCalls'] = [];
    const base = new URL(app.baseUrl!);
    const state = async (): Promise<FixtureState> => {
      const response = await fetch(new URL('/__e2e/state', base), { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`Fixture state failed: ${response.status}`);
      return response.json();
    };
    try {
      await runTest({
        httpCalls, state,
        async resumeTemplateResponses() {
          const response = await fetch(new URL('/__e2e/resume-template', base), {method:'POST',headers:{authorization:`Bearer ${token}`}});
          if (!response.ok) throw new Error('Could not resume fixture responses');
        },
        async open(path, options = {}) {
          if (token) throw new Error('Use app.open/browser.reload after scenario.open; a scenario is seeded once per test.');
          const response = await fetch(new URL('/__e2e/seed', base), {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(options),
          });
          if (!response.ok) throw new Error(`Fixture seed failed: ${response.status}`);
          const auth = await response.json();
          token = auth.token;
          await browser.route('**/*', async route => {
            const url = new URL(route.request.url);
            if (url.href === CHECKOUT_URL) {
              await route.fulfill({ headers: { 'content-type': 'text/html' }, body: '<h1>Test checkout destination</h1>' });
              return;
            }
            if (url.hostname === '127.0.0.1' && ['/auth/initiate', '/auth/verify', '/auth/logout', '/api/billing/checkout'].includes(url.pathname)) {
              const body = JSON.parse(route.request.postData || '{}');
              httpCalls.push({ path: url.pathname, body });
              const json = url.pathname === '/auth/initiate' ? { sessionId: 'e2e-otp' }
                : url.pathname === '/auth/verify' ? auth
                : url.pathname === '/api/billing/checkout' ? { url: CHECKOUT_URL } : {};
              await route.fulfill({ json });
              return;
            }
            if (url.origin !== base.origin) {
              // Fonts, analytics, and other third-party requests never leave the fixture.
              await route.abort();
              return;
            }
            await route.continue();
          });
          // A test-only same-origin page seeds storage before loading the real app.
          // The backend still has to accept the app's actorSession.establish call.
          await app.open(`/__e2e/start?${new URLSearchParams({ token: auth.token, path })}`);
        },
      });
      if (token) expect((await state()).errors).toEqual([]);
    } finally {
      if (token) await fetch(new URL('/__e2e/account', base), {
        method: 'DELETE', headers: { authorization: `Bearer ${token}` },
      });
    }
  },
});

export async function openCreateList(screen: TestFixtures['screen']) {
  await screen.getByRole('button', 'Create new list or note').tap();
  await screen.getByRole('button', /^List Items you check off/).tap();
  await expect(screen.getByRole('heading', 'Choose a Template')).toBeVisible();
  await screen.getByRole('button', /Blank List/).tap();
  await expect(screen.getByLabel('List name')).toBeVisible();
}

export async function openList(scenario: Scenario, screen: TestFixtures['screen'], options: ScenarioOptions = {}) {
  await scenario.open(`/list/${LIST_ID}`, { lists: 1, ...options });
  await expect(screen.getByRole('heading', 'Test List 1')).toBeVisible();
}

export async function openSettings(scenario: Scenario, screen: TestFixtures['screen']) {
  await scenario.open('/d');
  await screen.getByRole('button', 'Settings').tap();
  await expect(screen.getByRole('heading', '⚙️ Settings')).toBeVisible();
}
