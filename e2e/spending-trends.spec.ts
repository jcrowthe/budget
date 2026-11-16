import { spawnSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { mouseClick } from "./support/menu";
import { newPlan, openReport } from "./support/reflect";
import { realClick } from "./support/register-seed";
import {
  customFrom,
  seedSpendingExample,
  seedTrendsSplitPlan,
  segmentPoint,
  setRange,
} from "./support/spending-breakdown-seed";

// Today is 2026-11-15 12:00 in the browser (openReport) and the API gets today=2026-11-15 from the web app.
const tip = (p: Page) => p.locator(".st-tooltip div");
const rows = (p: Page) =>
  p
    .locator(".st-table tbody tr")
    .evaluateAll((trs) => trs.map((r) => [...r.children].map((c) => c.textContent)));

const MAY_NOV_ROWS = [
  ["November 2026", "$55.00", "↓ −$80.82 (59.5%)"],
  ["October 2026", "$450.00", "↑ +$314.18 (231.3%)"],
  ["September 2026", "$175.24", "↑ +$39.42 (29.0%)"],
  ["August 2026", "$105.50", "↓ −$30.32 (22.3%)"],
  ["July 2026", "$165.00", "↑ +$29.18 (21.5%)"],
  ["June 2026", "$0.00", "↓ −$135.82 (100.0%)"],
  ["May 2026", "$0.00", "↓ −$135.82 (100.0%)"],
];

test("550-1 the example, May–Nov, and the API", async ({ page, request }) => {
  const { plan } = await seedSpendingExample(request);
  await openReport(page, plan.id, "spending-trends");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Spending Trends");
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
  await customFrom(page, "Sep 2026 – Nov 2026", "May 2026");
  await expect(page.getByTestId("st-average")).toHaveText("$135.82");
  await expect(page.getByTestId("st-total")).toHaveText("$950.74");
  await expect.poll(() => rows(page)).toEqual(MAY_NOV_ROWS);
  const res = await request.get(
    `/api/v1/budgets/${plan.id}/reports/spending-trends?start_month=2026-05-01&end_month=2026-11-01&today=2026-11-15`,
    { headers: await authHeaders() },
  );
  const data = (await res.json()).data;
  expect([data.total, data.average_monthly]).toEqual([950740, 135820]);
});

test("550-2 the default range is Last 3 Months; This Month is one month", async ({
  page,
  request,
}) => {
  const { plan } = await seedSpendingExample(request);
  await openReport(page, plan.id, "spending-trends");
  await expect(page.getByTestId("st-average")).toHaveText("$226.75");
  await expect(page.getByTestId("st-total")).toHaveText("$680.24");
  await expect
    .poll(() => rows(page))
    .toEqual([
      ["November 2026", "$55.00", "↓ −$171.75 (75.7%)"],
      ["October 2026", "$450.00", "↑ +$223.25 (98.5%)"],
      ["September 2026", "$175.24", "↓ −$51.51 (22.7%)"],
    ]);
  await mouseClick(page, page.getByRole("button", { name: "Sep 2026 – Nov 2026", exact: true }));
  await mouseClick(page, page.getByRole("menuitemradio", { name: "This Month", exact: true }));
  await expect(page.getByTestId("st-average")).toHaveText("$55.00");
  await expect(page.getByTestId("st-total")).toHaveText("$55.00");
  await expect.poll(() => rows(page)).toEqual([["November 2026", "$55.00", "$0.00 (0.0%)"]]);
});

test("550-3 hover a group segment and a marker", async ({ page, request }) => {
  const { plan, groupId } = await seedSpendingExample(request);
  await setRange(request, plan.id, "spending-trends", "2026-05-01", "2026-11-01");
  await openReport(page, plan.id, "spending-trends");
  await expect(page.getByTestId("st-total")).toHaveText("$950.74");
  const p = await segmentPoint(page, "2026-10-01", groupId);
  await page.mouse.move(p.x, p.y);
  await expect(tip(page)).toHaveText(["D8 Group", "$450.00", "100.0% of Total"]);
  const marker = await page.locator('.st-marker[data-month="2026-06-01"]').boundingBox();
  expect(marker).not.toBeNull();
  const m = marker as { x: number; y: number; width: number; height: number };
  await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
  await expect(tip(page)).toHaveText(["Jun 2026", "$0.00", "Total Spending"]);
});

test("550-4 drill into a group, then a category's popover", async ({ page, request }) => {
  const { plan, ids, groupId } = await seedSpendingExample(request);
  await setRange(request, plan.id, "spending-trends", "2026-05-01", "2026-11-01");
  await openReport(page, plan.id, "spending-trends");
  await expect(page.getByTestId("st-total")).toHaveText("$950.74");
  const p = await segmentPoint(page, "2026-10-01", groupId);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("All Groups › D8 Group");
  await expect(page.getByTestId("st-average")).toHaveText("$133.68");
  await expect(page.getByTestId("st-total")).toHaveText("$935.74");
  await expect(page.getByRole("button", { name: "All Categories", exact: true })).toBeVisible();
  for (const [cat, lines] of [
    ["D8 Food", ["D8 Food", "$130.00", "28.9% of Total"]],
    ["D8 Loan Pmt", ["D8 Loan Pmt", "$250.00", "55.6% of Total"]],
    ["D8 Fun", ["D8 Fun", "$30.00", "6.7% of Total"]],
    ["D8 Hidden", ["D8 Hidden", "$40.00", "8.9% of Total"]],
  ] as const) {
    const q = await segmentPoint(page, "2026-10-01", ids[cat] as string);
    await page.mouse.move(q.x, q.y);
    await expect(tip(page)).toHaveText([...lines]);
  }
  const food = await segmentPoint(page, "2026-10-01", ids["D8 Food"] as string);
  await page.mouse.move(food.x, food.y);
  await page.mouse.click(food.x, food.y);
  const dialog = page.getByRole("dialog", { name: "D8 Food–OCT 2026", exact: true });
  await expect(dialog.locator("tbody tr")).toHaveCount(2);
  expect(
    await dialog
      .locator("tbody tr")
      .evaluateAll((trs) => trs.map((r) => r.lastElementChild?.textContent)),
  ).toEqual(["+$20.00", "-$150.00"]);
  await realClick(page, dialog.getByRole("button", { name: "Close", exact: true }));
  await expect(dialog).toHaveCount(0);
  await realClick(page, page.getByRole("button", { name: "All Groups", exact: true }));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Spending Trends");
  await expect(page.getByTestId("st-total")).toHaveText("$950.74");
});

test("550-5, 550-9 a net inflow below zero, and a split in two groups (plan T)", async ({
  page,
  request,
}) => {
  const { plan } = await seedTrendsSplitPlan(request);
  const res = await request.put(`/api/v1/budgets/${plan.id}/report-settings/spending-trends`, {
    headers: await authHeaders(),
    data: { preset: "this_month" },
  });
  expect(res.status()).toBe(200);
  await openReport(page, plan.id, "spending-trends");
  await expect(page.getByTestId("st-total")).toHaveText("$50.00");
  await expect(page.getByTestId("st-average")).toHaveText("$50.00");
  const api = await request.get(
    `/api/v1/budgets/${plan.id}/reports/spending-trends?start_month=2026-11-01&end_month=2026-11-01&today=2026-11-15`,
    { headers: await authHeaders() },
  );
  const month = (await api.json()).data.months[0];
  expect(month.series.map((s: { amount: number }) => s.amount)).toEqual([60000, 40000, -50000]);
  const needs = month.series[0].id as string;
  const wants = month.series[1].id as string;
  const a = await segmentPoint(page, "2026-11-01", needs);
  await page.mouse.move(a.x, a.y);
  await expect(tip(page)).toHaveText(["T Needs", "$60.00", "60.0% of Total"]);
  const b = await segmentPoint(page, "2026-11-01", wants);
  await page.mouse.move(b.x, b.y);
  await expect(tip(page)).toHaveText(["T Wants", "$40.00", "40.0% of Total"]);
  const u = await segmentPoint(page, "2026-11-01", "uncategorized");
  await page.mouse.move(u.x, u.y);
  await expect(tip(page)).toHaveText(["Uncategorized Transactions", "−$50.00", "Net Inflows"]);
  // The net-inflow segment lies below the zero line.
  const zero = await page.locator(".st-zero").boundingBox();
  const unc = await page.locator('.st-seg[data-series="uncategorized"]').boundingBox();
  expect((unc as { y: number }).y).toBeGreaterThanOrEqual((zero as { y: number }).y - 1);
});

test("550-6 the empty plan", async ({ page, request }) => {
  const plan = await newPlan(request, "trends-empty");
  await openReport(page, plan.id, "spending-trends");
  await expect(page.getByTestId("st-average")).toHaveText("$0.00");
  await expect(page.getByTestId("st-total")).toHaveText("$0.00");
  await expect(page.locator(".st-marker")).toHaveCount(1);
  await expect(page.locator(".st-xlabel")).toHaveText(["11/26"]);
  await expect(page.locator(".st-tick")).toHaveCount(0);
  await expect(page.getByText("No spending to show yet", { exact: true })).toBeVisible();
  // The zero line sits at mid-height of the plot.
  const svg = (await page.locator(".st-chart svg").boundingBox()) as { y: number };
  const zero = (await page.locator(".st-zero").boundingBox()) as { y: number };
  expect(Math.abs(zero.y - svg.y - (24 + 266 / 2))).toBeLessThanOrEqual(1);
  const marker = (await page.locator(".st-marker").boundingBox()) as {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
  await expect(tip(page)).toHaveText(["Nov 2026", "$0.00", "Total Spending"]);
  await page.mouse.move(5, 5);
  await page.getByRole("button", { name: "About Compared to Average", exact: true }).hover();
  await expect(
    page.getByRole("tooltip").filter({ hasText: "This column highlights" }),
  ).toBeHidden();
  await page.waitForTimeout(2200);
  await expect(page.getByRole("tooltip").filter({ hasText: "This column highlights" })).toHaveText(
    "This column highlights the difference between your spending in individual months and your average monthly spending for the selected time period.",
  );
});

test("550-7 the export is a ZIP of two CSVs", async ({ page, request }) => {
  const { plan } = await seedSpendingExample(request);
  await setRange(request, plan.id, "spending-trends", "2026-05-01", "2026-11-01");
  await openReport(page, plan.id, "spending-trends");
  await expect(page.getByTestId("st-total")).toHaveText("$950.74");
  await mouseClick(page, page.getByRole("button", { name: "Export", exact: true }));
  const dialog = page.getByRole("dialog", { name: "Export Report" });
  const download = page.waitForEvent("download");
  await mouseClick(page, dialog.getByRole("button", { name: "Export", exact: true }));
  const file = await download;
  expect(file.suggestedFilename()).toBe("budget-reflect-spending-trends-2026-11-15.zip");
  const path = await file.path();
  const script = [
    "import sys, zipfile, base64, json",
    "z = zipfile.ZipFile(sys.argv[1])",
    "print(json.dumps({'bad': z.testzip(), 'files': [[i.filename, base64.b64encode(z.read(i)).decode()] for i in z.infolist()]}))",
  ].join("\n");
  const r = spawnSync("python3", ["-I", "-c", script, path], { encoding: "utf8" });
  expect(r.status).toBe(0);
  const out = JSON.parse(r.stdout) as { bad: string | null; files: [string, string][] };
  expect(out.bad).toBeNull();
  expect(out.files.map((f) => f[0])).toEqual([
    "budget-reflect-spending-trends-2026-11-15.csv",
    "budget-reflect-spending-trends-2026-11-15-transactions.csv",
  ]);
  const [summary, trans] = out.files.map((f) => Buffer.from(f[1], "base64").toString("utf8")) as [
    string,
    string,
  ];
  for (const t of [summary, trans]) {
    expect(t.startsWith("﻿")).toBe(true);
    expect(t).not.toContain("\r");
    expect(t.endsWith("\n")).toBe(false);
  }
  expect(summary.split("\n")).toContain(
    '"D8 Group","D8 Food",0.00,0.00,-120.00,-80.50,-99.99,-130.00,-55.00,-69.36,-485.49',
  );
});

test("550-10 All Dates shows every month on the x-axis", async ({ page, request }) => {
  const { plan } = await seedSpendingExample(request);
  const res = await request.put(`/api/v1/budgets/${plan.id}/report-settings/spending-trends`, {
    headers: await authHeaders(),
    data: { preset: "all_dates" },
  });
  expect(res.status()).toBe(200);
  await openReport(page, plan.id, "spending-trends");
  await expect(page.getByTestId("st-total")).toHaveText("$950.74");
  await expect(page.locator(".st-xlabel")).toHaveText([
    "05/26",
    "06/26",
    "07/26",
    "08/26",
    "09/26",
    "10/26",
    "11/26",
  ]);
  await expect(page.locator(".st-marker")).toHaveCount(7);
});
