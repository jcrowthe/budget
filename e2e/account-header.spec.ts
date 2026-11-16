import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

const DAY = "2026-11-10";
const GREEN = "rgb(119, 186, 33)";
const WHITE = "rgb(255, 255, 255)";
const GOLD = "rgb(248, 214, 85)"; // the source's star colour #f8d655, in its CSS (docs/account-header-design.md)

async function post(request: APIRequestContext, path: string, data: unknown) {
  const res = await request.post(path, { headers: await authHeaders(), data });
  expect(res.ok(), path).toBe(true);
  return (await res.json()).data;
}
async function seed(request: APIRequestContext, type = "checking", balance = 250000) {
  const { budget } = await post(request, "/api/v1/budgets", { name: testName("header") });
  const { account } = await post(request, `/api/v1/budgets/${budget.id}/accounts`, {
    name: "ZZ Chk",
    type,
    balance,
    date: DAY,
  });
  return { plan: budget.id as string, account: account.id as string };
}
const tx = (
  request: APIRequestContext,
  plan: string,
  account_id: string,
  amount: number,
  cleared: string,
) =>
  post(request, `/api/v1/budgets/${plan}/transactions`, {
    account_id,
    date: DAY,
    amount,
    cleared,
    payee_name: "ZZ Payee",
  });
const amount = (page: Page, key: string) => page.locator(`[data-balance="${key}"] .acct-amount`);
const TIPS = {
  cleared:
    "The total of all transactions that your bank knows about and that are not currently pending. This should match the cleared (sometimes called posted or current) balance at your bank!",
  uncleared:
    "The total of all uncleared transactions. This includes transactions you've manually entered that your bank does not know about yet, as well as only those pending transactions from your bank that you've chosen to Enter Now.",
  working:
    "The sum of your cleared and uncleared transactions. This represents the money you have available to spend (or owe, in the case of credit cards and loan accounts).",
};

test("a Checking account's header", async ({ page, request }) => {
  const s = await seed(request);
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  await expect(page.getByRole("heading", { level: 1, name: "ZZ Chk" })).toBeVisible();
  const star = page.getByRole("button", { name: "Toggle Starred", exact: true });
  await expect(star).toHaveAttribute("aria-pressed", "false");
  const head = page.locator("header.acct-head");
  await expect(head.getByText("Checking", { exact: true })).toBeVisible();
  await expect(head.getByText("Not Yet Reconciled")).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("button", { name: "Edit Account", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("button", { name: "Reconcile", exact: true }),
  ).toBeVisible();
});

test("the worked example, and a cleared toggle without a reload", async ({ page, request }) => {
  const s = await seed(request);
  await tx(request, s.plan, s.account, 312500, "cleared");
  await tx(request, s.plan, s.account, -250000, "uncleared");
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  await expect(amount(page, "cleared")).toHaveText("$562.50");
  await expect(amount(page, "uncleared")).toHaveText("-$250.00");
  await expect(amount(page, "working")).toHaveText("$312.50");
  await expect(amount(page, "cleared")).toHaveCSS("color", GREEN);
  await expect(amount(page, "working")).toHaveCSS("color", GREEN);
  await expect(amount(page, "uncleared")).toHaveCSS("color", WHITE);
  await page
    .locator(".register-table tbody tr")
    .filter({ hasText: "ZZ Payee" })
    .filter({ hasText: "250.00" })
    .getByRole("button", { name: "This transaction is uncleared" })
    .click();
  await expect(amount(page, "cleared")).toHaveText("$312.50");
  await expect(amount(page, "uncleared")).toHaveText("$0.00");
  await expect(amount(page, "uncleared")).toHaveCSS("color", GREEN);
  await expect(amount(page, "working")).toHaveText("$312.50");
});

test("tooltips on the balances, the pencil and Reconcile", async ({ page, request }) => {
  const s = await seed(request);
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  for (const key of ["cleared", "uncleared", "working"] as const) {
    await page.locator(`[data-balance="${key}"]`).hover();
    await expect(page.getByRole("tooltip")).toHaveText(TIPS[key], { timeout: 5000 });
    await page.mouse.move(0, 0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
  await page.locator('[data-balance="cleared"]').focus();
  await expect(page.getByRole("tooltip")).toHaveText(TIPS.cleared, { timeout: 5000 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.getByRole("main").getByRole("button", { name: "Edit Account", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Edit Account", { timeout: 5000 });
  await page.mouse.move(0, 0);
  await page.getByRole("main").getByRole("button", { name: "Reconcile", exact: true }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("ReconcileshiftE", { timeout: 1000 });
});

test("badges for tracking and credit accounts", async ({ page, request }) => {
  for (const [type, text] of [
    ["otherAsset", "Tracking Account: Asset"],
    ["otherLiability", "Tracking Account: Liability"],
    ["creditCard", "Credit Card"],
  ] as const) {
    const s = await seed(request, type, 100000);
    await page.goto(`/${s.plan}/accounts/${s.account}`);
    await expect(page.locator(".acct-info-item").first()).toHaveText(text);
    await expect(page.locator(".acct-info-item svg").first()).toBeVisible();
  }
});

test("starring turns the star gold and fills the sidebar's STARRED group", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  const sidebar = page.getByRole("navigation", { name: "Sidebar" });
  const starred = sidebar.locator("[data-group=starred]");
  await expect(starred).toHaveCount(0);
  const star = page.getByRole("button", { name: "Toggle Starred", exact: true });
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await expect(star).toHaveCSS("color", GOLD);
  await expect(starred.getByText("ZZ Chk")).toBeVisible();
  await page.reload();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await expect(starred.getByText("ZZ Chk")).toBeVisible();
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await expect(starred).toHaveCount(0);
});

test("a closed account's header has no star", async ({ page, request }) => {
  const s = await seed(request);
  await page.route(`**/api/v1/budgets/*/accounts/${s.account}`, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.data.account.closed = true;
    body.data.account.group = "closed";
    await route.fulfill({ response: res, json: body });
  });
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  await expect(page.getByRole("heading", { level: 1, name: "ZZ Chk" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Toggle Starred", exact: true })).toHaveCount(0);
});
