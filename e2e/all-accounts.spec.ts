import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

async function post(request: APIRequestContext, path: string, data: unknown) {
  const res = await request.post(path, { headers: await authHeaders(), data });
  expect(res.ok(), path).toBe(true);
  return (await res.json()).data;
}
async function seed(request: APIRequestContext) {
  const { budget } = await post(request, "/api/v1/budgets", { name: testName("all") });
  const open = async (name: string, type: string, balance: number, date: string) =>
    (await post(request, `/api/v1/budgets/${budget.id}/accounts`, { name, type, balance, date }))
      .account.id as string;
  const chk = await open("ZZ Chk", "checking", 250000, "2026-11-01");
  const card = await open("ZZ Card", "creditCard", 150000, "2026-11-02");
  const asset = await open("ZZ Asset", "otherAsset", 5000000, "2026-11-03");
  const tx = (account_id: string, date: string, amount: number, payee_name: string) =>
    post(request, `/api/v1/budgets/${budget.id}/transactions`, {
      account_id,
      date,
      amount,
      payee_name,
    });
  await tx(chk, "2026-11-08", -1000, "ZZ Old");
  await tx(asset, "2026-11-09", 2000, "ZZ Mid");
  await tx(card, "2026-11-10", -3000, "ZZ New");
  return { plan: budget.id as string, chk, card, asset };
}
const rows = (page: import("@playwright/test").Page) => page.locator(".register-table tbody tr");
const col = (page: import("@playwright/test").Page, n: number) =>
  page.locator(`.register-table tbody tr td:nth-child(${n})`).allTextContents();
const amount = (page: import("@playwright/test").Page, key: string) =>
  page.locator(`[data-balance="${key}"] .acct-amount`);

test("All Accounts: header and register", async ({ page, request }) => {
  const s = await seed(request);
  await page.goto(`/${s.plan}/accounts`);
  await expect(page.getByRole("heading", { level: 1, name: "All Accounts" })).toBeVisible();
  for (const name of ["Toggle Starred", "Edit Account", "Reconcile"]) {
    await expect(page.getByRole("main").getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByText("Not Yet Reconciled")).toHaveCount(0);
  // Checking 250000-1000, Credit -150000-3000, Asset 5000000+2000: cleared are the Starting Balances.
  await expect(amount(page, "cleared")).toHaveText("$5,100.00");
  await expect(amount(page, "uncleared")).toHaveText("-$2.00");
  await expect(amount(page, "working")).toHaveText("$5,098.00");
  const toolbar = page.getByRole("toolbar", { name: "Register toolbar" });
  await expect(toolbar.getByRole("button", { name: "Link Account" })).toHaveCount(0);
  await expect(page.getByPlaceholder("Search All Accounts")).toBeVisible();
  await expect(page.getByRole("columnheader")).toHaveText([
    "",
    "ACCOUNT",
    "DATE",
    "PAYEE",
    "CATEGORY",
    "MEMO",
    "OUTFLOW",
    "INFLOW",
    "",
  ]);
  await expect(page.getByRole("columnheader", { name: "DATE" })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await expect(rows(page)).toHaveCount(6);
  expect((await col(page, 4)).slice(0, 3)).toEqual(["ZZ New", "ZZ Mid", "ZZ Old"]);
  expect((await col(page, 2)).slice(0, 3)).toEqual(["ZZ Card", "ZZ Asset", "ZZ Chk"]);
  await expect(
    rows(page).filter({ hasText: "ZZ Mid" }).getByText("Category not needed"),
  ).toBeVisible();
});

test("All Accounts: sorting by account", async ({ page, request }) => {
  const s = await seed(request);
  await page.goto(`/${s.plan}/accounts`);
  await page.getByRole("button", { name: "ACCOUNT", exact: true }).click();
  const head = page.getByRole("columnheader", { name: "ACCOUNT" });
  await expect(head).toHaveAttribute("aria-sort", "descending");
  await expect(page.locator("th[aria-sort]")).toHaveCount(1);
  const names = await col(page, 2);
  expect(names).toEqual([...names].sort().reverse());
  await page.getByRole("button", { name: "ACCOUNT", exact: true }).click();
  await expect(head).toHaveAttribute("aria-sort", "ascending");
  expect(await col(page, 2)).toEqual([...names].sort());
  await page.getByRole("button", { name: "DATE", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "DATE" })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
});

test("a cleared toggle on All Accounts moves the totals and the account's page", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await page.goto(`/${s.plan}/accounts`);
  await rows(page)
    .filter({ hasText: "ZZ Old" })
    .getByRole("button", { name: "This transaction is uncleared" })
    .click();
  await expect(amount(page, "cleared")).toHaveText("$5,099.00");
  await expect(amount(page, "uncleared")).toHaveText("-$1.00");
  await expect(amount(page, "working")).toHaveText("$5,098.00");
  await page.goto(`/${s.plan}/accounts/${s.chk}`);
  await expect(amount(page, "cleared")).toHaveText("$249.00");
  await expect(amount(page, "uncleared")).toHaveText("$0.00");
});
