// Ported from e2e/offline.spec.ts at 1c61e19^; see docs/e2e-migration.md.
import { expect } from 'e2e';
import { test } from './fixtures/app';

test.describe("Offline indicator", () => {
  test("1. offline banner appears when browser goes offline", async ({ screen, browser, scenario }) => {
    await scenario.open('/d');
    await expect(screen.getByRole('heading', /Your lists|Welcome in/i)).toBeVisible();

    await browser.evaluate(() => window.dispatchEvent(new Event("offline")));

    await expect(screen.getByRole("alert")).toBeVisible({ timeout: 5000 });
    await expect(screen.getByRole("alert")).toContainText("You're offline");
  });

  test("2. offline banner message includes sync hint", async ({ screen, browser, scenario }) => {
    await scenario.open('/d');
    await expect(screen.getByRole('heading', /Your lists|Welcome in/i)).toBeVisible();

    await browser.evaluate(() => window.dispatchEvent(new Event("offline")));

    await expect(screen.getByRole("alert")).toBeVisible({ timeout: 5000 });
    await expect(screen.getByRole("alert")).toContainText(
      "changes will sync when reconnected",
    );
  });

  test("3. offline banner disappears when browser comes back online", async ({ screen, browser, scenario }) => {
    await scenario.open('/d');
    await expect(screen.getByRole('heading', /Your lists|Welcome in/i)).toBeVisible();

    await browser.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(screen.getByRole("alert")).toBeVisible({ timeout: 5000 });

    await browser.evaluate(() => window.dispatchEvent(new Event("online")));

    await expect(screen.getByRole("alert")).not.toBeVisible({ timeout: 5000 });
  });

  test("4. app remains functional while offline — existing content still visible", async ({ screen, browser, scenario }) => {
    await scenario.open('/d');
    await expect(screen.getByRole('heading', /Your lists|Welcome in/i)).toBeVisible();

    await browser.evaluate(() => window.dispatchEvent(new Event("offline")));

    await expect(
      screen.getByRole("heading", { name: /Your lists|Welcome in/i }),
    ).toBeVisible({ timeout: 5000 });
  });
});
