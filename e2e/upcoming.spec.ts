import type { Locator, Page } from "@playwright/test";
import { autoCard, option } from "./auto-assign.fixtures";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import { call } from "./support/register-seed";
import { createSched, fixClock } from "./support/scheduled-seed";

// EXF-505: upcoming. The clock is 2026-11-15; a Weekly -20.00 schedule starts 2026-11-22 on "ZZ-TEST Fun", which
// has 50.00 assigned in November and 20.00 spent on 11/10: Available 30.00, upcoming -40.00, after upcoming -10.00.
const TODAY = "2026-11-15";
const NOV = "2026-11-01";
const FUN = "ZZ-TEST Fun";

type Req = import("@playwright/test").APIRequestContext;
const api = (plan: string, path: string) => `/api/v1/budgets/${plan}${path}`;

async function seedPlan(request: Req) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name: testName("upcoming") });
  const plan = budget.id as string;
  const checking = (
    await call(request, "POST", api(plan, "/accounts"), {
      name: "ZZ-TEST Checking",
      type: "checking",
      balance: 0,
      date: "2026-11-01",
    })
  ).account.id as string;
  const g = (await call(request, "POST", api(plan, "/category_groups"), { name: "ZZ-TEST Group" }))
    .category_group.id as string;
  const fun = (await call(request, "POST", api(plan, "/categories"), { group_id: g, name: FUN }))
    .category.id as string;
  await call(request, "PATCH", api(plan, `/months/${NOV}/categories/${fun}`), { assigned: 50000 });
  await call(request, "POST", api(plan, "/transactions"), {
    account_id: checking,
    date: "2026-11-10",
    amount: -20000,
    category_id: fun,
    payee_name: "ZZ-TEST Shop",
  });
  await createSched(request, plan, TODAY, {
    account_id: checking,
    date_first: "2026-11-22",
    frequency: "weekly",
    amount: -20000,
    payee_name: "ZZ-TEST Gym",
    memo: "ZZ-TEST memo",
    category_id: fun,
  });
  return { plan, checking, fun };
}

let plan = "";
let checking = "";
test.beforeEach(async ({ page, request }) => {
  await fixClock(page, TODAY);
  const s = await seedPlan(request);
  plan = s.plan;
  checking = s.checking;
});
test.afterEach(async ({ request }) => {
  await request.delete(api(plan, ""), { headers: await authHeaders() });
});

const row = (page: Page) =>
  page.locator(".category-row", { has: page.getByText(FUN, { exact: true }) });
const box = (page: Page) => page.getByTestId("upcoming-box");
const after = (page: Page) => page.getByTestId("upcoming-after");

async function open(page: Page, ym = "202611") {
  await page.goto(`/${plan}/budget/${ym}`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
}
async function select(page: Page) {
  await page.locator(".category-name", { hasText: FUN }).click();
  await expect(page.getByRole("heading", { name: FUN })).toBeVisible();
}

test("the pill is amber with a calendar and the box reads the upcoming figures (AC1)", async ({
  page,
}) => {
  await open(page);
  const pill = row(page).locator(".available-pill");
  await expect(pill).toHaveClass(/cautious/);
  await expect(pill).toContainText("$30.00");
  await expect(pill.locator('[data-icon="calendar"]')).toBeVisible();
  await select(page);
  await expect(box(page)).toContainText("2 Upcoming Transactions");
  await expect(box(page)).toContainText("−$40.00");
  await expect(box(page)).toContainText("Available After Upcoming");
  await expect(after(page)).toContainText("−$10.00");
  await expect(box(page)).toHaveAttribute("data-tone", "cautious");
  await expect(box(page)).toHaveCSS("background-color", "rgba(218, 172, 0, 0.2)");
  const head = page.locator(".panel-card", { has: page.locator("#panel-balance") });
  await expect(head.locator(".available-pill")).toHaveClass(/cautious/);
  await expect(head.locator('.available-pill [data-icon="calendar"]')).toBeVisible();
  // Underfunded counts the shortfall (AC5a)
  await expect(option(autoCard(page), "Underfunded").locator("strong")).toHaveText("$10.00");
});

test("the link opens the Activity popover with the occurrences, latest first (AC3)", async ({
  page,
}) => {
  await open(page);
  await select(page);
  await box(page).getByRole("button", { name: "2 Upcoming Transactions" }).click();
  const dlg = page.getByRole("dialog", { name: "Activity" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByText(FUN, { exact: true })).toBeVisible();
  await expect(dlg.locator("th")).toHaveText(["Account", "Date", "Payee", "Memo", "Amount"]);
  const rows = dlg.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("11/29/2026");
  await expect(rows.nth(1)).toContainText("11/22/2026");
  for (const i of [0, 1]) {
    await expect(rows.nth(i)).toContainText("ZZ-TEST Checking");
    await expect(rows.nth(i)).toContainText("ZZ-TEST Gym");
    await expect(rows.nth(i)).toContainText("ZZ-TEST memo");
    await expect(rows.nth(i)).toContainText("−$20.00");
  }
  await dlg.getByRole("button", { name: "Close" }).click();
  await expect(dlg).toBeHidden();
});

test("assigning 60.00 turns the pill green and the box to $0.00 (AC2, AC5b)", async ({ page }) => {
  await open(page);
  await select(page);
  await row(page).locator(".assigned-box .amount").click();
  await page.keyboard.type("60");
  const done = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && /\/categories\//.test(r.url()),
  );
  await page.keyboard.press("Enter");
  await done;
  const pill = row(page).locator(".available-pill");
  await expect(pill).toHaveClass(/positive/);
  await expect(pill).toContainText("$40.00");
  await expect(pill.locator('[data-icon="calendar"]')).toHaveCount(0);
  await expect(after(page)).toContainText("$0.00");
  await expect(box(page)).toHaveAttribute("data-tone", "positive");
  await expect(box(page)).toHaveCSS("background-color", "rgba(119, 186, 33, 0.2)");
  await expect(option(autoCard(page), "Underfunded")).toHaveCount(0);
});

test("the next month reads four upcoming transactions (AC4)", async ({ page }) => {
  await open(page, "202612");
  await select(page);
  await expect(box(page)).toContainText("4 Upcoming Transactions");
  await expect(box(page)).toContainText("−$80.00");
});

test("an inflow to Ready to Assign shows no upcoming and leaves it unchanged (AC6)", async ({
  page,
  request,
}) => {
  const rta = async () =>
    (await call(request, "GET", api(plan, `/months/${NOV}?today=${TODAY}`))).ready_to_assign;
  const before = await rta();
  await createSched(request, plan, TODAY, {
    account_id: checking,
    date_first: "2026-11-20",
    frequency: "never",
    amount: 500000,
    inflow_to_ready_to_assign: true,
    payee_name: "ZZ-TEST Pay",
  });
  expect(await rta()).toBe(before);
  // In the same scenario the category with a schedule does carry upcoming, the inflow adds none anywhere.
  const m = await call(request, "GET", api(plan, `/months/${NOV}?today=${TODAY}`));
  const counts = m.groups
    .flatMap((g: { categories: { name: string; upcoming_count: number }[] }) => g.categories)
    .map((c: { name: string; upcoming_count: number }) => [c.name, c.upcoming_count]);
  expect(counts).toContainEqual([FUN, 2]);
  expect(
    counts.filter(([n]: [string, number]) => n !== FUN).every(([, k]: [string, number]) => k === 0),
  ).toBe(true);
  await open(page);
  await expect(row(page).locator('.available-pill [data-icon="calendar"]')).toBeVisible();
  const rtaBox: Locator = page.locator(".rta-box");
  await expect(rtaBox).toBeVisible();
  await expect(rtaBox).not.toContainText(/upcoming/i);
  await expect(rtaBox.locator('[data-icon="calendar"]')).toHaveCount(0);
});
