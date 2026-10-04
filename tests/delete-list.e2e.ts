// Ported from e2e/delete-list.spec.ts at 1c61e19^; see docs/e2e-migration.md.
import { expect } from 'e2e';
import { test, openList, LIST_ID } from './fixtures/app';

test.describe("Delete list flow", () => {
  test("1. More actions menu opens on list page", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    await screen.getByRole("button", { name: "More actions" }).click();

    await expect(screen.getByRole("button", { name: "Delete list" })).toBeVisible({
      timeout: 5000,
    });
  });

  test("2. Delete list option is present in the actions menu", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    await screen.getByRole("button", { name: "More actions" }).click();

    await expect(screen.getByRole("button", { name: "Delete list" })).toBeVisible();
  });

  test("3. clicking Delete list opens confirmation dialog", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    await screen.getByRole("button", { name: "More actions" }).click();
    await screen.getByRole("button", { name: "Delete list" }).click();

    await expect(
      screen.getByRole("alertdialog"),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      screen.getByRole("heading", { name: "Delete List" }),
    ).toBeVisible();
  });

  test("4. confirmation dialog shows the list name", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    await screen.getByRole("button", { name: "More actions" }).click();
    await screen.getByRole("button", { name: "Delete list" }).click();

    await expect(screen.getByRole("alertdialog")).toBeVisible({ timeout: 5000 });
    await expect(screen.getByRole("alertdialog")).toContainText("Test List 1");
  });

  test("5. Cancel button closes the dialog without navigating", async ({ screen, browser, scenario }) => {
    await openList(scenario, screen);

    await screen.getByRole("button", { name: "More actions" }).click();
    await screen.getByRole("button", { name: "Delete list" }).click();
    await expect(screen.getByRole("alertdialog")).toBeVisible({ timeout: 5000 });

    await screen.getByRole("button", { name: "Cancel" }).click();

    await expect(screen.getByRole("alertdialog")).not.toBeVisible({ timeout: 3000 });
    await expect(browser).toHaveURL(new RegExp(LIST_ID));
  });

  test("6. confirming delete triggers mutation and navigates to /d", async ({ screen, browser, scenario }) => {
    await openList(scenario, screen);

    await screen.getByRole("button", { name: "More actions" }).click();
    await screen.getByRole("button", { name: "Delete list" }).click();
    await expect(screen.getByRole("alertdialog")).toBeVisible({ timeout: 5000 });

    await screen.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();

    await expect(browser).toHaveURL("/d", { timeout: 10000 });
    await expect(
      screen.getByRole("heading", { name: /Your lists|Welcome in/i }),
    ).toBeVisible({ timeout: 10000 });
  });
});
