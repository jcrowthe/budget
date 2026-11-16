import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { mouseClick } from "./support/menu";
import { addAccount, addTx, dateButton, newPlan, openReport, seedExample } from "./support/reflect";

const total = (p: Page) => p.getByTestId("nw-total");
const row = (p: Page, month: string) => p.locator(`tr[data-month="${month}"]`);

test("551-1 example data, all dates", async ({ page, request }) => {
  const { id } = await newPlan(request);
  await seedExample(request, id);
  await openReport(page, id, "net-worth");
  await expect(total(page)).toHaveText("$19,299.26");
  await expect(page.getByTestId("nw-assets")).toHaveText("$24,049.26");
  await expect(page.getByTestId("nw-debts")).toHaveText("-$4,750.00");
  await expect(page.getByTestId("nw-change")).toHaveText("+$18,799.26");
  await expect(page.getByTestId("nw-change")).toHaveClass(/positive/);
  await expect(page.getByTestId("nw-change-pct")).toHaveText("↑ 3,759.9%");
  const rows: [string, string, string, string][] = [
    ["2026-11-01", "Nov 2026", "$19,299.26", "↓ −$55.00 (-0.3%)"],
    ["2026-10-01", "Oct 2026", "$19,354.26", "↑ +$3,300.00 (20.6%)"],
    ["2026-09-01", "Sep 2026", "$16,054.26", "↑ +$2,824.76 (21.4%)"],
    ["2026-08-01", "Aug 2026", "$13,229.50", "↑ +$2,894.50 (28.0%)"],
    ["2026-07-01", "Jul 2026", "$10,335.00", "↑ +$2,835.00 (37.8%)"],
    ["2026-06-01", "Jun 2026", "$7,500.00", "↑ +$7,000.00 (1,400.0%)"],
    ["2026-05-01", "May 2026", "$500.00", "$0.00 (0.0%)"],
  ];
  await expect(page.locator(".nw-table tbody tr")).toHaveCount(7);
  for (const [m, label, nw, change] of rows) {
    await expect(row(page, m).locator("td")).toHaveText([label, nw, change]);
  }
  await expect(row(page, "2026-11-01").locator("td.change")).toHaveClass(/negative/);
  await expect(row(page, "2026-05-01").locator("td.change")).toHaveClass(/zero/);
  await expect(page.locator(".nw-table tbody tr").first()).toHaveAttribute(
    "data-month",
    "2026-11-01",
  );
  await page.getByRole("button", { name: "About Monthly Change" }).hover();
  await expect(page.getByRole("tooltip")).toHaveText(
    "This column highlights how much your net worth has changed month over month.",
  );
});

test("551-2 custom ranges", async ({ page, request }) => {
  const { id } = await newPlan(request);
  await seedExample(request, id);
  await openReport(page, id, "net-worth");
  const custom = async (from: string, start: string, end: string) => {
    await mouseClick(page, dateButton(page, from));
    await mouseClick(page, page.getByRole("menuitemradio", { name: "Custom", exact: true }));
    await mouseClick(page, page.getByRole("button", { name: "Start Date", exact: true }));
    await mouseClick(page, page.getByRole("button", { name: start, exact: true }));
    await mouseClick(page, page.getByRole("button", { name: "End Date", exact: true }));
    await mouseClick(page, page.getByRole("button", { name: end, exact: true }));
    await mouseClick(page, page.getByRole("button", { name: "Apply", exact: true }));
  };
  await custom("May 2026 – Nov 2026", "Sep 2026", "Nov 2026");
  await expect(page.getByTestId("nw-change")).toHaveText("+$3,245.00");
  await expect(page.getByTestId("nw-change-pct")).toHaveText("↑ 20.2%");
  await custom("Sep 2026 – Nov 2026", "Jul 2026", "Sep 2026");
  await expect(total(page)).toHaveText("$16,054.26");
  await expect(page.getByTestId("nw-assets")).toHaveText("$21,054.26");
  await expect(page.getByTestId("nw-debts")).toHaveText("-$5,000.00");
  await expect(page.getByTestId("nw-change")).toHaveText("+$5,719.26");
  await expect(page.getByTestId("nw-change-pct")).toHaveText("↑ 55.3%");
  // The first row's change uses the month before the range.
  await expect(row(page, "2026-07-01").locator("td")).toHaveText([
    "Jul 2026",
    "$10,335.00",
    "↑ +$2,835.00 (37.8%)",
  ]);
});

test("551-3 a cash account below zero counts as debt", async ({ page, request }) => {
  const { id } = await newPlan(request);
  const { sav } = await seedExample(request, id);
  await addTx(request, id, sav, "2026-11-02", -1000000);
  await openReport(page, id, "net-worth");
  await expect(page.getByTestId("nw-assets")).toHaveText("$23,349.26");
  await expect(page.getByTestId("nw-debts")).toHaveText("-$5,050.00");
});

test("551-4 tooltip and chart", async ({ page, request }) => {
  const { id } = await newPlan(request);
  await seedExample(request, id);
  await openReport(page, id, "net-worth");
  await mouseClick(page, page.getByRole("button", { name: "May 2026 – Nov 2026", exact: true }));
  await mouseClick(page, page.getByRole("menuitemradio", { name: "Last 6 Months", exact: true }));
  await expect(page.locator(".bar-debts")).toHaveCount(6);
  await page.locator('rect[data-month="2026-09-01"]').hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("Sep 2026");
  await expect(tip).toContainText(/Debts\s*\$5,000\.00/);
  await expect(tip).toContainText(/Assets\s*\$21,054\.26/);
  await expect(tip).toContainText(/Net Worth\s*\$16,054\.26/);
  const before = await total(page).textContent();
  await page.locator('rect[data-month="2026-09-01"]').click();
  await expect(total(page)).toHaveText(before ?? "");
  await mouseClick(page, page.getByRole("button", { name: "Jun 2026 – Nov 2026", exact: true }));
  await mouseClick(page, page.getByRole("menuitemradio", { name: "Custom", exact: true }));
  await mouseClick(page, page.getByRole("button", { name: "Start Date", exact: true }));
  await mouseClick(page, page.getByRole("button", { name: "Jul 2026", exact: true }));
  await mouseClick(page, page.getByRole("button", { name: "Apply", exact: true }));
  await expect(page.locator(".bar-debts")).toHaveCount(5);
  await expect(page.locator(".bar-assets")).toHaveCount(5);
  await expect(page.locator(".nw-chart svg text")).toContainText([
    "07/26",
    "08/26",
    "09/26",
    "10/26",
    "11/26",
  ]);
});

test("551-5 deselecting the tracking accounts", async ({ page, request }) => {
  const { id } = await newPlan(request);
  await seedExample(request, id);
  await openReport(page, id, "net-worth");
  await mouseClick(page, page.getByRole("button", { name: "All Accounts", exact: true }));
  const pop = page.getByRole("dialog", { name: "Select Accounts" });
  await mouseClick(page, pop.getByRole("checkbox", { name: "Tracking Accounts", exact: true }));
  await mouseClick(page, pop.getByRole("button", { name: "Done", exact: true }));
  await expect(
    page.getByRole("button", { name: "2 Selected Accounts", exact: true }),
  ).toBeVisible();
  await expect(total(page)).toHaveText("$13,549.26");
  await expect(page.getByTestId("nw-assets")).toHaveText("$13,549.26");
  await expect(page.getByTestId("nw-debts")).toHaveText("-$0.00");
  await expect(row(page, "2026-06-01").locator("td").nth(1)).toHaveText("$2,500.00");
});

test("551-6 the CSV export", async ({ page, request }) => {
  const { id } = await newPlan(request);
  await seedExample(request, id);
  await openReport(page, id, "net-worth");
  await mouseClick(page, page.getByRole("button", { name: "Export", exact: true }));
  const dl = page.waitForEvent("download");
  await mouseClick(
    page,
    page
      .getByRole("dialog", { name: "Export Report" })
      .getByRole("button", { name: "Export", exact: true }),
  );
  const download = await dl;
  expect(download.suggestedFilename()).toBe("budget-reflect-net-worth-2026-11-15.csv");
  const path = await download.path();
  const bytes = await readFile(path);
  expect(bytes[0]).not.toBe(0xef);
  expect(bytes.toString("utf8")).toBe(
    [
      '"Account","May 2026","Jun 2026","Jul 2026","Aug 2026","Sep 2026","Oct 2026","Nov 2026"',
      '"D8 Savings",500.00,500.00,500.00,500.00,700.00,700.00,700.00',
      '"D8 Checking",0.00,2000.00,4835.00,7729.50,10354.26,12904.26,12849.26',
      '"D8 House",0.00,10000.00,10000.00,10000.00,10000.00,10500.00,10500.00',
      '"D8 Car Loan",0.00,-5000.00,-5000.00,-5000.00,-5000.00,-4750.00,-4750.00',
      '"Net Worth",500.00,7500.00,10335.00,13229.50,16054.26,19354.26,19299.26',
    ].join("\n"),
  );
});

test("551-7, 551-8 the API and the MCP tool agree", async ({ request }) => {
  const { id } = await newPlan(request);
  await seedExample(request, id);
  const headers = await authHeaders();
  const q = "start_month=2026-05-01&end_month=2026-11-01&today=2026-11-15";
  const rest = (
    await (await request.get(`/api/v1/budgets/${id}/reports/net-worth?${q}`, { headers })).json()
  ).data;
  expect(rest.months[6].net_worth).toBe(19299260);
  const init = await request.post("/mcp", {
    headers: {
      ...headers,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "e2e", version: "1" },
      },
    },
  });
  expect(init.ok()).toBe(true);
  const call = await request.post("/mcp", {
    headers: {
      ...headers,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    data: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "get_net_worth",
        arguments: { budget_id: id, start_month: "2026-05-01", end_month: "2026-11-01" },
      },
    },
  });
  const text = await call.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const body = JSON.parse(line ? line.slice(5) : text);
  expect(body.result.structuredContent).toEqual(rest);
});

test("an empty plan", async ({ page, request }) => {
  const { id } = await newPlan(request);
  await openReport(page, id, "net-worth");
  await expect(total(page)).toHaveText("$0.00");
  await expect(page.getByTestId("nw-assets")).toHaveText("$0.00");
  await expect(page.getByTestId("nw-debts")).toHaveText("-$0.00");
  await expect(page.getByTestId("nw-change")).toHaveText("$0.00");
  await expect(page.getByTestId("nw-change-pct")).toHaveText("0.0%");
  await expect(page.locator(".nw-chart svg text")).toHaveText(["11/26"]);
  await expect(page.getByText("No information to show")).toBeVisible();
});
