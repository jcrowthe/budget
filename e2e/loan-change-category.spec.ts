import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { realClick } from "./support/real-click";
import { call, MONTH } from "./support/register-seed";

// Change category on a paired loan's Paired Plan Category panel: re-pairs in one call; Undo restores it.
const PAIRED = "ZZ-TEST Loans: ZZ-TEST Mortgage Pay";

async function seed(request: APIRequestContext) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: testName("change category"),
  });
  const plan = budget.id as string;
  const base = `/api/v1/budgets/${plan}`;
  const mortgage = (
    await call(request, "POST", `${base}/accounts`, {
      date: MONTH,
      name: "ZZ-TEST Mortgage",
      type: "mortgage",
      balance: 200000000,
      interest_rate: "6",
      minimum_payment: 1500000,
      new_category: { name: "ZZ-TEST Mortgage Pay", new_group_name: "ZZ-TEST Loans" },
    })
  ).account as { id: string; paired_category_id: string };
  await call(request, "POST", `${base}/accounts`, {
    date: MONTH,
    name: "ZZ-TEST Checking",
    type: "checking",
    balance: 5000000,
  });
  const group = (await call(request, "POST", `${base}/category_groups`, { name: "ZZ-TEST Other" }))
    .category_group.id as string;
  await call(request, "POST", `${base}/categories`, { group_id: group, name: "ZZ-TEST Other Pay" });
  return { plan, mortgage: mortgage.id, first: mortgage.paired_category_id };
}

const panel = (p: Page) => p.getByRole("region", { name: "Paired Plan Category" });
const dlg = (p: Page) => p.getByRole("dialog", { name: "Pair a Category" });
async function open(page: Page, s: { plan: string; mortgage: string }) {
  await page.goto(`/${s.plan}/accounts/${s.mortgage}`);
  await expect(panel(page).getByRole("link", { name: PAIRED })).toBeVisible();
}
async function change(page: Page) {
  await realClick(page, panel(page).getByRole("button", { name: "Change category", exact: true }));
}
const paired = async (request: APIRequestContext, s: { plan: string; mortgage: string }) =>
  (await call(request, "GET", `/api/v1/budgets/${s.plan}/accounts/${s.mortgage}`)).account
    .paired_category_id as string | null;

test("Change category opens with the current category selected", async ({ page, request }) => {
  const s = await seed(request);
  await open(page, s);
  await change(page);
  await expect(dlg(page).getByLabel("Select a category")).toHaveValue(s.first);
  await expect(dlg(page).getByRole("button", { name: "Save" })).toBeEnabled();
});

test("Picking another category re-pairs, and a reload keeps it", async ({ page, request }) => {
  const s = await seed(request);
  await open(page, s);
  await change(page);
  await dlg(page).getByLabel("Select a category").selectOption({ label: "ZZ-TEST Other Pay" });
  await realClick(page, dlg(page).getByRole("button", { name: "Save" }));
  await expect(dlg(page)).toHaveCount(0);
  const link = panel(page).getByRole("link", { name: "ZZ-TEST Other: ZZ-TEST Other Pay" });
  await expect(link).toBeVisible();
  await page.reload();
  await expect(link).toBeVisible();
  expect(await paired(request, s)).not.toBe(s.first);
});

test("Create a new category re-pairs with it", async ({ page, request }) => {
  const s = await seed(request);
  await open(page, s);
  await change(page);
  await dlg(page).getByText("Create a new category").click();
  await dlg(page).getByLabel("Give your category a name").fill("ZZ-TEST Fresh");
  await dlg(page).getByLabel("Add to category group").selectOption({ label: "ZZ-TEST Other" });
  await realClick(page, dlg(page).getByRole("button", { name: "Save" }));
  await expect(
    panel(page).getByRole("link", { name: "ZZ-TEST Other: ZZ-TEST Fresh" }),
  ).toBeVisible();
});

test("Undo restores the previous pairing", async ({ page, request }) => {
  const s = await seed(request);
  await open(page, s);
  await change(page);
  await dlg(page).getByLabel("Select a category").selectOption({ label: "ZZ-TEST Other Pay" });
  await realClick(page, dlg(page).getByRole("button", { name: "Save" }));
  await expect(
    panel(page).getByRole("link", { name: "ZZ-TEST Other: ZZ-TEST Other Pay" }),
  ).toBeVisible();
  // The loan page has no Undo button of its own: the plan's stack is the app's, so Undo on another page reaches it.
  await page.getByRole("link", { name: /ZZ-TEST Checking/ }).click();
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await page.getByRole("link", { name: /ZZ-TEST Mortgage/ }).click();
  await expect(panel(page).getByRole("link", { name: PAIRED })).toBeVisible();
  expect(await paired(request, s)).toBe(s.first);
});
