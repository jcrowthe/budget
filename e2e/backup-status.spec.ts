import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// The plans page warns when the nightly backup failed or is missing (stub of GET /api/v1/backup-status).
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

async function stubStatus(page: Page, body: Record<string, unknown>) {
  await page.route("**/api/v1/backup-status", (route) => route.fulfill({ json: { data: body } }));
}
const warning = (page: Page) => page.getByRole("status", { name: "Backup warning" });

test("a stale backup shows a warning on the plans page, and Dismiss hides it", async ({ page }) => {
  await stubStatus(page, {
    last_success_at: hoursAgo(40),
    last_failure_at: null,
    last_error_code: null,
    stale: true,
  });
  await page.goto("/plans");
  await expect(warning(page)).toBeVisible();
  await expect(warning(page)).toContainText("No backup in the last 36 hours");
  await warning(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(warning(page)).toHaveCount(0);
});

test("a failed backup names the failure", async ({ page }) => {
  await stubStatus(page, {
    last_success_at: hoursAgo(5),
    last_failure_at: hoursAgo(1),
    last_error_code: "read_failed",
    stale: false,
  });
  await page.goto("/plans");
  await expect(warning(page)).toContainText("The last backup failed");
});

test("a recent successful backup shows no warning", async ({ page }) => {
  await stubStatus(page, {
    last_success_at: hoursAgo(5),
    last_failure_at: null,
    last_error_code: null,
    stale: false,
  });
  await page.goto("/plans");
  await expect(page.getByRole("heading", { name: "Your Plans" })).toBeVisible();
  await expect(warning(page)).toHaveCount(0);
});
