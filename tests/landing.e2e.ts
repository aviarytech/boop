// Ported from e2e/landing.spec.ts at 1c61e19^; see docs/e2e-migration.md.
import { expect } from 'e2e';
import { test } from './fixtures/app';

test.describe("Landing page", () => {
  test("1. page loads with boop hero heading", async ({ screen, scenario }) => {
    await scenario.open("/", { authenticated: false });
    await expect(screen.getByRole("heading", { level: 1, name: /The todo list your AI agents can use/ })).toBeVisible();
    await expect(
      screen.getByText(/One shared space where you, your team, and your agents get things done/i),
    ).toBeVisible();
  });

  test("2. primary hero CTA navigates unauthenticated users to /login", async ({ screen, browser, scenario }) => {
    await scenario.open("/", { authenticated: false });
    await screen.getByRole("link", { name: /Get boop — free/i }).click();
    await expect(browser).toHaveURL("/login");
  });

  test("3. hero 'Already using boop? Sign in' link navigates to /login", async ({ browser, scenario }) => {
    await scenario.open("/", { authenticated: false });
    await browser.locator(".hero-signin").getByRole("link", { name: "Sign in" }).click();
    await expect(browser).toHaveURL("/login");
  });

  test("4. audience section lists the three current paths", async ({ screen, scenario }) => {
    await scenario.open("/", { authenticated: false });
    await expect(screen.getByRole("heading", { name: "Lists that keep up." })).toBeVisible();
    await expect(screen.getByRole("heading", { name: "One workspace, no chasing." })).toBeVisible();
    await expect(screen.getByRole("heading", { name: "Mission Control." })).toBeVisible();
  });

  test("5. pricing section shows Free, Pro, and Team plans", async ({ browser, scenario }) => {
    await scenario.open("/", { authenticated: false });
    await browser.locator("#pricing").scrollIntoView();
    const pricing = browser.locator("#pricing");
    await expect(pricing.getByText("Free", { exact: true }).first()).toBeVisible();
    await expect(pricing.getByText("Pro", { exact: true }).first()).toBeVisible();
    await expect(pricing.getByText("Team", { exact: true }).first()).toBeVisible();
  });

  test("6. FAQ section is present", async ({ screen, browser, scenario }) => {
    await scenario.open("/", { authenticated: false });
    await browser.locator("#faq").scrollIntoView();
    await expect(screen.getByRole("heading", { name: "Just the honest questions." })).toBeVisible();
  });

  test("7. footer Privacy link navigates to /privacy", async ({ screen, browser, scenario }) => {
    await scenario.open("/", { authenticated: false });
    await screen.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
    await expect(browser).toHaveURL("/privacy");
  });

  test("8. footer tagline is present", async ({ screen, scenario }) => {
    await scenario.open("/", { authenticated: false });
    await expect(screen.getByText("Made carefully, by humans and agents.")).toBeVisible();
  });

  test("9. OG image meta tag points to /og-image-boop.png", async ({ browser, scenario }) => {
    await scenario.open("/", { authenticated: false });
    const ogImage = browser.locator('meta[property="og:image"]');
    await expect(ogImage).toHaveAttribute("content", /\/og-image-boop\.png/);
    const twitterImage = browser.locator('meta[name="twitter:image"]');
    await expect(twitterImage).toHaveAttribute("content", /\/og-image-boop\.png/);
  });

  test("10. no fabricated user-count stats are visible", async ({ browser, scenario }) => {
    await scenario.open("/", { authenticated: false });
    const pageContent = await browser.evaluate(() => document.documentElement.outerHTML);
    expect(pageContent).not.toMatch(
      /\b\d[\d,]+\+?\s*(users|customers|downloads|reviews|ratings)\b/i,
    );
  });

  test("11. no 'loved by' testimonials section", async ({ screen, scenario }) => {
    await scenario.open("/", { authenticated: false });
    await expect(screen.getByRole("heading", { name: /testimonial/i })).not.toBeVisible();
    await expect(screen.getByRole("heading", { name: /loved by/i })).not.toBeVisible();
  });
});
