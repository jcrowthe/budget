import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { card, cardLink, getPlan, ownPlan } from "./support/plans-list-seed";
import { realClick } from "./support/real-click";

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

const dialog = (page: Page) => page.getByRole("dialog", { name: "Delete Plan", exact: true });
const trashOf = (page: Page, name: string) =>
  card(page, name).getByRole("button", { name: "Delete Plan", exact: true });

async function askToDelete(page: Page, name: string) {
  await card(page, name).hover();
  await realClick(page, trashOf(page, name));
  await expect(dialog(page)).toBeVisible();
}

test("AC471-3 delete: the confirmation, the three ways out, one DELETE", async ({
  page,
  request,
}) => {
  const d1 = await ownPlan(request, "del1");
  const d2 = await ownPlan(request, "del2");
  const deletes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "DELETE") deletes.push(r.url());
  });
  await page.goto("/plans");
  await expect(cardLink(page, d2.name)).toBeVisible();

  await askToDelete(page, d1.name);
  await expect(
    dialog(page).getByText(`Are you sure you want to delete plan ${d1.name}?`, { exact: true }),
  ).toBeVisible();
  await realClick(page, dialog(page).getByRole("button", { name: "Cancel", exact: true }));
  await expect(dialog(page)).toHaveCount(0);
  await askToDelete(page, d1.name);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await askToDelete(page, d1.name);
  await realClick(page, dialog(page).getByRole("button", { name: "Close", exact: true }));
  await expect(dialog(page)).toHaveCount(0);
  expect(deletes).toHaveLength(0);
  expect((await getPlan(request, d1.id)).status()).toBe(200);

  await askToDelete(page, d1.name);
  await realClick(page, dialog(page).getByRole("button", { name: "Delete", exact: true }));
  await expect(card(page, d1.name)).toHaveCount(0);
  await expect(dialog(page)).toHaveCount(0);
  expect(deletes).toHaveLength(1);
  expect(deletes[0]).toContain(`/api/v1/budgets/${d1.id}`);
  expect(new URL(page.url()).pathname).toBe("/plans");
  await expect.poll(async () => (await getPlan(request, d1.id)).status()).toBe(404);
  const second = await getPlan(request, d2.id);
  expect(second.status()).toBe(200);
  expect((await second.json()).data.budget.name).toBe(d2.name);
  await expect(cardLink(page, d2.name)).toBeVisible();

  // The plan menu's list follows the cache.
  await page.getByRole("navigation", { name: "Sidebar" }).locator("button.plan-button").click();
  await page.getByRole("menuitem", { name: "Open Plan", exact: true }).click();
  await expect(page.getByRole("menu", { name: "Plans", exact: true })).toBeVisible();
  await expect(
    page.getByRole("menu", { name: "Plans", exact: true }).getByText(d1.name, { exact: true }),
  ).toHaveCount(0);
});

test("AC471-3 delete: a refusal shows its message and removes nothing", async ({
  page,
  request,
}) => {
  const d = await ownPlan(request, "delr");
  await page.route(`**/api/v1/budgets/${d.id}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: { id: "409", name: "conflict", detail: "ZZ refused" } }),
    });
  });
  await page.goto("/plans");
  await askToDelete(page, d.name);
  await realClick(page, dialog(page).getByRole("button", { name: "Delete", exact: true }));
  await expect(dialog(page).getByRole("alert")).toHaveText("ZZ refused");
  await expect(card(page, d.name)).toHaveCount(1);
  expect((await getPlan(request, d.id)).status()).toBe(200);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(card(page, d.name)).toHaveCount(1);
  // Clean up the spec's own plan.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await request.delete(`/api/v1/budgets/${d.id}`, { headers: await authHeaders() });
});
