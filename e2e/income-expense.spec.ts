import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { mouseClick } from "./support/menu";
import { openReport } from "./support/reflect";
import { realClick } from "./support/register-seed";
import {
  IE_ORDER,
  seedIncomeEmptyPlan,
  seedIncomePlan,
  seedSpendingExample,
  setRange,
} from "./support/spending-breakdown-seed";

// Today is 2026-11-15 12:00 in the browser (openReport) and the API gets today=2026-11-15 from the web app.

/** Dollars as the report prints them: "$3,000.00", "−$15.00" (U+2212). */
const $ = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Rows that hold amounts: [label, ...cell texts]. */
const amountRows = (p: Page) =>
  p
    .locator(".ie-table tbody tr")
    .evaluateAll((trs) =>
      trs
        .filter((r) => r.querySelectorAll("td").length > 1)
        .map((r) => [
          r.querySelector("th")?.textContent ?? "",
          ...[...r.querySelectorAll("td")].map((c) => c.textContent ?? ""),
        ]),
    );
const labels = (p: Page) => amountRows(p).then((rows) => rows.map((r) => r[0]));
const row = (label: string, ...v: number[]) => [label, ...v.map($)];
const rowheader = (p: Page, name: string) => p.getByRole("rowheader", { name, exact: true });
const button = (p: Page, name: string) => p.getByRole("button", { name, exact: true });
const popoverRows = (d: Locator) =>
  d
    .locator("tbody tr")
    .evaluateAll((trs) =>
      trs.map((r) => [r.children[2]?.textContent, r.lastElementChild?.textContent]),
    );
const closeDialog = async (p: Page, d: Locator) => {
  await realClick(p, d.getByRole("button", { name: "Close", exact: true }));
  await expect(d).toHaveCount(0);
};

test("552-1, 552-2, 552-6 the worked table, cell by cell, and the API", async ({
  page,
  request,
}) => {
  const { plan } = await seedSpendingExample(request, { order: IE_ORDER });
  await setRange(request, plan.id, "income-expense", "2026-05-01", "2026-11-01");
  await openReport(page, plan.id, "income-expense");
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
  await expect(page.getByRole("columnheader")).toHaveText([
    "Category",
    "MAY 2026",
    "JUN 2026",
    "JUL 2026",
    "AUG 2026",
    "SEP 2026",
    "OCT 2026",
    "NOV 2026",
    "AVERAGE",
    "TOTAL",
  ]);
  const inc = [0, 0, 3000, 3000, 3000, 3000, 0, 1714.29, 12000];
  await expect
    .poll(() => amountRows(page))
    .toEqual([
      row("D8 Employer", ...inc),
      row("Total All Income Sources", ...inc),
      row("Total Income", ...inc),
      row("Uncategorized Transactions", 0, 0, 0, 0, -15, 0, 0, -2.14, -15),
      row("D8 Hidden", 0, 0, 0, 0, 0, -40, 0, -5.71, -40),
      row("D8 Loan Pmt", 0, 0, 0, 0, 0, -250, 0, -35.71, -250),
      row("D8 Utilities", 0, 0, 0, 0, -60.25, 0, 0, -8.61, -60.25),
      row("D8 Fun", 0, 0, -45, -25, 0, -30, 0, -14.29, -100),
      row("D8 Food", 0, 0, -120, -80.5, -99.99, -130, -55, -69.36, -485.49),
      row("Total D8 Group", 0, 0, -165, -105.5, -160.24, -450, -55, -133.68, -935.74),
      row("Total Expenses", 0, 0, -165, -105.5, -175.24, -450, -55, -135.82, -950.74),
      row("Net Income by month", 0, 0, 2835, 2894.5, 2824.76, 2550, -55, 1578.47, 11049.26),
    ]);
  await expect(page.locator(".ie-net .amt.positive").nth(-1)).toHaveText("$11,049.26");
  await expect(page.locator(".ie-net .amt.positive").nth(-2)).toHaveText("$1,578.47");
  for (const t of ["Starting Balance", "Transfer", "$500.00", "$2,000.00"]) {
    await expect(page.locator("main")).not.toContainText(t);
  }
  const res = await request.get(
    `/api/v1/budgets/${plan.id}/reports/income-expense?start_month=2026-05-01&end_month=2026-11-01&today=2026-11-15`,
    { headers: await authHeaders() },
  );
  expect((await res.json()).data.net_income.total).toBe(11049260);
});

test("552-3 collapse a group, Expense, Income and All Income Sources", async ({
  page,
  request,
}) => {
  const { plan } = await seedSpendingExample(request, { order: IE_ORDER });
  await setRange(request, plan.id, "income-expense", "2026-05-01", "2026-11-01");
  await openReport(page, plan.id, "income-expense");
  await expect(rowheader(page, "Total Expenses")).toBeVisible();
  // A group.
  await realClick(page, button(page, "D8 Group"));
  await expect(rowheader(page, "Total D8 Group")).toHaveCount(0);
  await expect(rowheader(page, "D8 Food")).toHaveCount(0);
  await expect(button(page, "D8 Group").first()).toHaveAttribute("aria-expanded", "false");
  await expect(button(page, "D8 Group–JUL 2026")).toHaveText("−$165.00");
  await expect(button(page, "D8 Group–TOTAL")).toHaveText("−$935.74");
  await realClick(page, button(page, "D8 Group"));
  await expect(rowheader(page, "Total D8 Group")).toBeVisible();
  // Expense.
  await realClick(page, button(page, "Expense"));
  await expect(rowheader(page, "Total Expenses")).toHaveCount(0);
  await expect(rowheader(page, "D8 Food")).toHaveCount(0);
  await expect(rowheader(page, "Uncategorized Transactions")).toHaveCount(0);
  await expect(rowheader(page, "Net Income by month")).toBeVisible();
  await realClick(page, button(page, "Expense"));
  await expect(rowheader(page, "Total Expenses")).toBeVisible();
  // Income and All Income Sources.
  await realClick(page, button(page, "All Income Sources"));
  await expect(rowheader(page, "D8 Employer")).toHaveCount(0);
  await expect(rowheader(page, "Total All Income Sources")).toHaveCount(0);
  await expect(button(page, "All Income Sources–TOTAL")).toHaveText("$12,000.00");
  await realClick(page, button(page, "All Income Sources"));
  await expect(rowheader(page, "D8 Employer")).toBeVisible();
  await realClick(page, button(page, "Income"));
  await expect(rowheader(page, "Total Income")).toHaveCount(0);
  await expect(rowheader(page, "D8 Employer")).toHaveCount(0);
  await expect(rowheader(page, "Net Income by month")).toBeVisible();
  await realClick(page, button(page, "Income"));
  await expect(rowheader(page, "Total Income")).toBeVisible();
  // Nothing is stored: a reload shows everything expanded.
  await realClick(page, button(page, "Expense"));
  await page.reload();
  await expect(rowheader(page, "Total Expenses")).toBeVisible();
});

test("552-4 the drill-down popovers", async ({ page, request }) => {
  const { plan } = await seedSpendingExample(request, { order: IE_ORDER });
  await setRange(request, plan.id, "income-expense", "2026-05-01", "2026-11-01");
  await openReport(page, plan.id, "income-expense");
  await expect(rowheader(page, "Total Expenses")).toBeVisible();
  const dialog = (name: string) => page.getByRole("dialog", { name, exact: true });

  await realClick(page, button(page, "D8 Food–OCT 2026"));
  await expect(dialog("D8 Food–OCT 2026").locator("tbody tr")).toHaveCount(2);
  expect(await popoverRows(dialog("D8 Food–OCT 2026"))).toEqual([
    ["D8 Grocer", "+$20.00"],
    ["D8 Grocer", "−$150.00"],
  ]);
  await closeDialog(page, dialog("D8 Food–OCT 2026"));

  await realClick(page, button(page, "D8 Food–TOTAL"));
  await expect(dialog("D8 Food").locator("tbody tr")).toHaveCount(6);
  await closeDialog(page, dialog("D8 Food"));

  await realClick(page, button(page, "Total Income–OCT 2026"));
  await expect(dialog("Total Income–OCT 2026").locator("tbody tr")).toHaveCount(1);
  expect(await popoverRows(dialog("Total Income–OCT 2026"))).toEqual([
    ["D8 Employer", "+$3,000.00"],
  ]);
  await closeDialog(page, dialog("Total Income–OCT 2026"));

  await realClick(page, button(page, "Total Expenses–OCT 2026"));
  await expect(dialog("Total Expenses–OCT 2026").locator("tbody tr")).toHaveCount(5);
  await closeDialog(page, dialog("Total Expenses–OCT 2026"));

  await realClick(page, button(page, "Total D8 Group–SEP 2026"));
  await expect(dialog("Total D8 Group–SEP 2026").locator("tbody tr")).toHaveCount(2);
  await closeDialog(page, dialog("Total D8 Group–SEP 2026"));
});

test("552-5 the export is one CSV without a BOM", async ({ page, request }) => {
  const { plan } = await seedSpendingExample(request, { order: IE_ORDER });
  await setRange(request, plan.id, "income-expense", "2026-05-01", "2026-11-01");
  await openReport(page, plan.id, "income-expense");
  await expect(rowheader(page, "Total Expenses")).toBeVisible();
  await mouseClick(page, page.getByRole("button", { name: "Export", exact: true }));
  const dialog = page.getByRole("dialog", { name: "Export Report" });
  const download = page.waitForEvent("download");
  await mouseClick(page, dialog.getByRole("button", { name: "Export", exact: true }));
  const file = await download;
  expect(file.suggestedFilename()).toBe("budget-reflect-income-expense-2026-11-15.csv");
  const bytes = readFileSync((await file.path()) as string);
  expect(bytes[0]).not.toBe(0xef);
  const text = bytes.toString("utf8");
  expect(text).not.toContain("\r");
  expect(text.endsWith("\n")).toBe(false);
  expect(text).toBe(
    [
      '"Category","May 2026","Jun 2026","Jul 2026","Aug 2026","Sep 2026","Oct 2026","Nov 2026","Average","Total"',
      '"All Income Sources",0.00,0.00,3000.00,3000.00,3000.00,3000.00,0.00,1714.29,12000.00',
      '"D8 Employer",0.00,0.00,3000.00,3000.00,3000.00,3000.00,0.00,1714.29,12000.00',
      '"Total Income",0.00,0.00,3000.00,3000.00,3000.00,3000.00,0.00,1714.29,12000.00',
      '"Uncategorized Transactions",0.00,0.00,0.00,0.00,-15.00,0.00,0.00,-2.14,-15.00',
      '"D8 Group",0.00,0.00,-165.00,-105.50,-160.24,-450.00,-55.00,-133.68,-935.74',
      '"D8 Hidden",0.00,0.00,0.00,0.00,0.00,-40.00,0.00,-5.71,-40.00',
      '"D8 Loan Pmt",0.00,0.00,0.00,0.00,0.00,-250.00,0.00,-35.71,-250.00',
      '"D8 Utilities",0.00,0.00,0.00,0.00,-60.25,0.00,0.00,-8.61,-60.25',
      '"D8 Fun",0.00,0.00,-45.00,-25.00,0.00,-30.00,0.00,-14.29,-100.00',
      '"D8 Food",0.00,0.00,-120.00,-80.50,-99.99,-130.00,-55.00,-69.36,-485.49',
      '"Total Expenses",0.00,0.00,-165.00,-105.50,-175.24,-450.00,-55.00,-135.82,-950.74',
      '"Net Income",0.00,0.00,2835.00,2894.50,2824.76,2550.00,-55.00,1578.47,11049.26',
    ].join("\n"),
  );
});

test("552-7 income by payee, an adjustment, no payee (plan I)", async ({ page, request }) => {
  const { plan } = await seedIncomePlan(request);
  const set = await request.put(`/api/v1/budgets/${plan.id}/report-settings/income-expense`, {
    headers: await authHeaders(),
    data: { preset: "this_month" },
  });
  expect(set.status()).toBe(200);
  await openReport(page, plan.id, "income-expense");
  await expect
    .poll(() => labels(page))
    .toEqual([
      "I Line Payer",
      "I Parent",
      "Manual Balance Adjustment",
      "(no payee)",
      "Total All Income Sources",
      "Total Income",
      "Total Expenses",
      "Net Income by month",
    ]);
  expect(await amountRows(page)).toEqual([
    row("I Line Payer", 30, 30, 30),
    row("I Parent", 50, 50, 50),
    row("Manual Balance Adjustment", -250, -250, -250),
    row("(no payee)", 10, 10, 10),
    row("Total All Income Sources", -160, -160, -160),
    row("Total Income", -160, -160, -160),
    row("Total Expenses", 0, 0, 0),
    row("Net Income by month", -160, -160, -160),
  ]);
  for (const t of ["$1,000.00", "$80.00", "$100.00"]) {
    await expect(page.locator("main")).not.toContainText(t);
  }
  await realClick(page, button(page, "Manual Balance Adjustment–NOV 2026"));
  const manual = page.getByRole("dialog", {
    name: "Manual Balance Adjustment–NOV 2026",
    exact: true,
  });
  await expect(manual.locator("tbody tr")).toHaveCount(1);
  expect(await popoverRows(manual)).toEqual([["Manual Balance Adjustment", "−$250.00"]]);
  await closeDialog(page, manual);
  const asked = page.waitForRequest((r) => r.url().includes("income_payee_id=none"));
  await realClick(page, button(page, "(no payee)–NOV 2026"));
  await asked;
  const none = page.getByRole("dialog", { name: "(no payee)–NOV 2026", exact: true });
  await expect(none.locator("tbody tr")).toHaveCount(1);
  expect(await popoverRows(none)).toEqual([["", "+$10.00"]]);
});

test("552 empty: only an adjustment (plan E)", async ({ page, request }) => {
  const { plan } = await seedIncomeEmptyPlan(request);
  const set = await request.put(`/api/v1/budgets/${plan.id}/report-settings/income-expense`, {
    headers: await authHeaders(),
    data: { preset: "this_month" },
  });
  expect(set.status()).toBe(200);
  await openReport(page, plan.id, "income-expense");
  await expect
    .poll(() => labels(page))
    .toEqual([
      "Manual Balance Adjustment",
      "Total All Income Sources",
      "Total Income",
      "Total Expenses",
      "Net Income by month",
    ]);
  expect(await amountRows(page)).toEqual([
    row("Manual Balance Adjustment", -50, -50, -50),
    row("Total All Income Sources", -50, -50, -50),
    row("Total Income", -50, -50, -50),
    row("Total Expenses", 0, 0, 0),
    row("Net Income by month", -50, -50, -50),
  ]);
  await expect(button(page, "Income")).toBeVisible();
  await expect(button(page, "All Income Sources")).toBeVisible();
  await expect(button(page, "Total Expenses–NOV 2026").locator(".amt")).toHaveClass(/zero/);
  await expect(page.locator(".ie-net .amt").first()).toHaveClass(/negative/);
  await realClick(page, button(page, "Expense"));
  await expect(rowheader(page, "Total Expenses")).toHaveCount(0);
  await expect(rowheader(page, "Net Income by month")).toBeVisible();
  await realClick(page, button(page, "Expense"));
  await expect(rowheader(page, "Total Expenses")).toBeVisible();
});

test("552-9 twelve months at 1024×700 scroll sideways inside the table's box", async ({
  page,
  request,
}) => {
  const { plan } = await seedSpendingExample(request, {
    order: IE_ORDER,
    earlyMonth: "2025-12-01",
  });
  const set = await request.put(`/api/v1/budgets/${plan.id}/report-settings/income-expense`, {
    headers: await authHeaders(),
    data: { preset: "last_12_months" },
  });
  expect(set.status()).toBe(200);
  await page.setViewportSize({ width: 1024, height: 700 });
  await openReport(page, plan.id, "income-expense");
  await expect(page.getByRole("columnheader")).toHaveCount(15);
  await expect(rowheader(page, "D8 Food")).toBeVisible();
  const sizes = () =>
    page.evaluate(() => {
      const box = document.querySelector(".ie-scroll") as HTMLElement;
      const doc = document.documentElement;
      return {
        box: [box.scrollWidth, box.clientWidth],
        doc: [doc.scrollWidth, doc.clientWidth],
      };
    });
  const s = await sizes();
  expect(s.box[0]).toBeGreaterThan(s.box[1] as number);
  expect(s.doc[0]).toBeLessThanOrEqual(s.doc[1] as number);
  const x = async () => ((await rowheader(page, "D8 Food").boundingBox()) as { x: number }).x;
  const before = await x();
  await page.evaluate(() => {
    const box = document.querySelector(".ie-scroll") as HTMLElement;
    box.scrollLeft = box.scrollWidth;
  });
  await expect
    .poll(() =>
      page.evaluate(() => (document.querySelector(".ie-scroll") as HTMLElement).scrollLeft),
    )
    .toBeGreaterThan(0);
  expect(await x()).toBe(before);
  await realClick(page, button(page, "D8 Food–TOTAL"));
  const dialog = page.getByRole("dialog", { name: "D8 Food", exact: true });
  await expect(dialog.locator("tbody tr")).toHaveCount(6);
  const b = (await dialog.boundingBox()) as { x: number; y: number; width: number; height: number };
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(1024);
  expect(b.y + b.height).toBeLessThanOrEqual(700);
});
