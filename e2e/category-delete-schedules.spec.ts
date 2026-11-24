import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { call, seed } from "./support/register-seed";
import { createSched, listSched } from "./support/scheduled-seed";

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

type Req = import("@playwright/test").APIRequestContext;
let planId = "";
test.afterEach(async ({ request }: { request: Req }) => {
  if (planId) await request.delete(`/api/v1/budgets/${planId}`, { headers: await authHeaders() });
});

async function setup(request: Req, schedules: number) {
  const s = await seed(request);
  planId = s.plan;
  const g = (
    await call(request, "POST", `/api/v1/budgets/${s.plan}/category_groups`, {
      name: "ZZ-TEST Keep",
    })
  ).category_group.id;
  const target = (
    await call(request, "POST", `/api/v1/budgets/${s.plan}/categories`, {
      group_id: g,
      name: "ZZ-TEST Target",
    })
  ).category.id as string;
  for (let i = 0; i < schedules; i++) {
    await createSched(request, s.plan, today, {
      account_id: s.checking,
      date_first: `${now.getFullYear() + 1}-01-1${i + 1}`,
      frequency: "monthly",
      amount: -1000,
      payee_name: `ZZ-TEST Sched ${i}`,
      category_id: s.category,
    });
  }
  return { ...s, target };
}

async function openDialog(page: Page) {
  await page.goto(`/${planId}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await page.locator(".category-name", { hasText: "D4 Groceries" }).click({ button: "right" });
  await page
    .getByRole("dialog", { name: "Edit Category" })
    .getByRole("button", { name: "Delete" })
    .click();
  return page.getByRole("dialog", { name: "Delete Category" });
}

test("the delete dialog counts the category's scheduled transactions and they move", async ({
  page,
  request,
}) => {
  const s = await setup(request, 2);
  const dialog = await openDialog(page);
  await expect(
    dialog.getByText("2 scheduled transactions will move to the new category"),
  ).toBeVisible();
  await dialog.getByRole("combobox", { name: "Select category" }).fill("ZZ-TEST Tar");
  await page.getByRole("option", { name: /ZZ-TEST Target/ }).click();
  await expect(
    dialog.getByText("2 scheduled transactions will move to ZZ-TEST Target"),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toHaveCount(0);
  const list = await listSched(request, s.plan);
  expect(list).toHaveLength(2);
  expect(list.map((x) => x.category_id)).toEqual([s.target, s.target]);
});

test("a category with no schedules shows no scheduled line", async ({ page, request }) => {
  await setup(request, 0);
  const dialog = await openDialog(page);
  await expect(dialog.getByText("All transactions")).toBeVisible();
  await expect(dialog.getByText(/scheduled transaction/)).toHaveCount(0);
});
