import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { box, panel, removePlan, row } from "./plan-panel.fixtures";
import { authHeaders, testName } from "./support/auth";
import { realClick } from "./support/real-click";

// EXF-535 (pills, inspector messages, chip) and EXF-532 (the Credit Card Payments group is not editable).
// The clock is fixed in November 2026; the plan and every row are made through the API.

const MONTH = "2026-11-01";
const SIZES = [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
] as const;
const VISA = "ZZ-TEST Visa";
const CREDIT = "ZZ Credit";
const CASH = "ZZ Cash";
const MIXED = "ZZ Mixed";

type Seed = { id: string; cat: Record<string, string> };

async function call(
  request: APIRequestContext,
  method: "post" | "patch",
  path: string,
  data: unknown,
) {
  const res = await request[method](path, { headers: await authHeaders(), data });
  expect(res.ok(), `${method} ${path}`).toBe(true);
  return (await res.json()).data;
}

async function seed(request: APIRequestContext): Promise<Seed> {
  const { budget } = await call(request, "post", "/api/v1/budgets", { name: testName("credit") });
  const base = `/api/v1/budgets/${budget.id}`;
  const open = async (name: string, type: string, balance: number) =>
    (await call(request, "post", `${base}/accounts`, { name, type, balance, date: "2026-11-02" }))
      .account.id;
  const checking = await open("ZZ-TEST Checking", "checking", 100000);
  const visa = await open(VISA, "creditCard", 0);
  const { category_group: g } = await call(request, "post", `${base}/category_groups`, {
    name: "ZZ Group",
  });
  const cat: Record<string, string> = {};
  for (const name of [CREDIT, CASH, MIXED]) {
    cat[name] = (
      await call(request, "post", `${base}/categories`, { group_id: g.id, name })
    ).category.id;
  }
  await call(request, "patch", `${base}/months/${MONTH}/categories/${cat[CREDIT]}`, {
    assigned: 50000,
  });
  const tx = (account: string, amount: number, category: string) =>
    call(request, "post", `${base}/transactions`, {
      account_id: account,
      date: "2026-11-10",
      amount,
      category_id: cat[category],
    });
  await tx(visa, -80000, CREDIT);
  await tx(checking, -25000, CASH);
  await tx(checking, -25000, MIXED);
  await tx(visa, -40000, MIXED);
  return { id: budget.id, cat };
}

const open = async (page: Page, s: Seed) => {
  await page.goto(`/${s.id}/budget/202611`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(page.locator(".category-row").first()).toBeVisible();
};
const pill = (page: Page, name: string) => row(page, name).locator(".available-pill");

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    let s: Seed;
    test.beforeEach(async ({ request, page }) => {
      await page.setViewportSize(size);
      await page.clock.setFixedTime(new Date("2026-11-16T12:00:00"));
      s = await seed(request);
    });
    test.afterEach(async ({ request }) => {
      await removePlan(request, { id: s.id } as never);
    });

    test("EXF-535: yellow credit pill, red cash and mixed pills, the chip", async ({ page }) => {
      await open(page, s);
      const credit = pill(page, CREDIT);
      await expect(credit).toHaveClass(/cautious/);
      await expect(credit).toHaveClass(/credit/);
      await expect(credit.locator('svg[data-icon="card"]')).toHaveCount(1);
      await expect(credit).toHaveText("−$30.00");
      for (const n of [CASH, MIXED]) {
        await expect(pill(page, n)).toHaveClass(/negative/);
        await expect(pill(page, n).locator("svg")).toHaveCount(0);
      }
      await expect(pill(page, CASH)).toHaveText("−$25.00");
      await expect(pill(page, MIXED)).toHaveText("−$65.00");
      await expect(
        page.locator(".view-chips").getByRole("button", { name: "3 Overspent", exact: true }),
      ).toBeVisible();
    });

    test("EXF-535: the three inspector messages and the spending lines", async ({ page }) => {
      await open(page, s);
      const msg = panel(page).locator(".inspector-message");
      await realClick(page, box(page, CREDIT));
      await expect(msg).toHaveText(
        "You've overspent this category by $30.00 with credit. Cover this overspending to avoid creating debt!",
      );
      await expect(msg).toHaveClass(/cautious/);
      await realClick(page, box(page, CREDIT));
      await realClick(page, box(page, CASH));
      await expect(msg).toHaveText(
        "You've overspent this category by $25.00. Cover this overspending or you can’t trust your plan balances!",
      );
      await expect(msg).toHaveClass(/negative/);
      await realClick(page, box(page, CASH));
      await realClick(page, box(page, MIXED));
      await expect(msg).toHaveText(
        "You've overspent this category by $65.00 with cash and credit. Add at least $25.00 to this category or you can’t trust your plan balances!",
      );
      const line = (label: string) =>
        panel(page)
          .locator(".panel-row", { has: page.getByText(label, { exact: true }) })
          .locator(".panel-row-value");
      await expect(line("Cash Spending")).toHaveText("−$25.00");
      await expect(line("Credit Spending")).toHaveText("−$40.00");
    });

    test("EXF-532: the Credit Card Payments group and its rows cannot be edited", async ({
      page,
    }) => {
      await open(page, s);
      const first = page.locator(".group-row").first();
      await expect(first).toContainText("Credit Card Payments");
      await expect(first.getByRole("button", { name: "Add Category", exact: true })).toHaveCount(0);
      await realClick(page, first.locator(".group-name"));
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(row(page, VISA)).toBeVisible();
      await realClick(page, box(page, VISA));
      await realClick(page, row(page, VISA).locator(".category-name"));
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: `Edit category: ${VISA}`, exact: true }),
      ).toHaveCount(0);
      await expect(panel(page).getByRole("heading", { name: VISA, exact: true })).toBeVisible();
      await expect(panel(page).locator("#panel-target")).toHaveCount(0);
    });
  });
}
