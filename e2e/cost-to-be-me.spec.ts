import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  GROCERIES,
  longMonth,
  openPlan,
  panel,
  RENT,
  removePlan,
  type Seed,
  seedPlan,
  TODAY,
  UTILITIES,
} from "./plan-panel.fixtures";
import { authHeaders } from "./support/auth";
import { monthIso } from "./support/plan-seed";
import { realClick } from "./support/real-click";

// EXF-525: Cost to Be Me on the Plan's right panel. The figures are computed from the browser's local month,
// never a fixed one.

let s: Seed;
test.beforeEach(async ({ request }) => {
  s = await seedPlan(request, "ctbm");
});
test.afterEach(async ({ request }) => {
  await removePlan(request, s);
});

const here = longMonth(TODAY);
const section = (page: Page) => panel(page).locator(".ctbm");
const targetsRow = (page: Page) => section(page).getByTestId("ctbm-targets-row");
const targetsValue = (page: Page) => targetsRow(page).locator(".panel-row-value");
const money = (t: string | null) => Number((t ?? "").replace(/[^0-9.-]/g, "").replace("−", "-"));
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const saturdays = () => {
  const d = new Date();
  let n = 0;
  for (let day = 1; day <= new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); day++) {
    if (new Date(d.getFullYear(), d.getMonth(), day).getDay() === 6) n++;
  }
  return n;
};

async function put(
  request: APIRequestContext,
  category: string,
  body: Record<string, unknown>,
  today = localDay(),
) {
  const res = await request.put(
    `/api/v1/budgets/${s.id}/categories/${s.cat[category]}/target?today=${today}`,
    { headers: await authHeaders(), data: body },
  );
  expect(res.ok(), await res.text()).toBe(true);
}
const monthly = (amount: number) => ({ cadence: "monthly", behavior: "set_aside", amount });

async function setIncome(request: APIRequestContext, expected_income: number | null) {
  const res = await request.patch(`/api/v1/budgets/${s.id}`, {
    headers: await authHeaders(),
    data: { expected_income },
  });
  expect(res.ok()).toBe(true);
}
async function storedIncome(request: APIRequestContext) {
  const res = await request.get(`/api/v1/budgets/${s.id}`, { headers: await authHeaders() });
  return (await res.json()).data.budget.expected_income;
}
async function summary(request: APIRequestContext) {
  const res = await request.get(
    `/api/v1/budgets/${s.id}/months/${TODAY}/summary?today=${localDay()}`,
    { headers: await authHeaders() },
  );
  return (await res.json()).data;
}

const enterButton = (page: Page) =>
  section(page).getByRole("button", { name: "Enter your expected income" });
const pencil = (page: Page) => section(page).getByRole("button", { name: "Edit your income" });
const input = (page: Page) => section(page).getByRole("textbox", { name: "Expected Income" });
const save = (page: Page) => section(page).getByRole("button", { name: "Save", exact: true });
const targetsBar = (page: Page) => section(page).getByTestId("ctbm-targets-bar");
const incomeBar = (page: Page) => section(page).getByTestId("ctbm-income-bar");

test("AC1: the targets row is the sum of every target's amount for the month", async ({
  page,
  request,
}) => {
  await openPlan(page, s);
  await expect(section(page).getByRole("heading", { name: "Cost to Be Me" })).toBeVisible();
  await expect(targetsRow(page).locator(".panel-row-label")).toHaveText(`${here}'s Targets`);
  const baseline = money(await targetsValue(page).textContent());

  await put(request, GROCERIES, monthly(10000));
  await openPlan(page, s);
  await expect(targetsValue(page)).toHaveText(`$${(baseline + 10).toFixed(2)}`);

  await put(request, RENT, {
    cadence: "weekly",
    behavior: "set_aside",
    amount: 10000,
    day_of_week: 6,
  });
  await openPlan(page, s);
  await expect(targetsValue(page)).toHaveText(`$${(baseline + 10 + 10 * saturdays()).toFixed(2)}`);
});

test("AC2: a snoozed target still counts", async ({ page, request }) => {
  await put(request, GROCERIES, monthly(10000));
  await openPlan(page, s);
  await expect(targetsValue(page)).toHaveText("$10.00");
  const res = await request.put(
    `/api/v1/budgets/${s.id}/months/${TODAY}/categories/${s.cat[GROCERIES]}/target-snooze?today=${localDay()}`,
    { headers: await authHeaders(), data: { snoozed: true } },
  );
  expect(res.ok(), await res.text()).toBe(true);
  await openPlan(page, s);
  await expect(targetsValue(page)).toHaveText("$10.00");
});

test("AC3: income below the targets: a full deficit targets bar and a grey income bar", async ({
  page,
  request,
}) => {
  await put(request, GROCERIES, monthly(600000));
  await put(request, RENT, monthly(3340));
  await openPlan(page, s);
  const total = money(await targetsValue(page).textContent());
  expect(total).toBeGreaterThan(500);
  await expect(targetsBar(page)).toHaveCount(0);
  await realClick(page, enterButton(page));
  await expect(input(page)).toBeFocused();
  await page.keyboard.type("500");
  await realClick(page, save(page));
  await expect(section(page).locator(".panel-row", { hasText: "Expected Income" })).toHaveText(
    "Expected Income$500.00",
  );
  await expect(targetsBar(page)).toHaveClass(/has-deficit/);
  await expect(targetsBar(page)).toHaveAttribute("style", /width: 100%/);
  await expect(incomeBar(page)).toHaveAttribute(
    "style",
    new RegExp(`width: ${round3((500 / total) * 100)}%`),
  );
  expect(await storedIncome(request)).toBe(500000);
});

test("AC4: income above the targets: a blue targets bar and a full income bar", async ({
  page,
  request,
}) => {
  await put(request, GROCERIES, monthly(603340));
  await setIncome(request, 100000);
  await openPlan(page, s);
  await expect(targetsBar(page)).toHaveClass(/has-deficit/);
  const deficit = await targetsBar(page).evaluate((e) => getComputedStyle(e).backgroundColor);
  await realClick(page, pencil(page));
  await expect(input(page)).toHaveValue("100.00");
  await input(page).fill("1000");
  await realClick(page, save(page));
  await expect(targetsBar(page)).not.toHaveClass(/has-deficit/);
  const total = money(await targetsValue(page).textContent());
  await expect(targetsBar(page)).toHaveAttribute(
    "style",
    new RegExp(`width: ${round3((total / 1000) * 100)}%`),
  );
  await expect(incomeBar(page)).toHaveAttribute("style", /width: 100%/);
  const blue = await targetsBar(page).evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(blue).not.toBe(deficit);
});

test("AC5: saving 0 clears the income and brings the button back", async ({ page, request }) => {
  await put(request, GROCERIES, monthly(10000));
  await setIncome(request, 500000);
  await openPlan(page, s);
  await expect(targetsBar(page)).toBeVisible();
  await realClick(page, pencil(page));
  await input(page).fill("0");
  await realClick(page, save(page));
  await expect(enterButton(page)).toBeVisible();
  await expect(targetsBar(page)).toHaveCount(0);
  await expect(incomeBar(page)).toHaveCount(0);
  expect(await storedIncome(request)).toBeNull();
});

test("Cancel and Escape discard the entry", async ({ page, request }) => {
  await openPlan(page, s);
  await realClick(page, enterButton(page));
  await page.keyboard.type("123");
  await realClick(page, section(page).getByRole("button", { name: "Cancel" }));
  await expect(enterButton(page)).toBeVisible();
  await realClick(page, enterButton(page));
  await page.keyboard.type("123");
  await page.keyboard.press("Escape");
  await expect(enterButton(page)).toBeVisible();
  expect(await storedIncome(request)).toBeNull();
});

test("the next-month line shows when next month's targets are higher", async ({
  page,
  request,
}) => {
  await openPlan(page, s);
  const line = section(page).getByText(/Next month's targets could increase your total to/);
  await expect(targetsValue(page)).toBeVisible();
  await expect(line).toHaveCount(0);

  // A target created on the first day of next month counts for that month only.
  await put(request, UTILITIES, monthly(50000), monthIso(1));
  const data = await summary(request);
  expect(data.targets_total).toBe(0);
  expect(data.next_month_targets_total).toBe(50000);
  await openPlan(page, s);
  await expect(line).toHaveText("Next month's targets could increase your total to $50.00");
});

test("a negative entry shows an error and saves nothing", async ({ page, request }) => {
  await openPlan(page, s);
  await realClick(page, enterButton(page));
  await page.keyboard.type("-5");
  await realClick(page, save(page));
  await expect(section(page).getByRole("alert")).toBeVisible();
  await expect(input(page)).toBeVisible();
  expect(await storedIncome(request)).toBeNull();
});
