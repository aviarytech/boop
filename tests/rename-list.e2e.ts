// Ported from e2e/rename-list.spec.ts at 1c61e19^; see docs/e2e-migration.md.
import { expect } from 'e2e';
import { test, openList, LIST_ID } from './fixtures/app';

test.describe("Rename list flow", () => {
  test("1. Rename list option is present in the actions menu", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    await screen.getByRole("button", { name: "More actions" }).click();

    await expect(
      screen.getByRole("button", { name: /Rename list/ }),
    ).toBeVisible({ timeout: 5000 });
  });

  test("2. clicking Rename list opens the rename dialog", async ({ screen, scenario }) => {
    await openList(scenario, screen);
    await screen.getByRole('button', 'More actions').tap();
    await screen.getByRole('button', /Rename list/).tap();
    await expect(screen.getByRole('dialog', 'Rename list')).toBeVisible();

    await expect(
      screen.getByRole("heading", { name: /Rename list/ }),
    ).toBeVisible();
  });

  test("3. rename dialog input is pre-filled with the current list name", async ({ screen, scenario }) => {
    await openList(scenario, screen);
    await screen.getByRole('button', 'More actions').tap();
    await screen.getByRole('button', /Rename list/).tap();
    await expect(screen.getByRole('dialog', 'Rename list')).toBeVisible();

    const input = screen.getByLabel("List name", { exact: false });
    await expect(input).toHaveValue("Test List 1");
  });

  test("4. Cancel button closes the rename dialog", async ({ screen, browser, scenario }) => {
    await openList(scenario, screen);
    await screen.getByRole('button', 'More actions').tap();
    await screen.getByRole('button', /Rename list/).tap();
    await expect(screen.getByRole('dialog', 'Rename list')).toBeVisible();

    await screen.getByRole("button", { name: "Cancel" }).click();

    await expect(
      screen.getByRole("dialog", { name: /Rename list/ }),
    ).not.toBeVisible({ timeout: 3000 });
    await expect(browser).toHaveURL(new RegExp(LIST_ID));
  });

  test("5. Rename button is disabled when input is empty", async ({ screen, scenario }) => {
    await openList(scenario, screen);
    await screen.getByRole('button', 'More actions').tap();
    await screen.getByRole('button', /Rename list/).tap();
    await expect(screen.getByRole('dialog', 'Rename list')).toBeVisible();

    await screen.getByLabel("List name", { exact: false }).clear();

    await expect(
      screen.getByRole("button", { name: "Rename" }),
    ).toBeDisabled();
  });

  test("6. confirming rename submits mutation and closes the dialog", async ({ screen, scenario }) => {
    await openList(scenario, screen);
    await screen.getByRole('button', 'More actions').tap();
    await screen.getByRole('button', /Rename list/).tap();
    await expect(screen.getByRole('dialog', 'Rename list')).toBeVisible();

    await screen.getByLabel("List name", { exact: false }).fill("My Renamed List");
    await screen.getByRole("button", { name: "Rename" }).click();

    await expect(
      screen.getByRole("dialog", { name: /Rename list/ }),
    ).not.toBeVisible({ timeout: 10000 });
  });

  test("7. pressing Enter in the input submits the rename", async ({ screen, scenario }) => {
    await openList(scenario, screen);
    await screen.getByRole('button', 'More actions').tap();
    await screen.getByRole('button', /Rename list/).tap();
    await expect(screen.getByRole('dialog', 'Rename list')).toBeVisible();

    const input = screen.getByLabel("List name", { exact: false });
    await input.fill("Enter Key Rename");
    await input.press("Enter");

    await expect(
      screen.getByRole("dialog", { name: /Rename list/ }),
    ).not.toBeVisible({ timeout: 10000 });
  });
});
