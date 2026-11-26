import type { Page } from "@playwright/test";
import { MATCH_TEXT, matchLabel } from "../packages/schema/src/manual-match";
import { DEFAULT_FORMATTER } from "../packages/schema/src/plan-formats";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { stubManualMatch } from "./support/manual-match-stub";
import { call, realClick } from "./support/register-seed";
import { daysAgo } from "./support/view-settings";

// EXF-464: manual match and unmatch in the register. Not compared with the source (it has no matched rows in the
// test plan, and none may be made): built from the ticket and the design. The import is a stand-in
// (e2e/support/manual-match-stub.ts); both rows of each pair are real hand rows.

const fmt = DEFAULT_FORMATTER;
const rows = (page: Page) => page.locator(".register-table tbody tr");
const row = (page: Page, payee: string) => rows(page).filter({ hasText: payee });
const check = (page: Page, payee: string) =>
  row(page, payee).getByRole("checkbox", { name: "Select transaction" });
const bar = (page: Page, name: string) =>
  page
    .getByRole("toolbar", { name: "Selection actions" })
    .getByRole("button", { name, exact: true });
const ICON = "This transaction has a matched transaction";

async function seed(request: Parameters<typeof call>[0]) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name: testName("match") });
  const plan = budget.id as string;
  const open = async (name: string, type: string) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
        name,
        type,
        balance: 100000,
        date: daysAgo(30),
      })
    ).account.id as string;
  const checking = await open("ZZ Checking", "checking");
  const savings = await open("ZZ Savings", "savings");
  const g = (
    await call(request, "POST", `/api/v1/budgets/${plan}/category_groups`, { name: "ZZ Group" })
  ).category_group.id;
  const food = (
    await call(request, "POST", `/api/v1/budgets/${plan}/categories`, {
      group_id: g,
      name: "ZZ Food",
    })
  ).category.id as string;
  const add = async (account: string, payee: string, amount: number, days: number, extra = {}) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
        account_id: account,
        date: daysAgo(days),
        amount,
        payee_name: payee,
        ...extra,
      })
    ).transaction.id as string;
  const entry = await add(checking, "ZZ Cafe", -12340, 5, { category_id: food });
  const imp = await add(checking, "ZZ Bank Cafe", -13000, 2, { approved: false });
  await add(checking, "ZZ Plain A", -1100, 8);
  await add(checking, "ZZ Plain B", -1200, 9);
  const preEntry = await add(checking, "ZZ Pre Entry", -5000, 12, { category_id: food });
  const preImp = await add(checking, "ZZ Pre Bank", -5500, 11, { approved: false });
  await add(savings, "ZZ Saved", -700, 4);
  return { plan, checking, savings, entry, imp, preEntry, preImp };
}

test("the matched row's icon, its tooltip and its panel by the keyboard", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await stubManualMatch(page, [{ entry: s.preEntry, imp: s.preImp, matched: true }]);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const icon = row(page, "ZZ Pre Entry").getByRole("button", { name: ICON, exact: true });
  await expect(icon).toBeVisible();
  await expect(
    row(page, "ZZ Plain A").getByRole("button", { name: ICON, exact: true }),
  ).toHaveCount(0);
  expect(await icon.evaluate((el) => !!el.closest("td.cell-attention"))).toBe(true);
  await icon.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Matched");
  // the keyboard: focus, Enter
  await icon.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Matched Transactions", exact: true });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole("heading", { name: "Matched Transactions", exact: true }),
  ).toBeVisible();
  // the entry's own row, then the bank's, in the plan's format
  const own = panel.locator("tbody tr").nth(0);
  const said = panel.locator("tbody tr").nth(1);
  await expect(own).toContainText("ZZ Pre Entry");
  await expect(own).toContainText(fmt.money(-5500));
  await expect(said).toContainText("ZZ Pre Bank");
  await expect(said).toContainText(fmt.money(-5500));
  await expect(panel.getByRole("button", { name: "Unmatch", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(icon).toBeFocused();
});

test("Match, then Unmatch, each with one request", async ({ page, request }) => {
  const s = await seed(request);
  const stub = await stubManualMatch(page, [{ entry: s.entry, imp: s.imp }]);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(row(page, "ZZ Bank Cafe")).toBeVisible();
  const total = await rows(page).count();
  await realClick(page, check(page, "ZZ Cafe"));
  await realClick(page, check(page, "ZZ Bank Cafe"));
  await expect(bar(page, "Match")).toBeVisible();
  await expect(bar(page, "Match")).not.toHaveAttribute("aria-disabled", "true");
  const before = stub.listGets();
  await realClick(page, bar(page, "Match"));
  await expect.poll(() => stub.posts.length).toBe(1);
  expect(((stub.posts[0]?.body ?? { ids: [] }) as { ids: string[] }).ids.sort()).toEqual(
    [s.entry, s.imp].sort(),
  );
  expect(stub.posts[0]?.url).toContain("/transactions/match");
  await expect(rows(page)).toHaveCount(total - 1);
  await expect(row(page, "ZZ Bank Cafe")).toHaveCount(0);
  await expect(row(page, "ZZ Cafe").getByRole("button", { name: ICON, exact: true })).toBeVisible();
  await expect(row(page, "ZZ Cafe")).toContainText(fmt.money(13000));
  const after = stub.listGets() - before;

  // the same count of list reads follows a bulk action (Flag on one row)
  await realClick(page, check(page, "ZZ Plain A"));
  const beforeFlag = stub.listGets();
  await realClick(page, bar(page, "Flag"));
  await page.getByRole("menuitem", { name: "Red", exact: true }).click();
  await expect.poll(() => stub.listGets() - beforeFlag).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  expect(after).toBeLessThanOrEqual(stub.listGets() - beforeFlag);

  // Unmatch from the bar, with the flagged row deselected
  await realClick(page, check(page, "ZZ Plain A"));
  await realClick(page, check(page, "ZZ Cafe"));
  await expect(bar(page, "Unmatch")).toBeVisible();
  await realClick(page, bar(page, "Unmatch"));
  await expect.poll(() => stub.posts.length).toBe(2);
  expect(stub.posts[1]?.url).toContain(`/transactions/${s.entry}/unmatch`);
  await expect(rows(page)).toHaveCount(total);
  await expect(row(page, "ZZ Bank Cafe")).toBeVisible();
  await expect(row(page, "ZZ Cafe").getByRole("button", { name: ICON, exact: true })).toHaveCount(
    0,
  );
});

test("two hand entries: Match is disabled with its reason and sends nothing", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  const stub = await stubManualMatch(page, [{ entry: s.entry, imp: s.imp }]);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await realClick(page, check(page, "ZZ Plain A"));
  await realClick(page, check(page, "ZZ Plain B"));
  const match = bar(page, "Match");
  await expect(match).toHaveAttribute("aria-disabled", "true");
  await match.hover();
  await expect(page.getByRole("tooltip")).toHaveText(MATCH_TEXT.needOneOfEach);
  await realClick(page, match, { allowDisabled: true });
  await page.waitForTimeout(300);
  expect(stub.posts).toHaveLength(0);
});

test("All Accounts: a pair of two accounts cannot be matched", async ({ page, request }) => {
  const s = await seed(request);
  await stubManualMatch(page, [{ entry: s.entry, imp: s.imp }]);
  await page.goto(`/${s.plan}/accounts`);
  await expect(row(page, "ZZ Saved")).toBeVisible();
  await realClick(page, check(page, "ZZ Cafe"));
  await realClick(page, check(page, "ZZ Saved"));
  const match = bar(page, "Match");
  await expect(match).toHaveAttribute("aria-disabled", "true");
  await match.hover();
  const a = { payee_name: "ZZ Cafe", date: daysAgo(5), amount: -12340 };
  const b = { payee_name: "ZZ Saved", date: daysAgo(4), amount: -700 };
  // the rows in the order the register lists them (newest first): the saved row, then the cafe
  const tip = await page.getByRole("tooltip").innerText();
  expect([
    MATCH_TEXT.differentAccounts(matchLabel(a, fmt), matchLabel(b, fmt)),
    MATCH_TEXT.differentAccounts(matchLabel(b, fmt), matchLabel(a, fmt)),
  ]).toContain(tip);
});
