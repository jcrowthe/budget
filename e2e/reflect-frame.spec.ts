import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { mouseClick } from "./support/menu";
import { addAccount, dateButton, NOW, newPlan, openReport, seedExample } from "./support/reflect";

const VIEWPORTS = [
  { width: 1600, height: 900 },
  { width: 1024, height: 700 },
];

const menuItem = (page: Page, name: string) =>
  page.getByRole("menuitemradio", { name, exact: true });
async function chooseRange(page: Page, from: string, item: string) {
  await mouseClick(page, dateButton(page, from));
  await mouseClick(page, menuItem(page, item));
}
async function pickCustom(page: Page, from: string, start: string, end: string) {
  await mouseClick(page, dateButton(page, from));
  await mouseClick(page, menuItem(page, "Custom"));
  await mouseClick(page, page.getByRole("button", { name: "Start Date", exact: true }));
  await mouseClick(page, page.getByRole("button", { name: start, exact: true }));
  await mouseClick(page, page.getByRole("button", { name: "End Date", exact: true }));
  await mouseClick(page, page.getByRole("button", { name: end, exact: true }));
  await mouseClick(page, page.getByRole("button", { name: "Apply", exact: true }));
}
const prev = (page: Page) => page.getByRole("button", { name: "Previous Period", exact: true });
const next = (page: Page) => page.getByRole("button", { name: "Next Period", exact: true });

test("548-1 five tabs, active underline, headings", async ({ page, request }) => {
  const { id, name } = await newPlan(request);
  await openReport(page, id, "net-worth");
  const tabs = page.getByRole("navigation", { name: "Reports" }).getByRole("link");
  await expect(tabs).toHaveText([
    "Spending Breakdown",
    "Spending Trends",
    "Net Worth",
    "Income v Expense",
    "Age of Money",
  ]);
  await expect(page.getByRole("link", { name: "Net Worth", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page).toHaveTitle(`Net Worth Report | ${name} | Budget`);
  const slugs = [
    "spending-breakdown",
    "spending-trends",
    "net-worth",
    "income-expense",
    "age-of-money",
  ];
  const labels = [
    "Spending Breakdown",
    "Spending Trends",
    "Net Worth",
    "Income v Expense",
    "Age of Money",
  ];
  for (const [i, label] of labels.entries()) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(`/${id}/reflect/${slugs[i]}`);
    await expect(page.getByRole("heading", { level: 1, name: label, exact: true })).toBeVisible();
    const link = page
      .getByRole("navigation", { name: "Reports" })
      .getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("aria-current", "page");
    // The 4px underline in the primary action colour (EXF-548 capture 16).
    await expect(link).toHaveCSS("border-bottom-width", "4px");
  }
  // Age of Money: heading only, no filters, no Export.
  await expect(page.getByRole("button", { name: "Export", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Previous Period", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "All Accounts", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Understanding Age of Money", exact: true }),
  ).toBeVisible();
  // Income v Expense is built (a table with AVERAGE and TOTAL, Export on); Net Worth has no category filter.
  await page.getByRole("link", { name: "Income v Expense", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "AVERAGE", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "All Categories", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Net Worth", exact: true }).click();
  await expect(page.getByRole("button", { name: "All Categories", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "All Accounts", exact: true })).toBeVisible();
});

for (const vp of VIEWPORTS) {
  test.describe(`at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test("548-2 presets and clamping", async ({ page, request }) => {
      const { id } = await newPlan(request);
      await addAccount(request, id, "D8 Savings", "savings", 500000, "2026-05-15");
      await openReport(page, id, "net-worth");
      await expect(dateButton(page, "May 2026 – Nov 2026")).toBeVisible();
      await chooseRange(page, "May 2026 – Nov 2026", "Last 3 Months");
      await expect(dateButton(page, "Sep 2026 – Nov 2026")).toBeVisible();
      await chooseRange(page, "Sep 2026 – Nov 2026", "This Month");
      await expect(dateButton(page, "Nov 2026")).toBeVisible();
      await mouseClick(page, dateButton(page, "Nov 2026"));
      await expect(menuItem(page, "This Month")).toHaveAttribute("aria-checked", "true");
      await mouseClick(page, menuItem(page, "Last Year"));
      await expect(dateButton(page, "May 2026")).toBeVisible();
      await chooseRange(page, "May 2026", "All Dates");
      await expect(dateButton(page, "May 2026 – Nov 2026")).toBeVisible();
    });

    test("548-3 arrows and their disabled states", async ({ page, request }) => {
      const { id } = await newPlan(request);
      await addAccount(request, id, "D8 Checking", "checking", 2000000, "2026-06-01");
      await openReport(page, id, "net-worth");
      await expect(prev(page)).toBeDisabled();
      await expect(next(page)).toBeDisabled();
      await pickCustom(page, "Jun 2026 – Nov 2026", "Sep 2026", "Oct 2026");
      await expect(dateButton(page, "Sep 2026 – Oct 2026")).toBeVisible();
      await expect(prev(page)).toBeEnabled();
      await expect(next(page)).toBeDisabled();
      await mouseClick(page, prev(page));
      await expect(dateButton(page, "Jul 2026 – Aug 2026")).toBeVisible();
      await mouseClick(page, dateButton(page, "Jul 2026 – Aug 2026"));
      await expect(menuItem(page, "Custom")).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Escape");
      await expect(prev(page)).toBeDisabled();
      await expect(next(page)).toBeEnabled();
      await chooseRange(page, "Jul 2026 – Aug 2026", "Last 3 Months");
      await expect(next(page)).toBeDisabled();
      await expect(prev(page)).toBeEnabled();
      await chooseRange(page, "Sep 2026 – Nov 2026", "This Month");
      // Wait for the new range before shifting it (the arrow shifts whatever range is shown).
      await expect(dateButton(page, "Nov 2026")).toBeVisible();
      await mouseClick(page, prev(page));
      await expect(dateButton(page, "Oct 2026")).toBeVisible();
    });

    test("548-4 month grid and Apply / Cancel", async ({ page, request }) => {
      const { id } = await newPlan(request);
      await addAccount(request, id, "D8 Checking", "checking", 2000000, "2026-06-01");
      await openReport(page, id, "net-worth");
      await mouseClick(page, dateButton(page, "Jun 2026 – Nov 2026"));
      await mouseClick(page, menuItem(page, "Custom"));
      await mouseClick(page, page.getByRole("button", { name: "Start Date", exact: true }));
      const m = (n: string, y = 2026) =>
        page.getByRole("button", { name: `${n} ${y}`, exact: true });
      for (const n of ["Jan", "Feb", "Mar", "Apr", "May", "Dec"]) await expect(m(n)).toBeDisabled();
      for (const n of ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"]) await expect(m(n)).toBeEnabled();
      await mouseClick(page, page.getByRole("button", { name: "Previous Year", exact: true }));
      for (const n of ["Jan", "Jun", "Nov", "Dec"]) await expect(m(n, 2025)).toBeDisabled();
      await mouseClick(page, page.getByRole("button", { name: "Next Year", exact: true }));
      await mouseClick(page, m("Jul"));
      await mouseClick(page, page.getByRole("button", { name: "End Date", exact: true }));
      await mouseClick(page, m("Sep"));
      await mouseClick(page, page.getByRole("button", { name: "Apply", exact: true }));
      await expect(dateButton(page, "Jul 2026 – Sep 2026")).toBeVisible();
      // Cancel leaves the label as it was.
      await mouseClick(page, dateButton(page, "Jul 2026 – Sep 2026"));
      await mouseClick(page, menuItem(page, "Custom"));
      await mouseClick(page, page.getByRole("button", { name: "Start Date", exact: true }));
      await mouseClick(page, m("Aug"));
      await mouseClick(page, page.getByRole("button", { name: "Cancel", exact: true }));
      await expect(dateButton(page, "Jul 2026 – Sep 2026")).toBeVisible();
    });

    test("548-5 category filter", async ({ page, request }) => {
      const { id } = await newPlan(request);
      const h = await authHeaders();
      const g = (
        await (
          await request.post(`/api/v1/budgets/${id}/category_groups`, {
            headers: h,
            data: { name: "ZZ-TEST G" },
          })
        ).json()
      ).data.category_group.id;
      for (const n of ["Gifts", "Food", "Fun Money"]) {
        const c = await request.post(`/api/v1/budgets/${id}/categories`, {
          headers: h,
          data: { group_id: g, name: n },
        });
        if (n === "Gifts") {
          const cid = (await c.json()).data.category.id;
          await request.patch(`/api/v1/budgets/${id}/categories/${cid}`, {
            headers: h,
            data: { hidden: true },
          });
        }
      }
      await openReport(page, id, "spending-breakdown");
      await mouseClick(page, page.getByRole("button", { name: "All Categories", exact: true }));
      const pop = page.getByRole("dialog", { name: "Select Categories" });
      await expect(pop).toBeVisible();
      await expect(pop.locator(".filter-row").first()).toHaveText("Uncategorized Transactions");
      const group = pop.getByRole("checkbox", { name: "ZZ-TEST G", exact: true });
      const fun = pop.getByRole("checkbox", { name: "Fun Money", exact: true });
      const gifts = pop.locator(".filter-row", { hasText: "Gifts" });
      await expect(gifts).toContainText("Hidden");
      await expect(gifts.locator("svg")).toHaveCount(1);
      await expect(pop.locator(".filter-row", { hasText: "Fun Money" })).not.toContainText(
        "Hidden",
      );
      await expect(group).toBeChecked();
      await mouseClick(page, group);
      await expect(group).not.toBeChecked();
      await expect(fun).not.toBeChecked();
      await mouseClick(page, group);
      await expect(fun).toBeChecked();
      await pop.getByRole("searchbox", { name: "Search All Categories" }).fill("fun");
      await expect(pop.getByText("ZZ-TEST G", { exact: true })).toBeVisible();
      await expect(pop.getByText("Fun Money", { exact: true })).toBeVisible();
      await expect(pop.getByText("Food", { exact: true })).toHaveCount(0);
      await expect(pop.getByText("Uncategorized Transactions", { exact: true })).toHaveCount(0);
      await pop.getByRole("searchbox", { name: "Search All Categories" }).fill("");
      await mouseClick(page, pop.getByRole("button", { name: "Select None", exact: true }));
      await mouseClick(page, pop.getByRole("button", { name: "Done", exact: true }));
      await expect(
        page.getByRole("button", { name: "No Categories Selected", exact: true }),
      ).toBeVisible();
      await expect(pop).toHaveCount(0);
    });

    test("548-6 account filter sections", async ({ page, request }) => {
      const { id } = await newPlan(request);
      await addAccount(request, id, "D8 Checking", "checking", 100000, "2026-06-01");
      await addAccount(request, id, "D8 Credit", "creditCard", 50000, "2026-06-01");
      await addAccount(request, id, "D8 House", "otherAsset", 900000, "2026-06-01");
      await addAccount(request, id, "D8 Loan", "otherLiability", 700000, "2026-06-01");
      await addAccount(request, id, "D8 Old", "savings", 10000, "2026-06-01");
      // No route closes an account or creates a loan yet: the read says one on-plan account is closed
      // and the liability is a loan.
      await page.route(/\/api\/v1\/budgets\/[^/]+\/accounts(\?.*)?$/, async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        const res = await route.fetch();
        const body = await res.json();
        for (const a of body.data.accounts) {
          if (a.name === "D8 Old") Object.assign(a, { closed: true, group: "closed" });
          if (a.name === "D8 Loan") a.group = "loans";
        }
        return route.fulfill({ response: res, json: body });
      });
      await openReport(page, id, "spending-breakdown");
      await mouseClick(page, page.getByRole("button", { name: "All Accounts", exact: true }));
      let pop = page.getByRole("dialog", { name: "Select Accounts" });
      await expect(pop.locator(".filter-row.group")).toHaveText([
        "Cash Accounts",
        "Credit Accounts",
        "Closed Accounts",
      ]);
      await mouseClick(page, pop.getByRole("button", { name: "Cancel", exact: true }));
      await page.getByRole("link", { name: "Net Worth", exact: true }).click();
      await expect(page.getByRole("button", { name: "All Accounts", exact: true })).toBeVisible();
      await mouseClick(page, page.getByRole("button", { name: "All Accounts", exact: true }));
      pop = page.getByRole("dialog", { name: "Select Accounts" });
      await expect(pop.locator(".filter-row.group")).toHaveText([
        "Cash Accounts",
        "Credit Accounts",
        "Tracking Accounts",
        "Closed Accounts",
      ]);
      const house = pop.getByRole("checkbox", { name: "D8 House", exact: true });
      const loan = pop.getByRole("checkbox", { name: "D8 Loan", exact: true });
      const tracking = pop.getByRole("checkbox", { name: "Tracking Accounts", exact: true });
      await expect(house).toBeVisible();
      await expect(loan).toBeVisible();
      await mouseClick(page, tracking);
      await expect(house).not.toBeChecked();
      await expect(loan).not.toBeChecked();
      await mouseClick(page, tracking);
      await expect(loan).toBeChecked();
      await mouseClick(page, house);
      await mouseClick(page, pop.getByRole("button", { name: "Done", exact: true }));
      await expect(
        page.getByRole("button", { name: "4 Selected Accounts", exact: true }),
      ).toBeVisible();
      await mouseClick(
        page,
        page.getByRole("button", { name: "4 Selected Accounts", exact: true }),
      );
      await expect(
        page
          .getByRole("dialog", { name: "Select Accounts" })
          .getByRole("checkbox", { name: "D8 House", exact: true }),
      ).not.toBeChecked();
    });

    test("548-8 export dialog", async ({ page, request }) => {
      const { id } = await newPlan(request);
      await addAccount(request, id, "D8 Checking", "checking", 2000000, "2026-06-01");
      await openReport(page, id, "net-worth");
      let downloads = 0;
      page.on("download", () => {
        downloads += 1;
      });
      const exportBtn = page.getByRole("button", { name: "Export", exact: true });
      const dialog = page.getByRole("dialog", { name: "Export Report" });
      await mouseClick(page, exportBtn);
      await expect(dialog.getByRole("heading", { name: "Export Report" })).toBeVisible();
      await expect(dialog).toContainText(
        "Your data is just that—yours! All the requested data will be exported in CSV format so it's easy to open in other applications.",
      );
      await expect(dialog.getByRole("checkbox", { name: "Don't show again" })).not.toBeChecked();
      await mouseClick(page, dialog.getByRole("button", { name: "Cancel", exact: true }));
      await expect(dialog).toHaveCount(0);
      await page.waitForTimeout(1000);
      expect(downloads).toBe(0);
      await mouseClick(page, exportBtn);
      const first = page.waitForEvent("download");
      await mouseClick(page, dialog.getByRole("button", { name: "Export", exact: true }));
      expect((await first).suggestedFilename()).toBe("budget-reflect-net-worth-2026-11-15.csv");
      await expect(dialog).toHaveCount(0);
      // Still asks: nothing was ticked.
      await mouseClick(page, exportBtn);
      await mouseClick(page, dialog.getByRole("checkbox", { name: "Don't show again" }));
      const second = page.waitForEvent("download");
      const saved = page.waitForResponse(
        (r) => r.url().includes("/report-settings/") && r.request().method() === "PUT",
      );
      await mouseClick(page, dialog.getByRole("button", { name: "Export", exact: true }));
      await second;
      await saved;
      await page.reload();
      await expect(exportBtn).toBeEnabled();
      const third = page.waitForEvent("download");
      await mouseClick(page, exportBtn);
      await third;
      await expect(dialog).toHaveCount(0);
      await page.getByRole("link", { name: "Spending Trends", exact: true }).click();
      await expect(exportBtn).toBeEnabled();
    });
  });
}

test("548-7 settings persist per report across navigation and reload", async ({
  page,
  request,
}) => {
  const { id } = await newPlan(request);
  await addAccount(request, id, "D8 Checking", "checking", 2000000, "2026-06-01");
  await openReport(page, id, "spending-breakdown");
  await chooseRange(page, "Nov 2026", "Last 6 Months");
  await expect(dateButton(page, "Jun 2026 – Nov 2026")).toBeVisible();
  await mouseClick(page, page.getByRole("button", { name: "All Categories", exact: true }));
  const pop = page.getByRole("dialog", { name: "Select Categories" });
  const boxes = pop.locator(".filter-row.child input");
  await mouseClick(page, boxes.first());
  await mouseClick(page, pop.getByRole("button", { name: "Done", exact: true }));
  const countButton = page.getByRole("button", { name: /^\d+ Selected Categories$/ });
  const label = (await countButton.getAttribute("aria-label")) ?? "";
  const n = Number(label.split(" ")[0]);
  expect(n).toBeGreaterThan(0);

  await page.getByRole("link", { name: "Spending Trends", exact: true }).click();
  await expect(dateButton(page, "Sep 2026 – Nov 2026")).toBeVisible();
  await expect(page.getByRole("button", { name: "All Categories", exact: true })).toBeVisible();

  await page.clock.setFixedTime(NOW);
  await page.goto(`/${id}/budget`);
  await page.goto(`/${id}/reflect/spending-breakdown`);
  await expect(dateButton(page, "Jun 2026 – Nov 2026")).toBeVisible();
  await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  await page.reload();
  await expect(dateButton(page, "Jun 2026 – Nov 2026")).toBeVisible();
  await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();

  // A category created later is included by default.
  const h = await authHeaders();
  const g = (
    await (
      await request.post(`/api/v1/budgets/${id}/category_groups`, {
        headers: h,
        data: { name: "ZZ-TEST later" },
      })
    ).json()
  ).data.category_group.id;
  await request.post(`/api/v1/budgets/${id}/categories`, {
    headers: h,
    data: { group_id: g, name: "Later" },
  });
  await page.reload();
  // The new group and its category are two more listed items; the group has no row of its own.
  await expect(
    page.getByRole("button", { name: `${n + 1} Selected Categories`, exact: true }),
  ).toBeVisible();
});

test("548-7 the sidebar Reflect link opens the last visited tab", async ({ page, request }) => {
  const { id } = await newPlan(request);
  await page.clock.setFixedTime(NOW);
  await page.goto(`/${id}/reflect`);
  await expect(page).toHaveURL(`/${id}/reflect/spending-breakdown`);
  await page.getByRole("link", { name: "Net Worth", exact: true }).click();
  await expect(page).toHaveURL(`/${id}/reflect/net-worth`);
  const sidebar = page.getByRole("navigation", { name: "Sidebar" });
  await sidebar.getByRole("link", { name: "Plan", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${id}/budget`));
  await sidebar.getByRole("link", { name: "Reflect" }).click();
  await expect(page).toHaveURL(`/${id}/reflect/net-worth`);
  await page.goto(`/${id}/reflect`);
  await expect(page).toHaveURL(`/${id}/reflect/net-worth`);
  const other = await newPlan(request, "fresh");
  await page.goto(`/${other.id}/reflect`);
  await expect(page).toHaveURL(`/${other.id}/reflect/spending-breakdown`);
});

test.describe("a browser ahead of UTC", () => {
  test.use({ timezoneId: "Pacific/Auckland" });
  test("551-9 This Month is the browser's month", async ({ page, request }) => {
    const { id } = await newPlan(request);
    await addAccount(request, id, "D8 Checking", "checking", 2000000, "2026-06-01");
    await page.clock.setFixedTime(new Date("2026-11-30T19:00:00Z"));
    const sent = page.waitForRequest(
      (r) => r.url().includes("/reports/range") && r.url().includes("today=2026-12-01"),
    );
    await page.goto(`/${id}/reflect/net-worth`);
    await sent;
    await chooseRange(page, "Jun 2026 – Dec 2026", "This Month");
    await expect(dateButton(page, "Dec 2026")).toBeVisible();
  });
});
