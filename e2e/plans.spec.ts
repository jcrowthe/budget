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
  await expect(page).toHaveURL(/\/[0-9a-f-]{36}\/budget\/\d{6}$/);
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

  // Other workers open plans too: compare with the list the page itself loaded.
  const resp = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/budgets") && r.request().method() === "GET",
  );
  await page.goto("/");
  const budgets = (await (await resp).json()).data.budgets as {
    id: string;
    last_opened_at: string | null;
  }[];
  const latest = budgets.reduce((a, b) =>
    (b.last_opened_at ?? "") > (a.last_opened_at ?? "") ? b : a,
  );
  await expect(page).toHaveURL(new RegExp(`/${latest.id}/budget/\\d{6}$`));
  expect(budgets.find((b) => urlA.includes(b.id))?.last_opened_at).not.toBeNull();
});
