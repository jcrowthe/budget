import { expect, test } from "./fixtures";
import { testName } from "./support/auth";

test("create a plan, switch back, and reopen the last used plan", async ({ page }) => {
  const a = testName("A");
  const b = testName("B");
  await page.goto("/");
  const sidebar = page.getByRole("navigation", { name: "Sidebar" });

  // Plan A: via the menu, so no spec assumes an empty database.
  await sidebar
    .getByRole("button", { name: /^Budget$|ZZ-TEST/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "New Plan" }).click();
  await page.getByLabel("Plan name").fill(a);
  await page.getByRole("button", { name: "Create Plan" }).click();
  // Wait for the new name first: an existing plan may already be open at a similar URL.
  await expect(sidebar.getByRole("button", { name: a })).toBeVisible();
  await expect(page).toHaveURL(/\/[0-9a-f-]{36}\/budget$/);
  const urlA = page.url();

  await sidebar.getByRole("button", { name: a }).click();
  await page.getByRole("menuitem", { name: "New Plan" }).click();
  await page.getByLabel("Plan name").fill(b);
  await page.getByRole("button", { name: "Create Plan" }).click();
  await expect(sidebar.getByRole("button", { name: b })).toBeVisible();
  expect(page.url()).not.toBe(urlA);

  await sidebar.getByRole("button", { name: b }).click();
  await page.getByRole("menuitem", { name: /Open Plan/ }).click();
  await page.getByRole("menuitem", { name: a }).click();
  await expect(page).toHaveURL(urlA);
  await expect(sidebar.getByRole("button", { name: a })).toBeVisible();

  await page.goto("/");
  await expect(page).toHaveURL(urlA);
});
