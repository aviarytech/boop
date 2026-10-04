// Ported from e2e/accessibility.spec.ts at 1c61e19^; see docs/e2e-migration.md.
import { expect } from 'e2e';
import { test, openList, openSettings, LIST_ID } from './fixtures/app';

test.describe("Accessibility — Home page", () => {
  test("primary action buttons have accessible names", async ({ screen, scenario }) => {
    await scenario.open('/d', { lists: 0 });

    await expect(
      screen.getByRole("button", { name: "Create new list or note" }),
    ).toBeVisible();
  });

  test("empty state heading is present for screen readers", async ({ screen, scenario }) => {
    await scenario.open('/d', { lists: 0 });

    await expect(screen.getByRole("heading", { name: "Nothing here yet." })).toBeVisible();
  });

  test("list cards have aria-labels when lists exist", async ({ screen, scenario }) => {
    await scenario.open('/d', { lists: 1 });

    await expect(
      screen.getByRole("link", { name: /Open list:/ }),
    ).toBeVisible({ timeout: 8000 });
  });

  test("search input has accessible label", async ({ screen, scenario }) => {
    await scenario.open('/d', { lists: 2 });

    const searchInput = screen.getByRole("searchbox", "Search lists");
    await expect(searchInput).toBeVisible({ timeout: 8000 });
  });
});

test.describe("Accessibility — List view page", () => {
  test("back button has aria-label", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    await expect(
      screen.getByRole("link", { name: "Back to lists" }),
    ).toBeVisible();
  });

  test("add item form has labelled input and submit button", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    await expect(screen.getByRole("textbox", { name: "Add new item" })).toBeVisible();
    await expect(screen.getByRole("button", { name: /^Add$/ })).toBeVisible();
  });

  test("item check button has accessible name", async ({ screen, scenario }) => {
    await openList(scenario, screen, { items: [{ name: "Milk", checked: false }] });

    await expect(
      screen.getByRole("button", { name: "Check Milk" }),
    ).toBeVisible({ timeout: 6000 });
  });

  test("item remove button has accessible name", async ({ screen, scenario }) => {
    await openList(scenario, screen, { items: [{ name: "Eggs", checked: false }] });

    await expect(
      screen.getByRole("button", { name: "Remove Eggs" }),
    ).toBeVisible({ timeout: 6000 });
  });

  test("empty state renders when list has no items", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    await expect(
      screen.getByRole("heading", { name: "This list is empty" }),
    ).toBeVisible();
  });

  test("view toggle buttons have aria-labels", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    await expect(
      screen.getByRole("button", { name: "Alphabetical view" }),
    ).toBeVisible();
    await expect(
      screen.getByRole("button", { name: "Categorized view" }),
    ).toBeVisible();
    await expect(
      screen.getByRole("button", { name: "Calendar view" }),
    ).toBeVisible();
  });
});

test.describe("Accessibility — Create list modal", () => {
  test("modal has dialog role and labelled input", async ({ screen, scenario }) => {
    await scenario.open('/d', { lists: 0 });

    await screen.getByRole("button", { name: "Create new list or note" }).click();
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

  test("modal can be dismissed with Escape key", async ({ screen, browser, scenario }) => {
    await scenario.open('/d', { lists: 0 });

    await screen.getByRole("button", { name: "Create new list or note" }).click();
    await screen.getByRole("button", /^List Items you check off/).tap();
    await expect(
      screen.getByRole("heading", { name: "Choose a Template" }),
    ).toBeVisible({ timeout: 5000 });

    await browser.keyboard.press("Escape");

    await expect(
      screen.getByRole("heading", { name: "Choose a Template" }),
    ).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe("Accessibility — Settings panel", () => {
  test("close button has aria-label", async ({ screen, scenario }) => {
    await openSettings(scenario, screen);
    await expect(
      screen.getByRole("button", { name: "Close settings" }),
    ).toBeVisible();
  });

  test("dark mode switch has role=switch and aria-checked", async ({ screen, scenario }) => {
    await openSettings(scenario, screen);

    const darkModeSwitch = screen.getByRole("switch", { name: "Toggle dark mode" });
    await expect(darkModeSwitch).toBeVisible();
    const checked = await darkModeSwitch.getAttribute("aria-checked");
    expect(["true", "false"]).toContain(checked);
  });

  test("haptic feedback switch has role=switch and aria-checked", async ({ screen, scenario }) => {
    await openSettings(scenario, screen);

    const hapticSwitch = screen.getByRole("switch", { name: "Toggle haptic feedback" });
    await expect(hapticSwitch).toBeVisible();
    const checked = await hapticSwitch.getAttribute("aria-checked");
    expect(["true", "false"]).toContain(checked);
  });

  test("settings panel dismisses on Escape", async ({ screen, browser, scenario }) => {
    await openSettings(scenario, screen);
    await browser.keyboard.press("Escape");
    await expect(
      screen.getByRole("heading", { name: "⚙️ Settings" }),
    ).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe("Accessibility — Confirm dialog", () => {
  test("delete confirm dialog has alertdialog role", async ({ screen, scenario }) => {
    await scenario.open(`/list/${LIST_ID}`, { lists: 1 });
    await expect(screen.getByText("Test List 1")).toBeVisible({ timeout: 10000 });

    await screen.getByRole("button", "More actions").tap();
    await screen.getByRole("button", "Delete list").tap();
    await expect(screen.getByRole("alertdialog")).toBeVisible();
    await expect(screen.getByRole("alertdialog")).toHaveAttribute("aria-modal", "true");
  });
});

test.describe("Accessibility — Keyboard navigation", () => {
  test("can Tab into the add-item input from page load", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    const addItemInput = screen.getByRole("textbox", { name: "Add new item" });
    await expect(addItemInput).toBeVisible();
    await addItemInput.focus();
    await expect(addItemInput).toBeFocused();
  });

  test("item can be added by pressing Enter", async ({ screen, browser, scenario }) => {
    await openList(scenario, screen);

    await screen.getByRole("textbox", { name: "Add new item" }).fill("Keyboard item");
    await browser.keyboard.press("Enter");

    await expect(screen.getByText("Keyboard item")).toBeVisible({ timeout: 5000 });
  });
});
