import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  assign,
  getMonth,
  openPlan,
  PHONE,
  panel,
  RENT,
  removePlan,
  row,
  type Seed,
  seedPlan,
  spend,
  TODAY,
} from "./plan-panel.fixtures";
import { monthIso } from "./support/plan-seed";
import {
  card,
  lastOfMonth,
  mcpCall,
  money,
  monthName,
  putTarget,
  readCategory,
  realClick,
  utcToday,
} from "./targets.fixtures";

test.use({ timezoneId: "UTC" });

let s: Seed;
let today = "";
test.beforeEach(async ({ request, page }) => {
  const t0 = Date.now();
  today = utcToday(t0);
  await page.clock.setFixedTime(t0);
  s = await seedPlan(request, "target-display");
});
test.afterEach(async ({ request }) => {
  await removePlan(request, s);
});

// Monthly kinds use day_of_month 10, so the strings do not depend on the month's length.
const MONTHLY10 = { cadence: "monthly", behavior: "set_aside", amount: 100000, day_of_month: 10 };
const status = (page: Page, name: string) => row(page, name).locator(".status-label");
const pill = (page: Page, name: string) => row(page, name).locator(".available-pill");
const select = (page: Page, name: string) =>
  page.locator(".category-name", { hasText: name }).click();
const donut = (page: Page) => card(page).getByRole("img");

test("monthly 100 with 40 assigned", async ({ page, request }) => {
  await putTarget(request, s, RENT, MONTHLY10, today);
  await assign(request, s, RENT, 40000);
  await openPlan(page, s);
  await expect(status(page, RENT)).toHaveText("$60.00 more needed by the 10th");
  await expect(status(page, RENT).locator("strong")).toHaveText("$60.00");
  const sections = row(page, RENT).locator(".progress-section");
  await expect(sections).toHaveCount(1);
  await expect(sections).toHaveAttribute("data-pct", "100.0");
  await expect(sections).toHaveAttribute("data-fill", "40.0");
  await expect(sections.locator(".progress-segment")).toHaveAttribute("data-kind", "cautious");
  await expect(pill(page, RENT)).toHaveClass(/cautious/);
  await expect(pill(page, RENT).locator("[data-icon=clock]")).toHaveCount(1);
  await expect(pill(page, RENT)).toHaveAttribute(
    "title",
    "Assign $60.00 more to fund your $100.00 monthly target.",
  );
  await select(page, RENT);
  await expect(donut(page)).toHaveAttribute("aria-label", "40% funded");
  await expect(card(page).getByRole("status")).toContainText(
    "Assign $60.00 more to meet your target",
  );
  await expect(
    card(page).getByRole("heading", { name: "Set Aside Another $100.00 Each Month" }),
  ).toBeVisible();
  await expect(card(page)).toContainText("By the 10th of the Month");
  const rows = card(page).locator(".panel-row");
  await expect(rows).toHaveText([
    "Amount to Assign This Month$100.00",
    "Assigned So Far$40.00",
    "To Go$60.00",
  ]);
});

test("Assign meets the target, then spending shows in the status", async ({ page, request }) => {
  await putTarget(request, s, RENT, MONTHLY10, today);
  await assign(request, s, RENT, 40000);
  await openPlan(page, s);
  await select(page, RENT);
  await realClick(page, card(page).getByRole("button", { name: "Assign", exact: true }));
  await expect(row(page, RENT).locator(".assigned-box .amount")).toHaveText("$100.00");
  await expect(status(page, RENT)).toHaveText("Funded");
  await expect(card(page).getByRole("status")).toHaveText("You've met your target!");
  await expect(card(page).getByRole("button", { name: "Assign", exact: true })).toHaveCount(0);
  await expect(donut(page)).toHaveCount(0);
  await expect(pill(page, RENT)).toHaveClass(/positive/);
  await expect(pill(page, RENT).locator("[data-icon=check]")).toHaveCount(1);
  await expect(pill(page, RENT)).toHaveAttribute(
    "title",
    "You've funded your $100.00 target for the month!",
  );
  await expect
    .poll(async () => (await readCategory(request, s, RENT, TODAY, today)).assigned)
    .toBe(100000);
  await spend(request, s, RENT, 30000);
  await page.reload();
  await expect(status(page, RENT)).toHaveText("Funded. Spent $30.00 of $100.00");
});

test("Assign lowers Ready to Assign by exactly the 60.00 it moves, with no reload", async ({
  page,
  request,
}) => {
  await putTarget(request, s, RENT, MONTHLY10, today);
  await assign(request, s, RENT, 40000);
  const before = (await getMonth(request, s.id, TODAY)).ready_to_assign;
  await openPlan(page, s);
  await select(page, RENT);
  const rta = page.locator(".rta-amount");
  await expect(rta).toHaveText(money(before));
  await realClick(page, card(page).getByRole("button", { name: "Assign", exact: true }));
  // Design doc, Acceptance case 19 (point 2): Ready to Assign drops by exactly 60.00 (the To Go figure).
  await expect(rta).toHaveText(money(before - 60000));
  const inspector = panel(page).locator(".panel-card", { has: page.locator("#panel-balance") });
  await expect(inspector.locator(".panel-row", { hasText: "Assigned This Month" })).toHaveText(
    "Assigned This Month+$100.00",
  );
  await expect(row(page, RENT).locator(".assigned-box .amount")).toHaveText("$100.00");
  await expect(pill(page, RENT)).toHaveText("$100.00");
  await expect(inspector.locator(".available-pill")).toHaveText("$100.00");
  await expect
    .poll(async () => (await getMonth(request, s.id, TODAY)).ready_to_assign)
    .toBe(before - 60000);
});

test("a second click on Assign while the month is read again adds nothing", async ({
  page,
  request,
}) => {
  await putTarget(request, s, RENT, MONTHLY10, today);
  await assign(request, s, RENT, 40000);
  await openPlan(page, s);
  await select(page, RENT);
  // Hold the month read that follows the write, so the card still shows the old to-go figure.
  let hold = false;
  await page.route(/\/months\/[^/?]+(\?.*)?$/, async (route) => {
    if (hold && route.request().method() === "GET") await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const button = card(page).getByRole("button", { name: "Assign", exact: true });
  hold = true;
  await realClick(page, button);
  await expect(button).toBeDisabled();
  await button.dispatchEvent("click"); // a click that arrives anyway
  await expect(card(page).getByRole("status")).toHaveText("You've met your target!");
  await expect
    .poll(async () => (await readCategory(request, s, RENT, TODAY, today)).assigned)
    .toBe(100000);
  await page.waitForTimeout(500);
  expect((await readCategory(request, s, RENT, TODAY, today)).assigned).toBe(100000);
});

test("yearly 1,200 with 100 assigned is on track", async ({ page, request }) => {
  const due = lastOfMonth(today, 11);
  await putTarget(
    request,
    s,
    RENT,
    { cadence: "yearly", behavior: "set_aside", amount: 1200000, due_date: due },
    today,
  );
  await assign(request, s, RENT, 100000);
  await openPlan(page, s);
  await expect(status(page, RENT)).toHaveText("On Track");
  await expect(pill(page, RENT)).toHaveClass(/positive/);
  await expect(pill(page, RENT).locator("[data-icon=clockCheck]")).toHaveCount(1);
  await expect(pill(page, RENT)).toHaveAttribute(
    "title",
    `You're on track to fund your $1,200.00 target by ${monthName(due)} of ${due.slice(0, 4)}.`,
  );
  await select(page, RENT);
  await expect(donut(page)).toHaveAttribute("aria-label", "8% funded");
  await expect(card(page).getByRole("status")).toHaveText("You're on track to meet your target!");
  await expect(card(page)).toContainText("Set Aside Another $1,200.00 Each Year");
});

test("a balance with no date is grey and needed eventually", async ({ page, request }) => {
  await putTarget(
    request,
    s,
    RENT,
    { cadence: "custom", behavior: "balance", amount: 60000 },
    today,
  );
  await openPlan(page, s);
  await expect(status(page, RENT)).toHaveText("$60.00 needed eventually");
  await expect(pill(page, RENT)).toHaveClass(/zero/);
  await select(page, RENT);
  await expect(card(page)).toContainText("Have a Balance of $60.00");
  await expect(card(page)).toContainText("Eventually");
  await expect(card(page).getByRole("status")).toHaveCount(0);
  await expect(card(page).locator(".panel-row")).toHaveText([
    "Balance Needed$60.00",
    "Current Balance$0.00",
    "To Go$60.00",
  ]);
});

const widths = (page: Page, name: string) =>
  row(page, name)
    .locator(".progress-section")
    .evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-pct"))));

test("the bar's sections follow the leftover and what is needed", async ({ page, request }) => {
  await assign(request, s, RENT, 70000, monthIso(-1));
  await assign(request, s, PHONE, 40000, monthIso(-1));
  await putTarget(request, s, RENT, MONTHLY10, today);
  await putTarget(
    request,
    s,
    PHONE,
    { cadence: "weekly", behavior: "set_aside", amount: 25000, day_of_week: 6 },
    today,
  );
  await openPlan(page, s);
  const rent = await widths(page, RENT);
  expect(rent).toHaveLength(2);
  expect(rent[0]).toBeCloseTo(41.2, 1);
  expect(rent[1]).toBeCloseTo(58.8, 1);
  // Weekly: the leftover, then one section per Saturday from today to the month's end.
  const end = Number(lastOfMonth(today).slice(8));
  let weeks = 0;
  for (let d = Number(today.slice(8)); d <= end; d++) {
    if (new Date(`${today.slice(0, 8)}${String(d).padStart(2, "0")}T00:00:00Z`).getUTCDay() === 6)
      weeks++;
  }
  const phone = await widths(page, PHONE);
  expect(phone).toHaveLength(1 + weeks);
  const total = 40 + 25 * weeks;
  expect(phone[0]).toBeCloseTo((40 / total) * 100, 1);
  for (const w of phone.slice(1)) expect(w).toBeCloseTo((25 / total) * 100, 1);
});

test("a target set through MCP reads the same on screen as through MCP", async ({
  page,
  request,
}) => {
  await mcpCall(request, "set_category_target", {
    budget_id: s.id,
    category_id: s.cat[RENT],
    ...MONTHLY10,
    today,
  });
  await assign(request, s, RENT, 25000);
  const read = await mcpCall(request, "get_plan_month", { budget_id: s.id, month: TODAY, today });
  // biome-ignore lint/suspicious/noExplicitAny: parsed JSON
  const c = read.groups.flatMap((g: any) => g.categories).find((x: any) => x.id === s.cat[RENT]);
  const t = c.target;
  await openPlan(page, s);
  await expect(status(page, RENT)).toHaveText(
    `${money(t.to_go_this_month)} more needed by the 10th`,
  );
  await select(page, RENT);
  await expect(card(page).locator(".panel-row")).toHaveText([
    `Amount to Assign This Month${money(t.amount_this_month)}`,
    `Assigned So Far${money(t.funded)}`,
    `To Go${money(t.to_go_this_month)}`,
  ]);
  await expect(panel(page).getByRole("heading", { level: 1, name: RENT })).toBeVisible();
  const deleted = await mcpCall(request, "delete_category_target", {
    budget_id: s.id,
    category_id: s.cat[RENT],
  });
  expect(deleted.deleted.amount).toBe(100000);
});
