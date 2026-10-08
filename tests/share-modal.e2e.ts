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
      screen.getByRole("button", { name: /Publish publicly/i }),
    ).toBeVisible();
  });

  test("3. Publish publicly triggers publishList mutation and updates UI", async ({ screen, scenario }) => {
    await openList(scenario, screen, { published: false });

    await screen.getByRole("button", { name: "Share", exact: false }).click({ timeout: 10000 });
    await expect(screen.getByRole("button", { name: /Publish publicly/i })).toBeVisible({ timeout: 5000 });

    await screen.getByRole("button", { name: /Publish publicly/i }).click();

    await expect(
      screen.getByRole("heading", { name: /Share list/i }),
    ).toBeVisible({ timeout: 10000 });

    await expect(screen.getByText("This list is published publicly")).toBeVisible({ timeout: 5000 });
  });

  test("4. already-published list shows share link in modal", async ({ screen, browser, scenario }) => {
    await openList(scenario, screen, { published: true });

    await screen.getByRole("button", { name: "Share", exact: false }).click({ timeout: 10000 });

    await expect(
      screen.getByRole("heading", { name: /Share list/i }),
    ).toBeVisible({ timeout: 5000 });

    await expect(browser.locator('input[readonly]').first()).toBeVisible({ timeout: 5000 });

    await expect(screen.getByRole("button", { name: /Copy/i })).toBeVisible();
  });

  test("5. Unpublish button is visible for published lists", async ({ screen, scenario }) => {
    await openList(scenario, screen, { published: true });

    await screen.getByRole("button", { name: "Share", exact: false }).click({ timeout: 10000 });

    await expect(
      screen.getByRole("heading", { name: /Share list/i }),
    ).toBeVisible({ timeout: 5000 });

    await expect(
      screen.getByRole("button", { name: /Unpublish/i }),
    ).toBeVisible();
  });

  test("6. Done button closes the share modal", async ({ screen, scenario }) => {
    await openList(scenario, screen, { published: true });

    await screen.getByRole("button", { name: "Share", exact: false }).click({ timeout: 10000 });
    await expect(
      screen.getByRole("heading", { name: /Share list/i }),
    ).toBeVisible({ timeout: 5000 });

    await screen.getByRole("button", { name: "Done" }).click();

    await expect(
      screen.getByRole("heading", { name: /Share list/i }),
    ).not.toBeVisible({ timeout: 3000 });
  });

  test("7. list detail page shows public badge when list is published", async ({ screen, scenario }) => {
    await openList(scenario, screen, { published: true });

    await expect(
      screen.getByText("public", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
  });

  // Signed action records (#237): the list's creation record shows its true status.
  for (const [status, label, detail] of [
    ["signed", "Signed (Turnkey-held owner key)", /not independently verified here/],
    ["pending", "Pending signature", /Waiting for the account's Turnkey-held key/],
    ["failed", "Signing failed", /carries no signature/],
    ["unsigned", "Unsigned", /no Turnkey signing key/],
  ] as const) {
    test(`8. provenance shows a ${status} list creation record`, async ({ screen, scenario }) => {
      await openList(scenario, screen, { actionRecordStatus: status });

      await screen.getByRole("button", { name: "Share", exact: false }).click({ timeout: 10000 });
      await screen.getByRole("button", { name: /Originals Provenance/i }).click({ timeout: 5000 });

      await expect(screen.getByText("List creation record")).toBeVisible({ timeout: 5000 });
      await expect(screen.getByText(label, { exact: true })).toBeVisible();
      await expect(screen.getByText(detail)).toBeVisible();
    });
  }
});
