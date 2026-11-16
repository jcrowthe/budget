import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { box, panel, removePlan, row } from "./plan-panel.fixtures";
import { authHeaders, testName } from "./support/auth";
import { realClick } from "./support/real-click";

// EXF-537: the PAYMENT header and dialog, the payment pills and the five Payment states of the inspector at
// 1440x900. The clock is fixed in November 2026; the plan and every row are made through the API.

const MONTH = "2026-11-01";
const ENOUGH = "ZZ Enough";
const CLEAR = "ZZ Clear";
const DEBT = "ZZ Debt";
const OVER = "ZZ Over";
const SPENT = "ZZ Spent";

type Seed = { id: string; cards: Record<string, string> };

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
  const { budget } = await call(request, "post", "/api/v1/budgets", { name: testName("cards") });
  const base = `/api/v1/budgets/${budget.id}`;
  const open = async (name: string, type: string, balance: number) =>
    (await call(request, "post", `${base}/accounts`, { name, type, balance, date: "2026-11-02" }))
      .account.id as string;
  const checking = await open("ZZ Checking", "checking", 2000000);
  const cards: Record<string, string> = {};
  // A positive balance on a card is money owed.
  for (const [name, owed] of [
    [ENOUGH, 0],
    [CLEAR, 0],
    [DEBT, 1200000],
    [OVER, 0],
    [SPENT, 0],
  ] as const) {
    cards[name] = await open(name, "creditCard", owed);
  }
  const { category_group: g } = await call(request, "post", `${base}/category_groups`, {
    name: "ZZ Group",
  });
  const cat = async (name: string, assigned: number) => {
    const id = (await call(request, "post", `${base}/categories`, { group_id: g.id, name }))
      .category.id as string;
    await call(request, "patch", `${base}/months/${MONTH}/categories/${id}`, { assigned });
    return id;
  };
  const tx = (account: string, amount: number, category?: string, to?: string) =>
    call(request, "post", `${base}/transactions`, {
      account_id: account,
      date: "2026-11-10",
      amount,
      ...(category ? { category_id: category } : {}),
      ...(to ? { transfer_account_id: to } : {}),
    });
  // Enough: 120.00 spent from a funded category.
  await tx(cards[ENOUGH] as string, -120000, await cat("ZZ Fun", 300000));
  // Overpaid: 335.00 spent and 385.00 paid.
  await tx(cards[OVER] as string, -335000, await cat("ZZ Bills", 335000));
  await tx(checking, -385000, undefined, cards[OVER]);
  // Overspent categories: 170.00 funded, 30.00 more spent in a category with nothing assigned.
  await tx(cards[SPENT] as string, -170000, await cat("ZZ Food", 170000));
  await tx(cards[SPENT] as string, -30000, await cat("ZZ Treats", 0));
  return { id: budget.id, cards };
}

const open = async (page: Page, s: Seed) => {
  await page.goto(`/${s.id}/budget/202611`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(row(page, DEBT)).toBeVisible();
};
const pill = (page: Page, name: string) => row(page, name).locator(".available-pill");
const tick = async (page: Page, name: string) => {
  await realClick(page, box(page, name));
  await expect(panel(page).getByRole("heading", { name, exact: true })).toBeVisible();
};
const untick = async (page: Page, name: string) => {
  await realClick(page, box(page, name));
  await expect(box(page, name)).toHaveAttribute("aria-checked", "false");
};
const card = (page: Page) => panel(page).locator("section.payment-card");

test.describe("card payments, 1440x900", () => {
  let s: Seed;
  test.beforeEach(async ({ request, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(new Date("2026-11-16T12:00:00"));
    s = await seed(request);
  });
  test.afterEach(async ({ request }) => {
    await removePlan(request, s as never);
  });

  test("13. the PAYMENT button opens the Using Credit Cards dialog", async ({ page }) => {
    await open(page, s);
    const group = page.locator(".group-row", { hasText: "Credit Card Payments" });
    const button = group.getByRole("button", { name: "PAYMENT", exact: true });
    await expect(button).toBeVisible();
    const [b, total] = await Promise.all([
      button.boundingBox(),
      group.locator(".cell-available > span").boundingBox(),
    ]);
    expect((b?.y ?? 0) + (b?.height ?? 0)).toBeLessThanOrEqual((total?.y ?? 0) + 1);
    await realClick(page, button);
    const dialog = page.getByRole("dialog", { name: "Using Credit Cards", exact: true });
    await expect(dialog).toContainText(
      "You assigned money to your categories, then charged a purchase on your card, so we moved the money from your categories to your credit card payment.",
    );
    await expect(dialog.getByText("When you buy 100 of groceries")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Show More", exact: true }).click();
    await expect(dialog.getByText("When you buy 100 of groceries")).toBeVisible();
    await dialog.getByRole("button", { name: "Got it!", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test("14. the payment pills are green, grey, yellow and red", async ({ page }) => {
    await open(page, s);
    await expect(pill(page, ENOUGH)).toHaveClass(/positive/);
    await expect(pill(page, CLEAR)).toHaveClass(/zero/);
    await expect(pill(page, DEBT)).toHaveClass(/cautious/);
    await expect(pill(page, DEBT)).toContainText("$0.00");
    await expect(pill(page, OVER)).toHaveClass(/negative/);
    // Payment rows have no progress bar.
    await page.getByRole("tab", { name: "Progress Bars On" }).click();
    await expect(page.getByRole("tab", { name: "Progress Bars On" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(row(page, "ZZ Fun").locator(".progress-bar")).toHaveCount(1);
    await expect(row(page, DEBT).locator(".progress-bar")).toHaveCount(0);
  });

  test("15. each payment row shows exactly one Payment state with its copy", async ({ page }) => {
    await open(page, s);
    const noLinks = async () => {
      for (const t of [
        "Why am I seeing this warning?",
        "Why does overspending affect my payment?",
        "Why is my payment underfunded?",
        "View Help Topic",
        "Create a Debt Payoff Target",
      ]) {
        await expect(panel(page).getByText(t)).toHaveCount(0);
      }
    };

    await tick(page, CLEAR);
    await expect(card(page)).toHaveCount(1);
    await expect(card(page)).toContainText("Your ZZ Clear is paid off!");
    await expect(card(page)).toContainText("Being debt free is a wonderful thing.");
    await noLinks();
    await untick(page, CLEAR);

    await tick(page, OVER);
    await expect(card(page)).toHaveCount(1);
    await expect(card(page)).toContainText(
      "You sent more to ZZ Over than you had set aside for the payment.",
    );
    await noLinks();
    await untick(page, OVER);

    await tick(page, ENOUGH);
    await expect(card(page)).toContainText(
      "You have enough money to pay off your current balance!",
    );
    await expect(card(page)).toContainText("You can make this payment anytime.");
    await untick(page, ENOUGH);

    await tick(page, DEBT);
    await expect(card(page)).toContainText("Underfunded");
    await expect(card(page)).toContainText(
      "You need to assign $1,200.00 more to pay off your current balance.",
    );
    await expect(
      panel(page).locator(".payment-total", { hasText: "Total Underfunded" }),
    ).toContainText("$1,200.00");
    await noLinks();
    await untick(page, DEBT);

    await tick(page, SPENT);
    await expect(card(page)).toContainText(
      "Cover $30.00 in overspent categories in order to pay off your current balance.",
    );
    await expect(
      panel(page).locator(".payment-total", { hasText: "Total Underfunded" }),
    ).toContainText("$30.00");
    await expect(
      panel(page).locator(".payment-total", { hasText: "Overspent Categories" }),
    ).toContainText("$30.00");
    await noLinks();
    await realClick(
      page,
      panel(page).getByRole("button", { name: "Cover Overspent Categories", exact: true }),
    );
    await expect(
      page.locator(".view-chips").getByRole("button", { name: /Overspent/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("15b. Record Payment opens the card's account page", async ({ page }) => {
    await open(page, s);
    await tick(page, ENOUGH);
    await realClick(page, panel(page).getByRole("button", { name: "Record Payment", exact: true }));
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe(`/${s.id}/accounts/${s.cards[ENOUGH]}`);
  });

  test("16. the balance section and the card's Auto-Assign", async ({ page }) => {
    await open(page, s);
    await tick(page, DEBT);
    const p = panel(page);
    const balance = p.locator(".panel-card", { hasText: "Current Balance" });
    await expect(balance.getByRole("button", { name: /Current Balance/ })).toContainText(
      "−$1,200.00",
    );
    for (const [label, value] of [
      ["Prior Balance", "−$1,200.00"],
      ["Spending and Outflows", "$0.00"],
      ["Interest Charges", "$0.00"],
      ["Payments and Inflows", "$0.00"],
    ]) {
      await expect(balance.locator(".panel-row", { hasText: label })).toContainText(value);
    }
    const forPayment = p.locator(".panel-card", { hasText: "Available for Payment" });
    await expect(forPayment.locator(".available-pill")).toBeVisible();
    await expect(forPayment.getByText("Assigned This Month")).toBeHidden();
    await forPayment.getByRole("button", { name: /Available for Payment/ }).click();
    for (const l of ["Cash Left Over From Last Month", "Assigned This Month", "Activity"]) {
      await expect(forPayment.getByText(l, { exact: true })).toBeVisible();
    }
    await expect(p.locator("#panel-auto-assign button.auto-assign-option span")).toHaveText([
      "Underfunded",
      "Assigned Last Month",
      "Paid Last Month",
      "Average Assigned",
      "Average Paid",
      "Reset Available Amount",
      "Reset Assigned Amount",
    ]);
    await expect(
      p.locator("#panel-auto-assign button.auto-assign-option", { hasText: "Underfunded" }),
    ).toContainText("$1,200.00");
  });
});
