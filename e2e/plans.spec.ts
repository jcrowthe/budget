import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import { mouseClick } from "./support/menu";

test("create a plan, switch back, and reopen the last used plan", async ({ page, request }) => {
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

  // The submenu lists the 5 most recently opened other plans, and parallel workers open plans too.
  const idA = urlA.split("/")[3];
  await request.patch(`/api/v1/budgets/${idA}`, {
    headers: await authHeaders(),
    data: { opened: true },
  });
  await sidebar.getByRole("button", { name: b }).click();
  const openPlan = page.getByRole("menuitem", { name: "Open Plan", exact: true });
  await mouseClick(page, openPlan);
  const rowA = page
    .getByRole("menu", { name: "Plans" })
    .getByRole("menuitem", { name: a, exact: true });
  // Move along the Open Plan row into the submenu so the pointer never leaves the two menus.
  const ob = await openPlan.boundingBox();
  const sb = await page.getByRole("menu", { name: "Plans" }).boundingBox();
  await page.mouse.move((sb?.x ?? 0) + 20, (ob?.y ?? 0) + (ob?.height ?? 0) / 2);
  await mouseClick(page, rowA);
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
  await expect(page).toHaveURL(new RegExp(`/${latest.id}/budget$`));
  expect(budgets.find((b) => urlA.includes(b.id))?.last_opened_at).not.toBeNull();
});
