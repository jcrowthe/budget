import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const TODAY = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

async function api(request: APIRequestContext, path: string, data: unknown) {
  const res = await request.post(path, { headers: await authHeaders(), data });
  expect(res.ok(), path).toBe(true);
  return (await res.json()).data;
}
async function seed(request: APIRequestContext) {
  const { budget } = await api(request, "/api/v1/budgets", { name: testName("register") });
  const open = (name: string, type: string, balance: number) =>
    api(request, `/api/v1/budgets/${budget.id}/accounts`, { name, type, balance, date: TODAY });
  const checking = (await open("ZZ Checking", "checking", 500000)).account;
  const asset = (await open("ZZ Asset", "otherAsset", 5000000)).account;
  const tx = (account_id: string, payee_name: string, amount: number, memo?: string) =>
    api(request, `/api/v1/budgets/${budget.id}/transactions`, {
      account_id,
      date: TODAY,
      amount,
      payee_name,
      memo,
    });
  await tx(checking.id, "ZZ Alpha", -25000, "m1");
  await tx(checking.id, "ZZ Beta", 10000);
  await tx(checking.id, "ZZ Gamma", -5000, "m3");
  return { plan: budget.id as string, checking: checking.id as string, asset: asset.id as string };
}
const payees = async (page: Page) =>
  page.locator(".register-table tbody tr td:nth-child(4)").allTextContents();
const rows = (page: Page) => page.locator(".register-table tbody tr");

test("toolbar, columns, Starting Balance and tracking account", async ({ page, request }) => {
  const s = await seed(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const toolbar = page.getByRole("toolbar", { name: "Register toolbar" });
  for (const name of ["Add Transaction", "File Import", "Undo", "Redo", "View"]) {
    await expect(toolbar.getByRole("button", { name })).toBeVisible();
  }
  await expect(toolbar.getByRole("button", { name: "Link Account" })).toHaveCount(0);
  await expect(page.getByPlaceholder("Search ZZ Checking")).toBeVisible();
  const heads = page.getByRole("columnheader");
  await expect(heads).toHaveText([
    "",
    "", // the flag column
    "DATE",
    "PAYEE",
    "CATEGORY",
    "MEMO",
    "OUTFLOW",
    "INFLOW",
    "",
  ]);
  await expect(page.locator("th[aria-sort]")).toHaveCount(1);
  await expect(page.getByRole("columnheader", { name: "DATE" })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await expect(rows(page)).toHaveCount(4);
  const start = rows(page).filter({ hasText: "Starting Balance" });
  await expect(start).toContainText("Inflow: Ready to Assign");
  await expect(start).toContainText("$500.00");
  await expect(start.getByRole("button", { name: "This transaction is cleared" })).toBeVisible();
  await expect(start).toContainText(
    `${TODAY.slice(5, 7)}/${TODAY.slice(8, 10)}/${TODAY.slice(0, 4)}`,
  );
  await expect(rows(page).filter({ hasText: "ZZ Alpha" })).toContainText("This needs a category");

  await page.goto(`/${s.plan}/accounts/${s.asset}`);
  await expect(page.getByRole("columnheader", { name: "CATEGORY" })).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("Starting Balance");
});

test("sorting", async ({ page, request }) => {
  const s = await seed(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rows(page)).toHaveCount(4);
  expect(await payees(page)).toEqual(["ZZ Alpha", "ZZ Gamma", "ZZ Beta", "Starting Balance"]);
  const head = (n: string) => page.getByRole("columnheader", { name: n });
  const click = (n: string) => head(n).getByRole("button").click();
  await click("PAYEE");
  await expect(head("PAYEE")).toHaveAttribute("aria-sort", "descending");
  await expect(page.locator("th[aria-sort]")).toHaveCount(1);
  expect(await payees(page)).toEqual(["ZZ Gamma", "ZZ Beta", "ZZ Alpha", "Starting Balance"]);
  await click("PAYEE");
  await expect(head("PAYEE")).toHaveAttribute("aria-sort", "ascending");
  expect(await payees(page)).toEqual(["Starting Balance", "ZZ Alpha", "ZZ Beta", "ZZ Gamma"]);
  await click("DATE");
  await expect(head("DATE")).toHaveAttribute("aria-sort", "descending");
  expect(await payees(page)).toEqual(["ZZ Alpha", "ZZ Gamma", "ZZ Beta", "Starting Balance"]);
  await click("OUTFLOW");
  await expect(head("OUTFLOW")).toHaveAttribute("aria-sort", "descending");
  await expect(page.locator("th[aria-sort]")).toHaveCount(1);
  expect((await payees(page)).slice(0, 2)).toEqual(["ZZ Alpha", "ZZ Gamma"]);
  await click("INFLOW");
  await expect(head("INFLOW")).toHaveAttribute("aria-sort", "descending");
  await expect(page.locator("th[aria-sort]")).toHaveCount(1);
  expect((await payees(page)).slice(0, 2)).toEqual(["Starting Balance", "ZZ Beta"]);
});

test("cleared toggle moves the balances without a reload", async ({ page, request }) => {
  const s = await seed(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const balance = (label: string) =>
    page.locator(`[data-balance="${label.split(" ")[0]?.toLowerCase()}"] .acct-amount`);
  await expect(balance("Cleared Balance")).toHaveText("$500.00");
  await expect(balance("Uncleared Balance")).toHaveText("−$20.00");
  const row = rows(page).filter({ hasText: "ZZ Alpha" });
  await row.getByRole("button", { name: "This transaction is uncleared" }).click();
  await expect(row.getByRole("button", { name: "This transaction is cleared" })).toBeVisible();
  await expect(balance("Cleared Balance")).toHaveText("$475.00");
  await expect(balance("Working Balance")).toHaveText("$480.00");
  // Clearing leaves the working balance unchanged, so the sidebar row still reads it.
  await expect(
    page.getByRole("navigation", { name: "Sidebar" }).locator(".nav-account-row").first(),
  ).toContainText("$480.00");
  await row.getByRole("button", { name: "This transaction is cleared" }).click();
  await expect(balance("Cleared Balance")).toHaveText("$500.00");
  await expect(balance("Uncleared Balance")).toHaveText("−$20.00");
  await expect(balance("Working Balance")).toHaveText("$480.00");
});

test("selection and the error state", async ({ page, request }) => {
  const s = await seed(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const all = page.getByRole("checkbox", { name: "Select all transactions" });
  await expect(rows(page)).toHaveCount(4);
  // The shell may write on page load (e.g. the plan's last-opened time); only selection is under test.
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET") writes.push(r.url());
  });
  await rows(page).first().getByRole("checkbox").click();
  await expect(rows(page).first()).toHaveClass(/is-checked/);
  await expect(all).toHaveAttribute("aria-checked", "mixed");
  await all.click();
  await expect(all).toHaveAttribute("aria-checked", "true");
  await all.click();
  await expect(all).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("tr.is-checked")).toHaveCount(0);
  expect(writes).toEqual([]);

  await page.route("**/accounts/*/transactions", (route) =>
    route.fulfill({ status: 500, body: "{}" }),
  );
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(page.getByRole("alert")).toContainText("Couldn't load transactions.");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText("Working Balance")).toBeVisible();
});
