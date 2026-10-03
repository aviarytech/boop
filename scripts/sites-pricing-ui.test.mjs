import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: 'http://localhost/' });
const React = await import('react');
const { MemoryRouter, Routes, Route } = await import('react-router-dom');
const { render, fireEvent, waitFor } = await import('@testing-library/react');
await build({
  entryPoints: ['src/pages/Sites.tsx', 'src/pages/Pricing.tsx', 'src/pages/SiteDetail.tsx', 'src/components/sites/ConnectDomainModal.tsx'], outdir: 'tmp/sites-pricing-ui', outExtension: { '.js': '.mjs' },
  outbase: 'src',
  bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'react-router-dom'],
  define: { 'import.meta.env.VITE_CONVEX_HTTP_URL': '"https://fixture.test"',
    'import.meta.env.VITE_STRIPE_PRO_YEARLY_PRICE_ID': '"price_yearly"',
    'import.meta.env.VITE_STRIPE_PRO_MONTHLY_PRICE_ID': '"price_monthly"',
    'import.meta.env.VITE_STRIPE_TEAM_PRICE_ID': '"price_team"',
    'import.meta.env.VITE_CUSTOM_DOMAIN_CNAME_TARGET': '"boop.ad"' },
  plugins: [{ name: 'ui-fixtures', setup(build) {
    build.onResolve({ filter: /hooks\/use(CurrentUser|Settings|Toast|Billing|Auth)$|lib\/(authenticatedConvex|analytics)$|_generated\/api$|\/SiteAssets$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents:
      path.endsWith('useCurrentUser') ? 'export const useCurrentUser = () => ({ did: "did:owner", isLoading: false });' :
      path.endsWith('useSettings') ? 'export const useSettings = () => ({ haptic() {} });' :
      path.endsWith('useToast') ? 'export const useToast = () => ({ addToast() {} });' :
      path.endsWith('useBilling') ? 'export const useBilling = () => ({ plan: "free", subscription: null, isLoading: false });' :
      path.endsWith('useAuth') ? 'export const useAuth = () => ({ isAuthenticated: true, token: "fixture" });' :
      path.endsWith('analytics') ? 'export const trackUpgradePageViewed = () => {}; export const trackUpgradeClicked = () => {};' :
      path.endsWith('SiteAssets') ? 'export const SiteAssets = () => null;' :
      path.endsWith('authenticatedConvex') ? 'export const useQuery = key => globalThis.siteUI[key]; export const useAction = key => async args => { if (globalThis.siteUI.action) return globalThis.siteUI.action(key, args); throw new Error("Unexpected action"); };' :
      'export const api = { sites: { getSitePlan: "plan", listSites: "sites", getSite: "site", getSitePreviewUrl: "preview", generateSiteUploadUrl: "upload" }, siteActions: { createSiteFromUpload: "create", replaceSiteFile: "replace", requestCustomHostname: "domain", retryCustomHostname: "retry" } };', loader: 'js' }));
  } }],
});
const { Sites } = await import(pathToFileURL(`${process.cwd()}/tmp/sites-pricing-ui/pages/Sites.mjs`));
const { Pricing } = await import(pathToFileURL(`${process.cwd()}/tmp/sites-pricing-ui/pages/Pricing.mjs`));
const { SiteDetail } = await import(pathToFileURL(`${process.cwd()}/tmp/sites-pricing-ui/pages/SiteDetail.mjs`));
const { ConnectDomainModal } = await import(pathToFileURL(`${process.cwd()}/tmp/sites-pricing-ui/components/sites/ConnectDomainModal.mjs`));
const mount = Component => render(React.createElement(MemoryRouter, null, React.createElement(Component)));

test('Free cap offers a working upgrade link and preserves access to existing sites', () => {
  globalThis.siteUI = { plan: { plan: 'free', maxSites: 1, canCreate: false }, sites: [{ _id: 'S1', scid: 'portable', primaryHostname: { hostname: 'existing.boop.ad' } }] };
  const view = mount(Sites);
  try {
    assert.equal(view.getByRole('link', { name: 'Upgrade to Pro' }).getAttribute('href'), '/pricing');
    assert.match(view.getByRole('status').textContent, /5 sites and custom domains/);
    fireEvent.change(view.getByPlaceholderText('Paste HTML here...'), { target: { value: '<h1>test</h1>' } });
    assert.equal(view.getByRole('button', { name: 'Make my link' }).disabled, true);
    assert.equal(view.getByRole('link', { name: /existing.boop.ad/ }).getAttribute('href'), '/s/S1');
  } finally { view.unmount(); }
});

test('site details offer Free users an upgrade, while paid users can connect a domain', () => {
  for (const plan of [undefined, { customDomains: false }, { customDomains: true }]) {
    globalThis.siteUI = { plan, site: { _id: 'S1', hostnames: [], primaryHostname: { hostname: 'existing.boop.ad' } } };
    const view = render(React.createElement(MemoryRouter, { initialEntries: ['/s/S1'] },
      React.createElement(Routes, null, React.createElement(Route, { path: '/s/:siteId', element: React.createElement(SiteDetail) }))));
    try {
      assert.equal(view.getByRole('button', { name: 'Replace HTML' }).disabled, false);
      if (plan?.customDomains === false) {
        assert.equal(view.getByRole('link', { name: 'Custom domains require Pro — upgrade' }).getAttribute('href'), '/pricing');
        assert.equal(view.queryByRole('button', { name: 'Connect a domain you own' }), null);
      } else {
        const connect = view.getByRole('button', { name: 'Connect a domain you own' });
        assert.equal(connect.disabled, !plan);
        if (plan) {
          fireEvent.click(connect);
          assert.ok(view.getByRole('textbox', { name: 'Domain' }));
        }
      }
    } finally { view.unmount(); }
  }
});

test('a downgrade during domain submission shows the production-safe message and upgrade link', async () => {
  globalThis.siteUI = { site: { hostnames: [] }, action: async key => {
    assert.equal(key, 'domain');
    // Only structured data survives production error redaction.
    throw Object.assign(new Error('Server Error'), { data: { code: 'PLAN_REQUIRED', message: 'This feature requires the Pro plan. Please upgrade at /pricing.' } });
  } };
  const view = render(React.createElement(MemoryRouter, null, React.createElement(ConnectDomainModal, { siteId: 'S1', ownerDid: 'did:owner', hostname: 'existing.boop.ad', onClose() {} })));
  try {
    fireEvent.change(view.getByRole('textbox', { name: 'Domain' }), { target: { value: 'example.test' } });
    fireEvent.click(view.getByRole('button', { name: 'Connect' }));
    await waitFor(() => assert.ok(view.getByText(/This feature requires the Pro plan/)));
    assert.equal(view.getByRole('link', { name: 'Upgrade to Pro for custom domains' }).getAttribute('href'), '/pricing');
    assert.equal(view.queryByText('Server Error'), null);
  } finally { view.unmount(); }
});

test('paid caps explain the limit without selling a Team upgrade that adds no capacity', () => {
  for (const plan of ['pro', 'team']) {
    globalThis.siteUI = { plan: { plan, maxSites: 5, canCreate: false }, sites: [] };
    const view = mount(Sites);
    try {
      assert.match(view.getByRole('status').textContent, /5 sites per account.*update your existing sites/);
      assert.equal(view.queryByRole('link', { name: /Upgrade/ }), null);
    } finally { view.unmount(); }
  }
});

test('creation waits for entitlements, then enables below the limit', () => {
  for (const allowance of [undefined, { plan: 'free', maxSites: 1, canCreate: true }]) {
    globalThis.siteUI = { plan: allowance, sites: [] };
    const view = mount(Sites);
    try {
      fireEvent.change(view.getByPlaceholderText('Paste HTML here...'), { target: { value: '<p>ready</p>' } });
      assert.equal(view.getByRole('button', { name: 'Make my link' }).disabled, allowance === undefined);
    } finally { view.unmount(); }
  }
});

test('Pro defaults to $48 yearly checkout and monthly remains selectable', async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    // Stop before navigation, with no external request.
    return { ok: false, json: async () => ({ error: 'Fixture checkout stopped' }) };
  };
  const view = mount(Pricing);
  try {
    assert.equal(view.getByRole('button', { name: /Yearly/ }).getAttribute('aria-pressed'), 'true');
    assert.ok(view.getByText('$48/yr'));
    assert.ok(view.getByText('1 site on *.boop.ad'));
    assert.ok(view.getByText('5 sites + custom domains'));
    fireEvent.click(view.getByRole('button', { name: 'Upgrade to Pro' }));
    await waitFor(() => assert.equal(requests.length, 1));
    assert.equal(requests[0].body.priceId, 'price_yearly');
    await waitFor(() => assert.equal(view.getByRole('button', { name: 'Upgrade to Pro' }).disabled, false));
    fireEvent.click(view.getByRole('button', { name: 'Monthly' }));
    assert.ok(view.getByText('$5/mo'));
    fireEvent.click(view.getByRole('button', { name: 'Upgrade to Pro' }));
    await waitFor(() => assert.equal(requests.length, 2));
    assert.equal(requests[1].body.priceId, 'price_monthly');
  } finally { view.unmount(); globalThis.fetch = originalFetch; }
});
