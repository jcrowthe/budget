import { spawnSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { mouseClick } from "./support/menu";
import { dateButton, newPlan, openReport } from "./support/reflect";
import { realClick } from "./support/register-seed";
import {
  clickSlice,
  hoverSlice,
  seedSpendingExample,
  seedSplitPlan,
} from "./support/spending-breakdown-seed";

// Today is 2026-11-15 12:00 in the browser (openReport) and the API gets today=2026-11-15 from the web app.
const VIEWPORTS = [
  { width: 1600, height: 900 },
  { width: 1024, height: 700 },
];

const total = (p: Page) => p.getByTestId("sb-total");
const listRow = (p: Page, name: string) =>
  p.getByRole("button", { name: new RegExp(`^${name} \\$`) });

/** Custom range through the date menu with the real mouse; the end stays on the current month. */
async function customFrom(page: Page, from: string, start: string) {
  await mouseClick(page, dateButton(page, from));
  await mouseClick(page, page.getByRole("menuitemradio", { name: "Custom", exact: true }));
  await mouseClick(page, page.getByRole("button", { name: "Start Date", exact: true }));
  await mouseClick(page, page.getByRole("button", { name: start, exact: true }));
  await mouseClick(page, page.getByRole("button", { name: "Apply", exact: true }));
}

async function listItems(page: Page) {
  return page.locator(".sb-row").evaluateAll((els) =>
    els.map((e) => ({
      name: e.querySelector(".sb-row-name")?.textContent,
      amount: e.querySelector(".sb-row-amount")?.textContent,
      pct: e.querySelector(".sb-row-pct")?.textContent,
    })),
  );
}

const JUN_NOV = [
  { name: "D8 Food", amount: "$485.49", pct: "51%" },
  { name: "D8 Loan Pmt", amount: "$250.00", pct: "26%" },
  { name: "D8 Fun", amount: "$100.00", pct: "11%" },
  { name: "D8 Utilities", amount: "$60.25", pct: "6%" },
  { name: "D8 Hidden", amount: "$40.00", pct: "4%" },
  { name: "Uncategorized", amount: "$15.00", pct: "2%" },
];

test("549-1 the example, Jun–Nov, and the API", async ({ page, request }) => {
  const { plan } = await seedSpendingExample(request);
  await openReport(page, plan.id, "spending-breakdown");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Spending Breakdown");
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
  await customFrom(page, "Nov 2026", "Jun 2026");
  await expect(total(page)).toHaveText("$950.74");
  await expect(page.getByTestId("sb-centre-amount")).toHaveText("$950.74");
  await expect.poll(() => listItems(page)).toEqual(JUN_NOV);
  // Outside labels on the first three slices only (the threshold is 10%).
  await expect(page.locator(".sb-label-name")).toHaveText(["D8 Food", "D8 Loan Pmt", "D8 Fun"]);
  await expect(page.locator(".sb-label-value")).toHaveText([
    "$485.49 (51%)",
    "$250.00 (26%)",
    "$100.00 (11%)",
  ]);
  await expect(page.getByTestId("sb-average-monthly")).toHaveText("$158.46");
  await expect(page.getByTestId("sb-average-daily")).toHaveText("$5.20");
  await expect(page.getByTestId("sb-most-frequent")).toHaveText("D8 Food");
  await expect(page.getByTestId("sb-most-frequent-count")).toHaveText("6 transactions");
  await expect(page.getByTestId("sb-largest")).toHaveText("Transfer : D8 Car Loan");
  await expect(page.getByTestId("sb-largest-amount")).toHaveText("$250.00");
  await expect(page.getByText("Most Frequent Category", { exact: true })).toBeVisible();
  // The API returns the same figures in milliunits.
  const res = await request.get(
    `/api/v1/budgets/${plan.id}/reports/spending-breakdown?start_month=2026-06-01&end_month=2026-11-01&today=2026-11-15`,
    { headers: await authHeaders() },
  );
  expect((await res.json()).data.total).toBe(950740);
});

test("549-2 averages over other ranges", async ({ page, request }) => {
  const { plan } = await seedSpendingExample(request);
  await openReport(page, plan.id, "spending-breakdown");
  await expect(total(page)).toHaveText("$55.00");
  await expect(page.getByTestId("sb-average-monthly")).toHaveText("$55.00");
  await expect(page.getByTestId("sb-average-daily")).toHaveText("$1.83");
  await customFrom(page, "Nov 2026", "May 2026");
  await expect(page.getByTestId("sb-average-monthly")).toHaveText("$135.82");
  await expect(page.getByTestId("sb-average-daily")).toHaveText("$4.44");
  await customFrom(page, "May 2026 – Nov 2026", "Sep 2026");
  await expect(total(page)).toHaveText("$680.24");
  await expect(page.getByTestId("sb-average-monthly")).toHaveText("$226.75");
  await expect(page.getByTestId("sb-average-daily")).toHaveText("$7.48");
});

for (const vp of VIEWPORTS) {
  test.describe(`at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test("549-3, 549-4 Groups, the group drill and the reload", async ({ page, request }) => {
      const { plan, groupId } = await seedSpendingExample(request);
      await openReport(page, plan.id, "spending-breakdown");
      await customFrom(page, "Nov 2026", "Jun 2026");
      await expect(total(page)).toHaveText("$950.74");
      await realClick(page, page.getByRole("radio", { name: "Groups", exact: true }));
      await expect(page.locator(".sb-list-head span").first()).toHaveText("Groups");
      await expect
        .poll(() => listItems(page))
        .toEqual([
          { name: "D8 Group", amount: "$935.74", pct: "98%" },
          { name: "Uncategorized", amount: "$15.00", pct: "2%" },
        ]);
      await expect(page.getByText("Most Frequent Group", { exact: true })).toBeVisible();
      await expect(page.getByTestId("sb-most-frequent-count")).toHaveText("12 transactions");
      // Click the group's slice with the real mouse.
      await clickSlice(page, groupId);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("All Groups › D8 Group");
      await expect(page.getByRole("radiogroup", { name: "Breakdown by" })).toHaveCount(0);
      await expect(total(page)).toHaveText("$935.74");
      await expect(page.getByTestId("sb-average-monthly")).toHaveText("$155.96");
      await expect(page.getByTestId("sb-average-daily")).toHaveText("$5.11");
      await expect(page.locator(".sb-row-pct")).toHaveText(["52%", "27%", "11%", "6%", "4%"]);
      await realClick(page, page.getByRole("button", { name: "All Categories", exact: true }));
      const pop = page.getByRole("dialog", { name: "Select Categories" });
      await expect(pop.getByRole("checkbox")).toHaveCount(6); // the group and its five categories
      await expect(pop.getByText("Uncategorized Transactions")).toHaveCount(0);
      await realClick(page, pop.getByRole("button", { name: "Cancel", exact: true }));
      await realClick(page, page.getByRole("button", { name: "All Groups", exact: true }));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Spending Breakdown");
      await expect(page.getByRole("radio", { name: "Groups", exact: true })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(total(page)).toHaveText("$950.74");
      await page.reload();
      await expect(page.getByRole("radio", { name: "Categories", exact: true })).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });

    test("549-5 the Food popover: rows, window, Close, row click", async ({ page, request }) => {
      const { plan, ids } = await seedSpendingExample(request);
      await openReport(page, plan.id, "spending-breakdown");
      await customFrom(page, "Nov 2026", "Jun 2026");
      await expect(total(page)).toHaveText("$950.74");
      const dialog = page.getByRole("dialog", { name: "D8 Food", exact: true });
      const rows = dialog.locator("tbody tr");
      const expected = [
        ["D8 Checking", "11/03/2026", "D8 Grocer", "", "−$55.00"],
        ["D8 Checking", "10/21/2026", "D8 Grocer", "refund", "+$20.00"],
        ["D8 Checking", "10/09/2026", "D8 Grocer", "", "−$150.00"],
        ["D8 Checking", "09/12/2026", "D8 Grocer", "", "−$99.99"],
        ["D8 Checking", "08/05/2026", "D8 Grocer", "", "−$80.50"],
        ["D8 Checking", "07/10/2026", "D8 Grocer", "weekly shop", "−$120.00"],
      ];
      const inWindow = async () => {
        const b = await dialog.boundingBox();
        expect(b).not.toBeNull();
        const box = b as { x: number; y: number; width: number; height: number };
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
        expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
      };
      const check = async () => {
        await expect(rows).toHaveCount(6);
        expect(
          await rows.evaluateAll((trs) =>
            trs.map((r) => [...r.children].map((c) => c.textContent)),
          ),
        ).toEqual(expected);
        await expect(dialog.locator("thead th")).toHaveText([
          "ACCOUNT",
          "DATE",
          "PAYEE",
          "MEMO",
          "AMOUNT",
        ]);
        await inWindow();
      };
      // The row, then the slice.
      await realClick(page, listRow(page, "D8 Food"));
      await check();
      await realClick(page, dialog.getByRole("button", { name: "Close", exact: true }));
      await expect(dialog).toHaveCount(0);
      await clickSlice(page, ids["D8 Food"] as string);
      await check();
      await realClick(page, dialog.getByRole("button", { name: "Close", exact: true }));
      await expect(dialog).toHaveCount(0);
      // A row opens that account's register.
      await realClick(page, listRow(page, "D8 Food"));
      await realClick(page, rows.first());
      await expect(page).toHaveURL(`/${plan.id}/accounts/${ids.chk}`);
    });
  });
}

test("549-6 hover a slice and a row", async ({ page, request }) => {
  const { plan, ids } = await seedSpendingExample(request);
  await openReport(page, plan.id, "spending-breakdown");
  await customFrom(page, "Nov 2026", "Jun 2026");
  await expect(total(page)).toHaveText("$950.74");
  await hoverSlice(page, ids["D8 Loan Pmt"] as string);
  await expect(page.getByTestId("sb-centre-name")).toHaveText("D8 Loan Pmt");
  await expect(page.getByTestId("sb-centre-amount")).toHaveText("$250.00");
  await expect(page.getByTestId("sb-centre-pct")).toHaveText("26%");
  await expect(page.locator(`.sb-slice[data-id="${ids["D8 Food"]}"]`)).toHaveAttribute(
    "opacity",
    "0.4",
  );
  await expect(page.locator(`.sb-slice[data-id="${ids["D8 Loan Pmt"]}"]`)).toHaveAttribute(
    "opacity",
    "1",
  );
  await page.mouse.move(2, 2);
  await expect(page.getByTestId("sb-centre-name")).toHaveText("Total Spending");
  await expect(page.locator(`.sb-slice[data-id="${ids["D8 Food"]}"]`)).toHaveAttribute(
    "opacity",
    "1",
  );
  const row = listRow(page, "D8 Fun");
  await row.scrollIntoViewIfNeeded();
  const b = await row.boundingBox();
  await page.mouse.move((b?.x ?? 0) + 40, (b?.y ?? 0) + (b?.height ?? 0) / 2);
  // --buttonSecondaryBackground
  await expect(row).toHaveCSS("background-color", "rgba(117, 131, 255, 0.2)");
});

test("549-7 an empty plan, and no categories selected", async ({ page, request }) => {
  const { id } = await newPlan(request, "empty");
  await openReport(page, id, "spending-breakdown");
  await expect(total(page)).toHaveText("$0.00");
  await expect(page.getByTestId("sb-centre-name")).toHaveText("Total Spending");
  // Source (empty Spending Breakdown, dark): the ring is #f8f6f2 and the metrics read $0.00 $0.00 n/a n/a.
  await expect(page.locator(".sb-empty-ring")).toHaveCSS("fill", "rgb(248, 246, 242)");
  await expect(
    page.getByText("Your spending breakdown will appear once you start recording your spending."),
  ).toBeVisible();
  await expect(page.getByTestId("sb-average-monthly")).toHaveText("$0.00");
  await expect(page.getByTestId("sb-average-daily")).toHaveText("$0.00");
  await expect(page.getByTestId("sb-most-frequent")).toHaveText("n/a");
  await expect(page.getByTestId("sb-largest")).toHaveText("n/a");
  await expect(page.getByText("No spending to show yet", { exact: true })).toBeVisible();
  await mouseClick(page, page.getByRole("button", { name: "All Categories", exact: true }));
  const pop = page.getByRole("dialog", { name: "Select Categories" });
  await mouseClick(page, pop.getByRole("button", { name: "Select None", exact: true }));
  await mouseClick(page, pop.getByRole("button", { name: "Done", exact: true }));
  await expect(page.getByText("No spending to show", { exact: true })).toBeVisible();
  await expect(page.getByText("Your spending breakdown will appear")).toHaveCount(0);
});

test("549-8 the ZIP export", async ({ page, request }) => {
  const { plan } = await seedSpendingExample(request);
  await openReport(page, plan.id, "spending-breakdown");
  await customFrom(page, "Nov 2026", "Jun 2026");
  await expect(total(page)).toHaveText("$950.74");
  await mouseClick(page, page.getByRole("button", { name: "Export", exact: true }));
  const dialog = page.getByRole("dialog", { name: "Export Report" });
  const download = page.waitForEvent("download");
  await mouseClick(page, dialog.getByRole("button", { name: "Export", exact: true }));
  const file = await download;
  expect(file.suggestedFilename()).toBe("budget-reflect-spending-breakdown-2026-11-15.zip");
  const path = test.info().outputPath("export.zip");
  await file.saveAs(path);
  // A standard reader: Python's zipfile (this box has no unzip).
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
    "budget-reflect-spending-breakdown-2026-11-15.csv",
    "budget-reflect-spending-breakdown-2026-11-15-transactions.csv",
  ]);
  const [summary, trans] = out.files.map((f) => Buffer.from(f[1], "base64").toString("utf8"));
  for (const t of [summary as string, trans as string]) {
    expect(t.startsWith("﻿")).toBe(true);
    expect(t).not.toContain("\r");
    expect(t.endsWith("\n")).toBe(false);
  }
  const lines = (summary as string).split("\n");
  expect(lines).toContain(
    '"D8 Group","D8 Food",0.00,-120.00,-80.50,-99.99,-130.00,-55.00,-80.92,-485.49',
  );
  expect(lines.at(-1)).toBe('"","Uncategorized",0.00,0.00,0.00,-15.00,0.00,0.00,-2.50,-15.00');
  expect(trans).toContain(
    '"D8 Checking","","10/01/2026","Transfer : D8 Car Loan","D8 Group: D8 Loan Pmt","D8 Group","D8 Loan Pmt","",$250.00,$0.00,"Uncleared"',
  );
  expect(trans).toContain('"Hidden Categories: D8 Hidden"');
});

test("549-9, 549-10 the split case, and no transfer between on-plan accounts", async ({
  page,
  request,
}) => {
  const { plan, ids } = await seedSplitPlan(request);
  await openReport(page, plan.id, "spending-breakdown");
  await expect(total(page)).toHaveText("$200.00");
  await expect
    .poll(() => listItems(page))
    .toEqual([
      { name: "S Food", amount: "$95.00", pct: "48%" },
      { name: "Uncategorized", amount: "$65.00", pct: "33%" },
      { name: "S Fun", amount: "$40.00", pct: "20%" },
    ]);
  await expect(page.getByTestId("sb-most-frequent")).toHaveText("S Food");
  await expect(page.getByTestId("sb-most-frequent-count")).toHaveText("3 transactions");
  await expect(page.getByTestId("sb-largest")).toHaveText("S Market");
  await expect(page.getByTestId("sb-largest-amount")).toHaveText("$60.00");
  const cells = (d: ReturnType<Page["getByRole"]>) =>
    d
      .locator("tbody tr")
      .evaluateAll((trs) => trs.map((r) => [...r.children].map((c) => c.textContent)));
  await realClick(page, listRow(page, "S Food"));
  const food = page.getByRole("dialog", { name: "S Food", exact: true });
  await expect(food.locator("tbody tr")).toHaveCount(3);
  expect(await cells(food)).toEqual([
    ["S Checking", "11/08/2026", "S Shop", "", "−$15.00"],
    ["S Checking", "11/06/2026", "S Shop", "line memo", "−$20.00"],
    ["S Checking", "11/04/2026", "S Market", "", "−$60.00"],
  ]);
  await realClick(page, food.getByRole("button", { name: "Close", exact: true }));
  await realClick(page, listRow(page, "Uncategorized"));
  const unc = page.getByRole("dialog", { name: "Uncategorized", exact: true });
  await expect(unc.locator("tbody tr")).toHaveCount(2);
  expect(await cells(unc)).toEqual([
    ["S Checking", "11/09/2026", "Transfer : S Loan", "", "−$55.00"],
    ["S Checking", "11/06/2026", "S Line Payee", "", "−$10.00"],
  ]);
  await realClick(page, unc.getByRole("button", { name: "Close", exact: true }));
  await clickSlice(page, "uncategorized");
  await expect(page.getByRole("dialog", { name: "Uncategorized", exact: true })).toBeVisible();
  // Nothing of the on-plan transfer or the split's parent is on the screen.
  // The -$200.00 transfer to S Savings is no row of the list nor of the popover.
  expect((await page.locator(".sb-row").allTextContents()).join(" ")).not.toContain("200.00");
  await expect(page.locator(".sb-popover tbody")).not.toContainText("200.00");
  await expect(page.locator(".reflect")).not.toContainText("S Savings");
  await expect(page.locator(".sb-popover tbody")).not.toContainText("100.00");
  expect(ids.sav).toBeTruthy();
});

test("548-11 the read of the drill-down: selectors, 404 and exclusions", async ({ request }) => {
  const { plan, ids } = await seedSpendingExample(request);
  const other = await seedSpendingExample(request);
  const h = await authHeaders();
  const get = (q: string) =>
    request.get(
      `/api/v1/budgets/${plan.id}/reports/transactions?start_month=2026-06-01&end_month=2026-11-01${q}`,
      { headers: h },
    );
  expect((await get("")).status()).toBe(422);
  expect((await get(`&category_id=${ids["D8 Food"]}&uncategorized=true`)).status()).toBe(422);
  expect((await get(`&category_id=${other.ids["D8 Food"]}`)).status()).toBe(404);
  const excluded = await get(`&category_id=${ids["D8 Food"]}&excluded_account_ids=${ids.chk}`);
  expect((await excluded.json()).data.transactions).toEqual([]);
  const food = await get(`&category_id=${ids["D8 Food"]}`);
  expect((await food.json()).data.transactions).toHaveLength(6);
});
