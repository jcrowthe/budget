import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { accountData, realClick } from "./support/register-seed";
import { createSched, fixClock, listSched, mmddyyyy } from "./support/scheduled-seed";
import { type SplitSched, seedSplitPlan } from "./support/scheduled-splits-seed";

// EXF-501 part 2: a scheduled transaction can be a split. The browser's clock is fixed at 2026-11-15.
const DAY = "2026-11-15";
const FIRST = "2026-11-28";
const NEXT = "2026-12-28";
const SPLIT = "Split (Multiple Categories)...";

type Plan = Awaited<ReturnType<typeof seedSplitPlan>>;

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const date = (page: Page) => page.getByRole("textbox", { name: "Date", exact: true });
const payee = (page: Page) => page.getByRole("combobox", { name: "Payee", exact: true });
const repeat = (page: Page) => page.getByRole("combobox", { name: "Repeat", exact: true });
const parentCategory = (page: Page) =>
  page.locator('.entry-row:not(.split-line) [data-field="category"] input');
const line = (page: Page, i: number, field: string) =>
  page.locator(`[data-line="${i}"][data-field="${field}"] input`);
const bar = (page: Page) => page.getByRole("toolbar", { name: "Selection actions" });
const schedRows = (page: Page) => page.locator("tr[data-scheduled]");
const subRows = (page: Page) => page.locator("tr.split-line-row[data-line-of-scheduled]");

const open = async (p: Plan, page: Page) => {
  await fixClock(page, DAY);
  await page.goto(`/${p.plan}/accounts/${p.checking}`);
  await expect(button(page, "Add Transaction")).toBeVisible();
};

async function seededSplit(request: Parameters<typeof seedSplitPlan>[0]) {
  const p = await seedSplitPlan(request);
  const made = await createSched(request, p.plan, DAY, {
    account_id: p.checking,
    payee_name: "ZZ-TEST Market",
    date_first: FIRST,
    frequency: "monthly",
    amount: -40000,
    subtransactions: [
      { amount: -30000, category_id: p.groceries },
      { amount: -10000, category_id: p.fun },
    ],
  });
  return { ...p, id: made.scheduled_transaction.id };
}
const split = async (request: Parameters<typeof seedSplitPlan>[0], p: Plan) =>
  (await listSched(request, p.plan, p.checking)) as unknown as SplitSched[];

const select = async (page: Page) => {
  const row = schedRows(page).first();
  await realClick(page, row.locator("td[data-field=date]"));
  await expect(
    row.getByRole("checkbox", { name: "Select transaction", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
};

test("AC1+AC2: a split is added in the scheduled row, Update Total saves it, the series shows its lines", async ({
  page,
  request,
}) => {
  const p = await seedSplitPlan(request);
  await open(p, page);
  await realClick(page, button(page, "Add Transaction"));
  await expect(date(page)).toBeFocused();
  await date(page).fill(mmddyyyy(FIRST));
  await repeat(page).selectOption("monthly");
  await payee(page).fill("ZZ-TEST Market");
  await payee(page).press("Tab");
  await parentCategory(page).click();
  await realClick(page, button(page, "Split (Multiple Categories)"));
  await expect(parentCategory(page)).toHaveValue(SPLIT);
  await expect(button(page, "Add another split")).toBeVisible();
  await expect(page.getByText("Amount remaining to assign:", { exact: true })).toBeVisible();
  await line(page, 0, "category").fill("ZZ-TEST Groceries");
  await page.getByRole("option", { name: /ZZ-TEST Groceries/ }).click();
  await line(page, 0, "outflow").fill("30.00");
  await line(page, 1, "category").fill("ZZ-TEST Fun");
  await page.getByRole("option", { name: /ZZ-TEST Fun/ }).click();
  await line(page, 1, "outflow").fill("10.00");
  await realClick(page, button(page, "Save"));

  const dialog = page.getByRole("dialog", { name: "Something Doesn't Add Up" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "The total is $0.00, but the splits add up to -$40.00. How would you like to handle the unassigned $40.00?",
  );
  await expect(button(page, "Auto-Distribute")).toBeVisible();
  await expect(button(page, "Adjust Manually")).toBeVisible();
  await realClick(page, button(page, "Update Total"));

  const series = schedRows(page).first();
  await expect(series).toContainText(mmddyyyy(FIRST));
  await expect(series).toContainText("ZZ-TEST Market");
  await expect(series).toContainText(SPLIT);
  await expect(series).toContainText("40.00");
  await expect(series.getByRole("img", { name: /Monthly/i })).toBeVisible();
  await expect(subRows(page)).toHaveCount(2);
  await expect(subRows(page).nth(0)).toContainText("ZZ-TEST Group: ZZ-TEST Groceries");
  await expect(subRows(page).nth(0)).toContainText("30.00");
  await expect(subRows(page).nth(1)).toContainText("ZZ-TEST Group: ZZ-TEST Fun");
  await expect(subRows(page).nth(1)).toContainText("10.00");
  await realClick(page, series.getByRole("button", { name: "Collapse split" }));
  await expect(subRows(page)).toHaveCount(0);
  await realClick(page, series.getByRole("button", { name: "Expand split" }));
  await expect(subRows(page)).toHaveCount(2);

  const [row] = await split(request, p);
  expect(row?.amount).toBe(-40000);
  expect(row?.subtransactions).toHaveLength(2);
});

test("AC3: Enter Now makes a real split dated today and moves the schedule on", async ({
  page,
  request,
}) => {
  const p = await seededSplit(request);
  await open(p, page);
  await select(page);
  await realClick(page, bar(page).getByRole("button", { name: "Enter Now", exact: true }));
  await expect
    .poll(async () => (await accountData(request, p.plan, p.checking)).transactions.length)
    .toBe(2);
  const real = (await accountData(request, p.plan, p.checking)).transactions.find(
    (t) => t.subtransactions.length > 0,
  );
  expect(real?.date).toBe(DAY);
  expect(real?.subtransactions.map((l) => l.amount)).toEqual([-30000, -10000]);
  await expect(
    page
      .locator(".register-table tbody tr[data-tx]")
      .filter({ hasText: mmddyyyy(DAY) })
      .first(),
  ).toBeVisible();
  expect((await split(request, p))[0]?.date_next).toBe(NEXT);
  await expect(schedRows(page).first()).toContainText(mmddyyyy(NEXT));
});

test("Edit: changing a line and the total saves the new lines", async ({ page, request }) => {
  const p = await seededSplit(request);
  await open(p, page);
  await realClick(page, schedRows(page).first().locator("td[data-field=memo]"));
  await realClick(page, schedRows(page).first().locator("td[data-field=memo]"));
  await expect(line(page, 1, "outflow")).toBeVisible();
  await line(page, 1, "outflow").fill("15.00");
  await realClick(page, button(page, "Save"));
  await realClick(page, button(page, "Update Total"));
  await expect(subRows(page).nth(1)).toContainText("15.00");
  await expect(schedRows(page).first()).toContainText("45.00");
  const [row] = await split(request, p);
  expect(row?.amount).toBe(-45000);
  expect(row?.subtransactions.map((l) => l.amount)).toEqual([-30000, -15000]);
});

test("Delete: removes the parent and its sub-rows", async ({ page, request }) => {
  const p = await seededSplit(request);
  await open(p, page);
  await expect(subRows(page)).toHaveCount(2);
  await select(page);
  await realClick(page, bar(page).getByRole("button", { name: "More", exact: true }));
  await realClick(
    page,
    page
      .getByRole("menu", { name: "More actions" })
      .getByRole("menuitem", { name: "Delete", exact: true }),
  );
  await expect(schedRows(page)).toHaveCount(0);
  await expect(subRows(page)).toHaveCount(0);
  expect(await split(request, p)).toHaveLength(0);
});
