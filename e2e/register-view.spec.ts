import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { seedWorked } from "./support/reconcile-seed";
import { call, realClick } from "./support/register-seed";
import {
  MONTH_NAMES,
  monthsAgo,
  seedBalances,
  setViewSettings,
  viewSettingsOf,
} from "./support/view-settings";

// EXF-529. The source's View options were compared live by the Architect (notes in the design); the Reconcile
// parts are built from the tickets and compared with nothing in the source.

test.use({ viewport: { width: 1440, height: 900 } });

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const viewButton = (page: Page) =>
  page.getByRole("toolbar", { name: "Register toolbar" }).getByRole("button", {
    name: "View",
    exact: true,
  });
const dialog = (page: Page) => page.getByRole("dialog", { name: "View Options", exact: true });
const check = (page: Page, name: string) =>
  dialog(page).getByRole("checkbox", { name, exact: true });
const pill = (page: Page, name: string) => dialog(page).getByRole("button", { name, exact: true });
const rows = (page: Page) => page.locator(".register-table tbody tr[data-tx]");
const row = (page: Page, text: string) => rows(page).filter({ hasText: text });
const amount = (page: Page, key: string) => page.locator(`[data-balance=${key}] .acct-amount`);
const footer = (page: Page) => page.locator(".register-footer");
const isPut = (r: { url(): string; request(): { method(): string } }) =>
  r.url().includes("view_settings") && r.request().method() === "PUT";

async function open(page: Page, plan: string, account?: string) {
  await page.goto(account ? `/${plan}/accounts/${account}` : `/${plan}/accounts`);
  await expect(button(page, "Add Transaction")).toBeVisible();
  await expect(page.locator(".register-table[aria-busy=false]")).toBeVisible();
}

/** Clicks a control that sends a PUT and waits for the server's answer. */
async function saves(page: Page, click: () => Promise<void>) {
  const [res] = await Promise.all([page.waitForResponse(isPut), click()]);
  expect(res.status()).toBe(200);
}

test("the View button, its tooltip and the popover as it opens (AC1)", async ({
  page,
  request,
}) => {
  const s = await seedBalances(request);
  await open(page, s.plan, s.a);
  const toolbar = page.getByRole("toolbar", { name: "Register toolbar" });
  const view = await viewButton(page).boundingBox();
  const search = await toolbar.getByRole("searchbox").boundingBox();
  expect(view && search && view.x + view.width <= search.x).toBe(true);
  await viewButton(page).hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "Set view options like date range, reconciliation status, and more.",
  );
  const tip = await page.getByRole("tooltip").boundingBox();
  // Source: the tooltip sits above the button, right edges aligned.
  expect(tip && view && tip.y + tip.height <= view.y).toBe(true);
  expect(tip && view && Math.abs(tip.x + tip.width - (view.x + view.width)) < 2).toBe(true);

  await realClick(page, viewButton(page));
  await expect(dialog(page)).toBeVisible();
  await expect(
    dialog(page).getByRole("heading", { name: "View Options", exact: true }),
  ).toBeVisible();
  for (const p of ["This Month", "Last Month", "Latest 3 Months", "This Year", "Last Year"]) {
    await expect(pill(page, p)).toHaveAttribute("aria-pressed", "false");
  }
  await expect(pill(page, "All Dates")).toHaveAttribute("aria-pressed", "true");
  const now = new Date();
  await expect(dialog(page).getByLabel("From month")).toHaveValue(String(now.getMonth() + 1));
  await expect(dialog(page).getByLabel("From year")).toHaveValue(String(now.getFullYear()));
  await expect(dialog(page).getByLabel("To month")).toHaveValue(String(now.getMonth() + 1));
  await expect(dialog(page).getByLabel("To year")).toHaveValue(String(now.getFullYear() + 10));
  await expect(check(page, "Show Reconciled Transactions")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(check(page, "Show Running Balance")).toHaveAttribute("aria-checked", "false");
  await expect(check(page, "Show Flags")).toHaveAttribute("aria-checked", "true");
  await expect(check(page, "Show Images")).toHaveAttribute("aria-checked", "true");
  await expect(dialog(page).getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  const years = await dialog(page).getByLabel("From year").locator("option").allTextContents();
  expect(years[0]).toBe(String(now.getFullYear() - 1));
  expect(years.at(-1)).toBe(String(now.getFullYear() + 10));
});

test("a preset hides rows at once and the header keeps its totals (AC4)", async ({
  page,
  request,
}) => {
  const s = await seedBalances(request);
  const old = await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.a,
    date: monthsAgo(2),
    amount: -5000,
    payee_name: "ZZ Old",
    cleared: "cleared",
  });
  expect(old.transaction.id).toBeTruthy();
  await open(page, s.plan, s.a);
  await expect(row(page, "ZZ Old")).toBeVisible();
  const before = {
    cleared: await amount(page, "cleared").textContent(),
    uncleared: await amount(page, "uncleared").textContent(),
    working: await amount(page, "working").textContent(),
  };
  await realClick(page, viewButton(page));
  await saves(page, () => realClick(page, pill(page, "This Month")));
  await expect(dialog(page)).toHaveCount(0);
  await expect(row(page, "ZZ Old")).toHaveCount(0);
  await expect(footer(page).getByText("Some transactions are hidden by filters.")).toBeVisible();
  await expect(footer(page).getByRole("button", { name: "View All", exact: true })).toBeVisible();
  expect(await amount(page, "cleared").textContent()).toBe(before.cleared);
  expect(await amount(page, "uncleared").textContent()).toBe(before.uncleared);
  expect(await amount(page, "working").textContent()).toBe(before.working);
  expect((await viewSettingsOf(request, s.plan, s.a)).preset).toBe("this_month");

  await realClick(page, viewButton(page));
  await expect(pill(page, "This Month")).toHaveAttribute("aria-pressed", "true");
  const now = new Date();
  for (const w of ["From", "To"]) {
    await expect(dialog(page).getByLabel(`${w} month`)).toHaveValue(String(now.getMonth() + 1));
    await expect(dialog(page).getByLabel(`${w} year`)).toHaveValue(String(now.getFullYear()));
  }
  await saves(page, () => realClick(page, pill(page, "Latest 3 Months")));
  await expect(row(page, "ZZ Old")).toBeVisible();
  await expect(footer(page)).toHaveCount(0);
  await realClick(page, viewButton(page));
  const from = new Date(monthsAgo(2));
  await expect(dialog(page).getByLabel("From month")).toHaveValue(String(from.getMonth() + 1));
  await expect(dialog(page).getByLabel("From year")).toHaveValue(String(from.getFullYear()));
  // A select removes the highlight.
  await dialog(page)
    .getByLabel("To month")
    .selectOption(String(((now.getMonth() + 1) % 12) + 1));
  for (const p of ["This Month", "Latest 3 Months", "All Dates"]) {
    await expect(pill(page, p)).toHaveAttribute("aria-pressed", "false");
  }
  expect(MONTH_NAMES).toHaveLength(12);
});

test("Reconcile, then View All: footer, locks, and the settings after a reload (AC2)", async ({
  page,
  request,
}) => {
  const w = await seedWorked(request);
  await open(page, w.plan, w.checking);
  await expect(rows(page)).toHaveCount(9);
  await realClick(
    page,
    page.getByRole("main").getByRole("button", { name: "Reconcile", exact: true }),
  );
  await realClick(page, button(page, "Yes"));
  await expect(page.getByRole("dialog", { name: "Reconcile", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  // The reconciled rows disappear; the three uncleared rows stay.
  await expect(rows(page)).toHaveCount(3);
  await expect(footer(page).getByText("Some transactions are hidden by filters.")).toBeVisible();
  await saves(page, () => realClick(page, footer(page).getByRole("button", { name: "View All" })));
  await expect(footer(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(9);
  await expect(page.locator(".cleared-button.is-reconciled")).toHaveCount(6);
  await realClick(page, viewButton(page));
  await expect(pill(page, "All Dates")).toHaveAttribute("aria-pressed", "true");
  await expect(check(page, "Show Reconciled Transactions")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(rows(page)).toHaveCount(9);
  await expect(page.locator(".cleared-button.is-reconciled")).toHaveCount(6);
});

test("Show Running Balance: the ticket's example, a negative balance in red (AC3)", async ({
  page,
  request,
}) => {
  const s = await seedBalances(request);
  await open(page, s.plan, s.a);
  await expect(page.getByRole("columnheader", { name: "BALANCE", exact: true })).toHaveCount(0);
  await realClick(page, viewButton(page));
  await realClick(page, check(page, "Show Running Balance"));
  await saves(page, () => realClick(page, dialog(page).getByRole("button", { name: "Apply" })));
  await expect(dialog(page)).toHaveCount(0);
  const header = page.getByRole("columnheader", { name: "BALANCE", exact: true });
  await expect(header).toBeVisible();
  // BALANCE follows INFLOW.
  const heads = await page.locator(".register-table thead th").allTextContents();
  expect(heads.indexOf("BALANCE")).toBe(heads.indexOf("INFLOW") + 1);
  // The table's order is newest first.
  await expect(page.locator(".register-table tbody td.cell-balance")).toHaveText([
    "−$90.00",
    "$510.00",
    "$530.00",
    "$500.00",
  ]);
  const red = page.locator(".register-table tbody td.cell-balance").first();
  const probe = await page.evaluate(() => {
    const d = document.createElement("div");
    d.style.color = "var(--labelNegative)";
    document.body.append(d);
    const c = getComputedStyle(d).color;
    d.remove();
    return c;
  });
  expect(await red.evaluate((el) => getComputedStyle(el).color)).toBe(probe);
  const plain = page.locator(".register-table tbody td.cell-balance").nth(1);
  expect(await plain.evaluate((el) => getComputedStyle(el).color)).not.toBe(probe);
  // The server computed the same figures.
  const list = await call(
    request,
    "GET",
    `/api/v1/budgets/${s.plan}/accounts/${s.a}/transactions?include=running_balance`,
  );
  expect(list.transactions.map((t: { running_balance: number }) => t.running_balance)).toEqual([
    -90000, 510000, 530000, 500000,
  ]);
});

test("Show Flags off hides the column, header and cells, also in the add row (AC5)", async ({
  page,
  request,
}) => {
  const s = await seedBalances(request);
  await open(page, s.plan, s.a);
  await expect(page.locator(".register-table th.cell-flag")).toHaveCount(1);
  await expect(page.locator(".register-table td.cell-flag")).toHaveCount(4);
  await realClick(page, viewButton(page));
  await realClick(page, check(page, "Show Flags"));
  await saves(page, () => realClick(page, dialog(page).getByRole("button", { name: "Apply" })));
  await expect(page.locator(".register-table th.cell-flag")).toHaveCount(0);
  await expect(page.locator(".register-table td.cell-flag")).toHaveCount(0);
  await expect(page.locator(".register-table col.col-flag")).toHaveCount(0);
  await realClick(page, button(page, "Add Transaction"));
  await expect(page.locator(".entry-row")).toBeVisible();
  await expect(page.locator(".register-table .entry-row .cell-flag")).toHaveCount(0);
  // Every body cell of every row is in a column of the header.
  const columns = await page.locator(".register-table thead th").count();
  for (const tr of await rows(page).all()) expect(await tr.locator("td").count()).toBe(columns);
});

test("settings are kept per account and once for All Accounts, across a reload (AC6)", async ({
  page,
  request,
}) => {
  const s = await seedBalances(request);
  await open(page, s.plan, s.a);
  await realClick(page, viewButton(page));
  await realClick(page, check(page, "Show Running Balance"));
  await saves(page, () => realClick(page, dialog(page).getByRole("button", { name: "Apply" })));
  await realClick(page, viewButton(page));
  await saves(page, () => realClick(page, pill(page, "This Month")));
  await open(page, s.plan);
  await realClick(page, viewButton(page));
  await expect(check(page, "Show Running Balance")).toHaveCount(0);
  await realClick(page, check(page, "Show Reconciled Transactions"));
  await saves(page, () => realClick(page, dialog(page).getByRole("button", { name: "Apply" })));

  await open(page, s.plan, s.a);
  await realClick(page, viewButton(page));
  await expect(pill(page, "This Month")).toHaveAttribute("aria-pressed", "true");
  await expect(check(page, "Show Running Balance")).toHaveAttribute("aria-checked", "true");
  await expect(check(page, "Show Reconciled Transactions")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await page.keyboard.press("Escape");
  await open(page, s.plan, s.b);
  await realClick(page, viewButton(page));
  await expect(pill(page, "All Dates")).toHaveAttribute("aria-pressed", "true");
  await expect(check(page, "Show Running Balance")).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await open(page, s.plan);
  await realClick(page, viewButton(page));
  await expect(check(page, "Show Reconciled Transactions")).toHaveAttribute("aria-checked", "true");
  await expect(pill(page, "All Dates")).toHaveAttribute("aria-pressed", "true");
  expect(await viewSettingsOf(request, s.plan, s.a)).toMatchObject({
    account_id: s.a,
    preset: "this_month",
    show_running_balance: true,
    show_reconciled: false,
  });
  expect(await viewSettingsOf(request, s.plan, s.b)).toMatchObject({ preset: "all_dates" });
  expect(await viewSettingsOf(request, s.plan, "all")).toMatchObject({
    show_reconciled: true,
    preset: "all_dates",
  });
});

test("the All Accounts popover has no Show Running Balance (AC7)", async ({ page, request }) => {
  const s = await seedBalances(request);
  await open(page, s.plan);
  await realClick(page, viewButton(page));
  await expect(dialog(page)).toBeVisible();
  await expect(check(page, "Show Running Balance")).toHaveCount(0);
  await expect(pill(page, "All Dates")).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Show Reconciled Transactions", "Show Flags", "Show Images"]) {
    await expect(check(page, name)).toBeVisible();
  }
  await expect(dialog(page).getByLabel("To year")).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Apply", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "BALANCE" })).toHaveCount(0);
});

test("Cancel, Escape, a click outside and View again discard and send nothing (Cancel)", async ({
  page,
  request,
}) => {
  const s = await seedBalances(request);
  let puts = 0;
  page.on("request", (r) => {
    if (r.url().includes("view_settings") && r.method() === "PUT") puts++;
  });
  await open(page, s.plan, s.a);
  const before = await rows(page).count();
  const discard: [string, () => Promise<void>][] = [
    ["Cancel", () => realClick(page, dialog(page).getByRole("button", { name: "Cancel" }))],
    ["Escape", () => page.keyboard.press("Escape")],
    ["a click outside", () => realClick(page, page.getByRole("heading", { name: "ZZ Balance" }))],
    ["View again", () => realClick(page, viewButton(page))],
  ];
  for (const [how, close] of discard) {
    await realClick(page, viewButton(page));
    await realClick(page, check(page, "Show Running Balance"));
    await realClick(page, check(page, "Show Flags"));
    await dialog(page)
      .getByLabel("From year")
      .selectOption(String(new Date().getFullYear() + 3));
    await close();
    await expect(dialog(page), how).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "BALANCE" })).toHaveCount(0);
    await expect(page.locator(".register-table th.cell-flag")).toHaveCount(1);
    await expect(rows(page)).toHaveCount(before);
    await realClick(page, viewButton(page));
    await expect(check(page, "Show Running Balance")).toHaveAttribute("aria-checked", "false");
    await expect(check(page, "Show Flags")).toHaveAttribute("aria-checked", "true");
    await expect(pill(page, "All Dates")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(300);
  expect(puts).toBe(0);
});

test("in reconcile mode a row outside the date range shows and can be cleared (case 14)", async ({
  page,
  request,
}) => {
  const w = await seedWorked(request);
  const old = (
    await call(request, "POST", `/api/v1/budgets/${w.plan}/transactions`, {
      account_id: w.checking,
      date: monthsAgo(2),
      amount: -1000,
      payee_name: "ZZ Old Row",
      cleared: "uncleared",
    })
  ).transaction.id as string;
  await setViewSettings(request, w.plan, w.checking, { preset: "this_month" });
  await open(page, w.plan, w.checking);
  await expect(row(page, "ZZ Old Row")).toHaveCount(0);
  await expect(footer(page)).toBeVisible();
  await realClick(
    page,
    page.getByRole("main").getByRole("button", { name: "Reconcile", exact: true }),
  );
  await realClick(page, button(page, "No"));
  await page.keyboard.type("655.50");
  await page.keyboard.press("Enter");
  await realClick(
    page,
    page.getByRole("dialog", { name: "Reconcile", exact: true }).getByRole("button", {
      name: "Next",
      exact: true,
    }),
  );
  await expect(page.getByRole("region", { name: "Reconciliation", exact: true })).toBeVisible();
  await expect(row(page, "ZZ Old Row")).toBeVisible();
  await expect(footer(page)).toHaveCount(0);
  await realClick(page, row(page, "ZZ Old Row").locator(".cleared-button"));
  await expect(row(page, "ZZ Old Row").locator(".cleared-button.is-cleared")).toBeVisible();
  await expect
    .poll(
      async () =>
        (
          (
            await call(
              request,
              "GET",
              `/api/v1/budgets/${w.plan}/accounts/${w.checking}/transactions`,
            )
          ).transactions as { id: string; cleared: string }[]
        ).find((t) => t.id === old)?.cleared,
    )
    .toBe("cleared");
  await realClick(
    page,
    page
      .getByRole("region", { name: "Reconciliation", exact: true })
      .getByRole("button", { name: "Cancel", exact: true }),
  );
  await expect(row(page, "ZZ Old Row")).toHaveCount(0);
  await expect(footer(page)).toBeVisible();
});
