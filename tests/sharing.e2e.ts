// Ported from e2e/sharing.spec.ts at 1c61e19^; see docs/e2e-migration.md.
import { expect } from 'e2e';
import { test, openList } from './fixtures/app';

test.describe("Sharing flow", () => {
  test("shows share button for list owner", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    await expect(screen.getByRole("button", { name: "Share" })).toBeVisible();
  });

  test("opens share modal", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    await screen.getByRole("button", { name: "Share" }).click();

    await expect(
      screen.getByRole("heading", { name: "Share list" }),
    ).toBeVisible({ timeout: 5000 });
  });

  test("share modal shows publish button when list is not published", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    await screen.getByRole("button", { name: "Share" }).click();
    await expect(
      screen.getByRole("heading", { name: "Share list" }),
    ).toBeVisible({ timeout: 5000 });

    await expect(
      screen.getByRole("button", { name: "Publish publicly" }),
    ).toBeVisible({ timeout: 5000 });
  });

  test("can close share modal", async ({ screen, scenario }) => {
    await openList(scenario, screen);

    await screen.getByRole("button", { name: "Share" }).click();
    await expect(
      screen.getByRole("heading", { name: "Share list" }),
    ).toBeVisible({ timeout: 5000 });

    await screen.getByRole("button", { name: "Done" }).click();

    await expect(
      screen.getByRole("heading", { name: "Share list" }),
    ).not.toBeVisible();
  });
});

test.describe("Join flow", () => {
  test("invalid join link shows invite-links-deprecated message", async ({ app, screen }) => {
    await app.open("/join/invalid-list-id/invalid-token");

    await expect(
      screen.getByRole("heading", { name: "This legacy invite link is no longer supported" }),
    ).toBeVisible();
  });
});
