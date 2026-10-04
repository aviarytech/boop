// Ported from e2e/items.spec.ts at 1c61e19^; see docs/e2e-migration.md.
import { expect } from 'e2e';
import { test, openList } from './fixtures/app';

test.describe("Item management", () => {
  test("shows empty state when no items exist", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    await expect(screen.getByText("This list is empty")).toBeVisible();
    await expect(
      screen.getByText("Add your first item below to get started."),
    ).toBeVisible();
  });

  test("adds a new item", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    await screen.getByPlaceholder("Add item...").fill("Milk");
    await screen.getByRole("button", { name: "Add", exact: true }).click();

    await expect(screen.getByText("Milk")).toBeVisible({ timeout: 5000 });
  });

  test("checks and unchecks an item", async ({ screen, scenario }) => {
    await openList(scenario, screen, { items: [{ name: "Bread", checked: false }] });

    await expect(screen.getByText("Bread")).toBeVisible({ timeout: 5000 });

    await screen.getByRole("button", { name: "Check Bread" }).click();

    await screen.getByRole("button", { name: /^Done/ }).click({ timeout: 5000 });

    await expect(
      screen.getByRole("button", { name: "Uncheck Bread" }),
    ).toBeVisible({ timeout: 5000 });

    await screen.getByRole("button", { name: "Uncheck Bread" }).click();

    await expect(
      screen.getByRole("button", { name: "Check Bread" }),
    ).toBeVisible({ timeout: 5000 });
  });

  test("removes an item", async ({ screen, scenario }) => {
    await openList(scenario, screen, { items: [{ name: "Eggs", checked: false }] });

    await expect(screen.getByText("Eggs")).toBeVisible({ timeout: 5000 });

    await screen.getByRole("button", { name: "Remove Eggs" }).click();

    await expect(screen.getByText("Eggs")).not.toBeVisible({ timeout: 5000 });
  });

  test("can navigate back to home", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    await screen.getByRole("link", { name: "Back to lists" }).click();

    await expect(
      screen.getByRole("heading", { name: /Your lists|Welcome in/i }),
    ).toBeVisible({ timeout: 10000 });
  });
});
