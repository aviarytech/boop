// Ported from e2e/profile.spec.ts at 1c61e19^; see docs/e2e-migration.md.
import { expect } from 'e2e';
import { test } from './fixtures/app';

test.describe("Profile page", () => {
  test("1. /profile route renders without redirect for authenticated user", async ({ screen, browser, scenario }) => {
    await scenario.open('/profile', { lists: 2 });
    await expect(screen.getByRole('link', /Back to lists/i)).toBeVisible();
    await expect(browser).toHaveURL("/profile");
  });

  test("2. profile header shows user email", async ({ screen, scenario }) => {
    await scenario.open('/profile', { lists: 2 });
    await expect(screen.getByRole('link', /Back to lists/i)).toBeVisible();
    await expect(screen.getByText("e2e@example.test")).toBeVisible();
  });

  test("3. stats grid renders key stat labels", async ({ screen, scenario }) => {
    await scenario.open('/profile', { lists: 2 });
    await expect(screen.getByRole('link', /Back to lists/i)).toBeVisible();

    await expect(screen.getByText("Lists Created")).toBeVisible();
    await expect(screen.getByText("Shared Lists")).toBeVisible();
    await expect(screen.getByText("Items Done")).toBeVisible();
    await expect(screen.getByText("Completion Rate")).toBeVisible();
  });

  test("4. Activity Summary section is visible", async ({ screen, scenario }) => {
    await scenario.open('/profile', { lists: 2 });
    await expect(screen.getByRole('link', /Back to lists/i)).toBeVisible();

    await expect(
      screen.getByRole("heading", { name: /Activity Summary/ }),
    ).toBeVisible();
  });

  test("5. Plan section shows Upgrade CTA for free-plan users", async ({ screen, scenario }) => {
    await scenario.open('/profile', { lists: 2 });
    await expect(screen.getByRole('link', /Back to lists/i)).toBeVisible();

    await expect(screen.getByRole("heading", { name: /Plan/i })).toBeVisible();

    const upgradeLink = screen.getByRole("link", { name: "Upgrade →", exact: true });
    await expect(upgradeLink).toBeVisible();
    await expect(upgradeLink).toHaveAttribute("href", "/pricing");
  });

  test("6. Back to lists link navigates to /d", async ({ screen, browser, scenario }) => {
    await scenario.open('/profile', { lists: 2 });
    await expect(screen.getByRole('link', /Back to lists/i)).toBeVisible();

    await screen.getByRole("link", { name: /Back to lists/i }).click();

    await expect(browser).toHaveURL("/d", { timeout: 10000 });
    await expect(
      screen.getByRole("heading", { name: /Your lists|Welcome in/i }),
    ).toBeVisible({ timeout: 10000 });
  });

  test("7. DID is displayed in profile", async ({ screen, scenario }) => {
    await scenario.open('/profile', { lists: 2 });
    await expect(screen.getByRole('link', /Back to lists/i)).toBeVisible();

    await expect(screen.getByText("Your DID")).toBeVisible();

    await expect(screen.getByText(/did:webvh:e2/)).toBeVisible();
  });
});
