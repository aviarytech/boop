// Ported from e2e/share-modal.spec.ts at 1c61e19^.
import { expect } from 'e2e';
import { test, openList } from './fixtures/app';

test.describe("Share / publish flow (POO-14)", () => {

  test("1. Share button is visible on list view for list owner", async ({ screen, scenario }) => {
    await openList(scenario, screen, { published: false });

    await expect(
      screen.getByRole("button", { name: "Share", exact: false }),
    ).toBeVisible({ timeout: 10000 });
  });

  test("2. Share button opens ShareModal in unpublished state", async ({ screen, scenario }) => {
    await openList(scenario, screen, { published: false });

    await screen.getByRole("button", { name: "Share", exact: false }).click({ timeout: 10000 });

    await expect(
      screen.getByRole("heading", { name: /Share List/i }),
    ).toBeVisible({ timeout: 5000 });

    await expect(
      screen.getByRole("button", { name: /Publish to Share/i }),
    ).toBeVisible();
  });

  test("3. Publish to Share triggers publishList mutation and updates UI", async ({ screen, scenario }) => {
    await openList(scenario, screen, { published: false });

    await screen.getByRole("button", { name: "Share", exact: false }).click({ timeout: 10000 });
    await expect(screen.getByRole("button", { name: /Publish to Share/i })).toBeVisible({ timeout: 5000 });

    await screen.getByRole("button", { name: /Publish to Share/i }).click();

    await expect(
      screen.getByRole("heading", { name: /Shared List/i }),
    ).toBeVisible({ timeout: 10000 });

    await expect(screen.getByText("This list is shared")).toBeVisible({ timeout: 5000 });
  });

  test("4. already-published list shows share link in modal", async ({ screen, browser, scenario }) => {
    await openList(scenario, screen, { published: true });

    await screen.getByRole("button", { name: "Share", exact: false }).click({ timeout: 10000 });

    await expect(
      screen.getByRole("heading", { name: /Shared List/i }),
    ).toBeVisible({ timeout: 5000 });

    await expect(browser.locator('input[readonly]').first()).toBeVisible({ timeout: 5000 });

    await expect(screen.getByRole("button", { name: /Copy/i })).toBeVisible();
  });

  test("5. Stop sharing button is visible for published lists", async ({ screen, scenario }) => {
    await openList(scenario, screen, { published: true });

    await screen.getByRole("button", { name: "Share", exact: false }).click({ timeout: 10000 });

    await expect(
      screen.getByRole("heading", { name: /Shared List/i }),
    ).toBeVisible({ timeout: 5000 });

    await expect(
      screen.getByRole("button", { name: /Stop sharing/i }),
    ).toBeVisible();
  });

  test("6. Done button closes the share modal", async ({ screen, scenario }) => {
    await openList(scenario, screen, { published: true });

    await screen.getByRole("button", { name: "Share", exact: false }).click({ timeout: 10000 });
    await expect(
      screen.getByRole("heading", { name: /Shared List/i }),
    ).toBeVisible({ timeout: 5000 });

    await screen.getByRole("button", { name: "Done" }).click();

    await expect(
      screen.getByRole("heading", { name: /Shared List/i }),
    ).not.toBeVisible({ timeout: 3000 });
  });

  test("7. list detail page shows Shared badge when list is published", async ({ screen, scenario }) => {
    await openList(scenario, screen, { published: true });

    await expect(
      screen.getByText("shared", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
  });
});
