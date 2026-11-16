import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const ISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;

type Req = import("@playwright/test").APIRequestContext;
let planId = "";

test.beforeEach(async ({ request }: { request: Req }) => {
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: testName("hidden") },
  });
  planId = (await res.json()).data.budget.id;
});
test.afterEach(async ({ request }: { request: Req }) => {
  await request.delete(`/api/v1/budgets/${planId}`, { headers: await authHeaders() });
});

const PHONE = "📱 Phone & Internet";
const ENTERTAINMENT = "🍿 Entertainment";

const open = async (page: Page) => {
  await page.goto(`/${planId}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
};
const groupRow = (page: Page, name: string) =>
  page.locator(".group-row", { has: page.getByText(name, { exact: true }) });
const popover = (page: Page, name: string) => page.getByRole("dialog", { name });
const hiddenRow = (page: Page) => page.locator(".hidden-categories-row");
const hide = async (page: Page, name: string) => {
  await page.locator(".category-name", { hasText: name }).click();
  await popover(page, "Edit Category").getByRole("button", { name: "Hide" }).click();
};

type Month = {
  ready_to_assign: number;
  groups: {
    id: string;
    name: string;
    hidden: boolean;
    categories: { id: string; name: string }[];
  }[];
};
async function month(request: Req): Promise<Month> {
  const res = await request.get(`/api/v1/budgets/${planId}/months/${ISO}`, {
    headers: await authHeaders(),
  });
  return (await res.json()).data;
}
async function assign(request: Req, name: string, assigned: number) {
  const id = (await month(request)).groups
    .flatMap((g) => g.categories)
    .find((c) => c.name === name)?.id;
  const res = await request.patch(`/api/v1/budgets/${planId}/months/${ISO}/categories/${id}`, {
    headers: await authHeaders(),
    data: { assigned },
  });
  expect(res.ok()).toBe(true);
}

test("hide a category: gone from its group and subtotal, RTA unchanged, a Hidden Categories row", async ({
  page,
  request,
}) => {
  await assign(request, PHONE, 15000);
  const rta = (await month(request)).ready_to_assign;
  await open(page);
  await expect(hiddenRow(page)).toHaveCount(0);
  await expect(groupRow(page, "Bills").locator(".num").first()).toHaveText("$15.00");
  await hide(page, PHONE);
  await expect(page.locator(".category-name", { hasText: PHONE })).toHaveCount(0);
  await expect(groupRow(page, "Bills").locator(".num").first()).toHaveText("$0.00");
  const row = hiddenRow(page);
  await expect(row).toBeVisible();
  await expect(row.locator(".num")).toHaveText(["$15.00", "$0.00", "$15.00"]);
  await expect(row.getByRole("checkbox")).toHaveCount(0);
  await expect(row.getByRole("button", { name: /Collapse|Expand/ })).toHaveCount(0);
  expect((await month(request)).ready_to_assign).toBe(rta);
  await page.reload();
  await expect(hiddenRow(page)).toBeVisible();
  await expect(page.locator(".category-name", { hasText: PHONE })).toHaveCount(0);
});

test("the popover lists hidden rows; unhide a category, a group, and show all", async ({
  page,
}) => {
  await open(page);
  await hide(page, PHONE);
  await page.locator(".group-name", { hasText: "Wants" }).click();
  await popover(page, "Edit Category Group").getByRole("button", { name: "Hide" }).click();
  await expect(page.locator(".group-name")).toHaveText(["Bills", "Needs"]);
  await hiddenRow(page).getByRole("button", { name: "Hidden Categories" }).click();
  const pop = popover(page, "Hidden Categories");
  await expect(pop.getByText("Click to unhide a category")).toBeVisible();
  await expect(pop.getByText("Group: Bills")).toBeVisible();
  await expect(pop.getByRole("button", { name: "Group: Bills" })).toHaveCount(0);
  await expect(pop.getByRole("button", { name: "Group: Wants" })).toBeVisible();
  await expect(pop.getByRole("button", { name: "Show all hidden categories" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);

  // A category back in its original place (second row of Bills).
  await hiddenRow(page).getByRole("button", { name: "Hidden Categories" }).click();
  await pop.getByRole("button", { name: PHONE }).click();
  await expect(groupRow(page, "Bills").locator("xpath=following-sibling::*[2]")).toContainText(
    PHONE,
  );

  // A category of a hidden group brings the group back with only that category.
  await hiddenRow(page).getByRole("button", { name: "Hidden Categories" }).click();
  await pop.getByRole("button", { name: ENTERTAINMENT }).click();
  await expect(page.locator(".group-name")).toHaveText(["Bills", "Needs", "Wants"]);
  await expect(page.locator(".category-name", { hasText: ENTERTAINMENT })).toBeVisible();
  await expect(page.locator(".category-name", { hasText: "Vacation" })).toHaveCount(0);
  await hiddenRow(page).getByRole("button", { name: "Hidden Categories" }).click();
  await expect(pop.getByText("Group: Wants")).toBeVisible();
  await expect(pop.getByRole("button", { name: "Group: Wants" })).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("a hidden group comes back whole from its Group: line", async ({ page }) => {
  await open(page);
  await page.locator(".group-name", { hasText: "Wants" }).click();
  await popover(page, "Edit Category Group").getByRole("button", { name: "Hide" }).click();
  await hiddenRow(page).getByRole("button", { name: "Hidden Categories" }).click();
  await popover(page, "Hidden Categories").getByRole("button", { name: "Group: Wants" }).click();
  await expect(page.locator(".category-row")).toHaveCount(11);
  await expect(hiddenRow(page)).toHaveCount(0);
});

test("Show all hidden categories unhides everything and persists", async ({ page, request }) => {
  await open(page);
  await hide(page, PHONE);
  await hide(page, ENTERTAINMENT);
  await expect(page.locator(".category-row")).toHaveCount(9);
  await hiddenRow(page).getByRole("button", { name: "Hidden Categories" }).click();
  await popover(page, "Hidden Categories")
    .getByRole("button", { name: "Show all hidden categories" })
    .click();
  await expect(page.locator(".category-row")).toHaveCount(11);
  await expect(hiddenRow(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".category-row")).toHaveCount(11);
  await expect(hiddenRow(page)).toHaveCount(0);
  const m = await month(request);
  expect(m.groups.every((g) => !g.hidden)).toBe(true);
});
