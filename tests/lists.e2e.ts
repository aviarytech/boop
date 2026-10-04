// Ported from e2e/lists.spec.ts at 1c61e19^; see docs/e2e-migration.md.
import { expect } from 'e2e';
import { test } from './fixtures/app';

test.describe("List management", () => {
  test("shows empty state when no lists exist", async ({ screen, scenario }) => {
    await scenario.open("/d", { lists: 0 });

    await expect(
      screen.getByRole("heading", { name: /Your lists|Welcome in/i }),
    ).toBeVisible({ timeout: 10000 });
    await expect(screen.getByText("Nothing here yet.")).toBeVisible();
    await expect(
      screen.getByRole("button", { name: "Make your first list" }),
    ).toBeVisible();
  });

  test("opens create list modal via template picker", async ({ screen, scenario }) => {
    await scenario.open("/d", { lists: 0 });

    await screen.getByRole("button", { name: "Create new list or note" }).click({ timeout: 10000 });
    await screen.getByRole("button", /^List Items you check off/).tap();

    await expect(
      screen.getByRole("heading", { name: "Choose a Template" }),
    ).toBeVisible({ timeout: 5000 });

    await screen.getByRole("button", { name: /Blank List/ }).click();
    await expect(
      screen.getByRole("heading", { name: "Create New List" }),
    ).toBeVisible({ timeout: 5000 });
    await expect(screen.getByLabel("List name")).toBeVisible();
  });

  test("creates a new list", async ({ screen, scenario }) => {
    await scenario.open("/d", { lists: 0 });

    await screen.getByRole("button", { name: "Create new list or note" }).click({ timeout: 10000 });
    await screen.getByRole("button", /^List Items you check off/).tap();
    await expect(
      screen.getByRole("heading", { name: "Choose a Template" }),
    ).toBeVisible({ timeout: 5000 });
    await screen.getByRole("button", { name: /Blank List/ }).click();
    await screen.getByLabel("List name").waitFor({ state: "visible", timeout: 5000 });

    await screen.getByLabel("List name").fill("Groceries");
    await screen.getByRole("button", { name: "Create List" }).click();

    await expect(
      screen.getByRole("heading", { name: "List created!" }),
    ).toBeVisible({ timeout: 5000 });
  });

  test("create list button is disabled when name is empty", async ({ screen, scenario }) => {
    await scenario.open("/d", { lists: 0 });

    await screen.getByRole("button", { name: "Create new list or note" }).click({ timeout: 10000 });
    await screen.getByRole("button", /^List Items you check off/).tap();
    await expect(
      screen.getByRole("heading", { name: "Choose a Template" }),
    ).toBeVisible({ timeout: 5000 });
    await screen.getByRole("button", { name: /Blank List/ }).click();
    await screen.getByLabel("List name").waitFor({ state: "visible", timeout: 5000 });

    await expect(
      screen.getByRole("button", { name: "Create List" }),
    ).toBeDisabled();
  });

  test("can cancel list creation", async ({ screen, scenario }) => {
    await scenario.open("/d", { lists: 0 });

    await screen.getByRole("button", { name: "Create new list or note" }).click({ timeout: 10000 });
    await screen.getByRole("button", /^List Items you check off/).tap();
    await expect(
      screen.getByRole("heading", { name: "Choose a Template" }),
    ).toBeVisible({ timeout: 5000 });
    await screen.getByRole("button", { name: /Blank List/ }).click();
    await screen.getByLabel("List name").waitFor({ state: "visible", timeout: 5000 });

    await screen.getByRole("button", { name: "Cancel" }).click();

    await expect(
      screen.getByRole("heading", { name: "Create New List" }),
    ).not.toBeVisible();
  });
});
