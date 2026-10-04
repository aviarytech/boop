// Ported from e2e/settings.spec.ts at 1c61e19^; see docs/e2e-migration.md.
import { expect } from 'e2e';
import { test, openSettings } from './fixtures/app';

test.describe("Settings panel", () => {
  test("1. settings panel opens when gear icon is clicked", async ({ screen, scenario }) => {
    await openSettings(scenario, screen);
    await expect(
      screen.getByRole("heading", { name: "⚙️ Settings" }),
    ).toBeVisible();
  });

  test("2. dark mode toggle is visible and interactive", async ({ screen, scenario }) => {
    await openSettings(scenario, screen);

    const darkModeToggle = screen.getByRole("switch", { name: "Toggle dark mode" });
    await expect(darkModeToggle).toBeVisible();
    const ariaChecked = await darkModeToggle.getAttribute("aria-checked");
    expect(["true", "false"]).toContain(ariaChecked);
  });

  test("3. dark mode toggle changes aria-checked on click", async ({ screen, scenario }) => {
    await openSettings(scenario, screen);

    const toggle = screen.getByRole("switch", { name: "Toggle dark mode" });
    const before = await toggle.getAttribute("aria-checked");

    await toggle.click();

    const after = await toggle.getAttribute("aria-checked");
    expect(after).not.toBe(before);
  });

  test("4. Feedback section is present with Send Feedback button", async ({ screen, scenario }) => {
    await openSettings(scenario, screen);

    await expect(screen.getByRole("button", { name: /Send Feedback/ })).toBeVisible();
  });

  test("5. Send Feedback opens feedback modal", async ({ screen, scenario }) => {
    await openSettings(scenario, screen);

    await screen.getByRole("button", { name: /Send Feedback/ }).click();

    await expect(
      screen.getByRole("heading", { name: /Send Feedback/ }),
    ).toBeVisible({ timeout: 5000 });
    await expect(screen.getByText("Category")).toBeVisible();
    await expect(screen.getByPlaceholder("Tell us anything...")).toBeVisible();
  });

  test("6. Feedback modal can be cancelled with Cancel", async ({ screen, scenario }) => {
    await openSettings(scenario, screen);

    await screen.getByRole("button", { name: /Send Feedback/ }).click();
    await expect(
      screen.getByRole("heading", { name: /Send Feedback/ }),
    ).toBeVisible({ timeout: 5000 });

    await screen.getByRole('button', 'Cancel').tap();

    await expect(
      screen.getByRole("heading", { name: /Send Feedback/ }),
    ).not.toBeVisible({ timeout: 5000 });
  });

  test("7. Profile link in settings navigates to /profile", async ({ screen, browser, scenario }) => {
    await openSettings(scenario, screen);

    await screen.getByRole("link", { name: /Your Profile/i }).click();

    await expect(browser).toHaveURL("/profile", { timeout: 10000 });
  });

  test("8. Done button closes the settings panel", async ({ screen, scenario }) => {
    await openSettings(scenario, screen);

    await screen.getByRole("button", { name: "Done" }).click();

    await expect(
      screen.getByRole("heading", { name: "⚙️ Settings" }),
    ).not.toBeVisible({ timeout: 3000 });
  });
});
