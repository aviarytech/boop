// Ported from e2e/terms.spec.ts at 1c61e19^; see docs/e2e-migration.md.
import { expect } from 'e2e';
import { test } from './fixtures/app';

test.describe("Terms of Service page", () => {
  test("1. /terms route renders the Terms of Service heading", async ({ screen, scenario }) => {
    await scenario.open("/terms", { authenticated: false });
    await expect(screen.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
  });

  test("2. page shows last-updated date (March 2026)", async ({ screen, scenario }) => {
    await scenario.open("/terms", { authenticated: false });
    await expect(screen.getByText("Last updated: March 2026")).toBeVisible();
  });

  test("3. key sections are present", async ({ screen, scenario }) => {
    await scenario.open("/terms", { authenticated: false });

    const sections = [
      "Agreement to Terms",
      "User Accounts",
      "Acceptable Use",
      "Payment Terms",
      "Intellectual Property",
      "Limitation of Liability",
      "Governing Law",
      "Termination",
      "Contact",
    ];

    for (const section of sections) {
      await expect(screen.getByRole("heading", { name: section })).toBeVisible();
    }
  });

  test("4. contact email links are present", async ({ screen, scenario }) => {
    await scenario.open("/terms", { authenticated: false });

    await expect(screen.getByRole("link", { name: "legal@boop.ad" })).toBeVisible();
    await expect(screen.getByRole("link", { name: "support@boop.ad" })).toBeVisible();
  });

  test("5. Stripe terms link is present", async ({ screen, scenario }) => {
    await scenario.open("/terms", { authenticated: false });
    const stripeLink = screen.getByRole("link", { name: /Stripe.s terms/ });
    await expect(stripeLink).toBeVisible();
    await expect(stripeLink).toHaveAttribute("target", "_blank");
    await expect(stripeLink).toHaveAttribute("rel", /noopener/);
  });

  test("6. back link navigates to landing page", async ({ screen, browser, scenario }) => {
    await scenario.open("/terms", { authenticated: false });

    const backLink = screen.getByRole("link", { name: /Back to boop/i });
    await expect(backLink).toBeVisible();
    await backLink.click();

    await expect(browser).toHaveURL("/");
  });
});
