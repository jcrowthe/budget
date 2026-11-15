import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { fixtureF, fixtureF0, stub } from "./plan-grid.fixtures";
import { authHeaders, testName } from "./support/auth";

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const ISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;

type Req = import("@playwright/test").APIRequestContext;
let planId = "";

test.beforeEach(async ({ request }: { request: Req }) => {
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: testName("grid") },
  });
  planId = (await res.json()).data.budget.id;
});
test.afterEach(async ({ request }: { request: Req }) => {
  await request.delete(`/api/v1/budgets/${planId}`, { headers: await authHeaders() });
});

const open = async (page: Page, path = "budget") => {
  await page.goto(`/${planId}/${path}`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
};
const cats = (page: Page) => page.locator(".category-row:not(.uncategorized-row)");
const catRow = (page: Page, name: string) =>
  page.locator(".category-row", { has: page.getByText(name, { exact: true }) });
const groupRow = (page: Page, name: string) =>
  page.locator(".group-row", { has: page.getByText(name, { exact: true }) });
const css = (loc: import("@playwright/test").Locator, prop: string) =>
  loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const height = async (loc: import("@playwright/test").Locator) =>
  (await loc.boundingBox())?.height ?? 0;

test("default plan: three groups, eleven rows of zeros, grey disabled pills", async ({ page }) => {
  await open(page);
  await expect(page.locator(".group-row")).toHaveCount(3);
  await expect(cats(page)).toHaveCount(11);
  await expect(page.locator(".group-name")).toHaveText(["Bills", "Needs", "Wants"]);
  await expect(page.locator(".category-name").first()).toHaveText("🏠 Rent/Mortgage");
  const amounts = page.locator(".category-row .amount");
  await expect(amounts).toHaveCount(22);
  for (const a of await amounts.all()) {
    await expect(a).toHaveText("$0.00");
    expect(await css(a, "color")).toBe("rgb(196, 197, 207)");
  }
  const pills = page.locator(".available-pill");
  await expect(pills).toHaveCount(11);
  for (const p of await pills.all()) {
    await expect(p).toBeDisabled();
    await expect(p).toHaveText("$0.00");
    expect(await css(p, "background-color")).toBe("rgb(60, 62, 83)");
    expect(await css(p, "color")).toBe("rgb(155, 156, 170)");
  }
  await expect(page.locator(".status-label")).toHaveCount(0);
  await expect(page.locator(".progress-segment")).toHaveCount(0);
  await expect(page.locator(".progress-track")).toHaveCount(11);
});

test("geometry matches the source", async ({ page }) => {
  await open(page);
  const near = (n: number, want: number) => expect(Math.abs(n - want)).toBeLessThanOrEqual(1);
  // Measured on the source's Plan page (computed styles, 1600x813): toolbar 48, header 40, group 40, category 44.
  near(await height(page.locator(".grid-toolbar")), 48);
  near(await height(page.locator(".header-row")), 40);
  near(await height(page.locator(".group-row").first()), 40);
  near(await height(cats(page).first()), 44);
  const g = groupRow(page, "Bills");
  expect(await css(g, "background-color")).toBe("rgb(21, 23, 45)");
  expect(await css(g.locator(".group-name"), "font-size")).toBe("16px");
  expect(await css(g.locator(".group-name"), "font-weight")).toBe("600");
  const pill = page.locator(".available-pill").first();
  expect(await css(pill, "border-top-left-radius")).toBe("1000px");
  expect(await css(pill, "font-size")).toBe("14px");
  expect(await css(pill, "font-weight")).toBe("500");
  await expect(page.locator(".toolbar-button")).toHaveText([
    "Category Group",
    "Undo",
    "Redo",
    "Recent Moves",
  ]);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Redo" })).toBeDisabled();
  await expect(page.getByRole("tab", { name: "Progress Bars On" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const grid = (await page.locator(".plan-grid").boundingBox())?.width ?? 0;
  const panel = await page.locator(".plan-inspector").boundingBox();
  near(panel?.width ?? 0, 442);
  expect(grid).toBeGreaterThan(562);
  await expect(page.locator(".plan-inspector")).toBeEmpty();
});

test("values, labels and pill colours", async ({ page }) => {
  await stub(page, fixtureF(ISO));
  await open(page);
  const rent = catRow(page, "Rent");
  await expect(rent.locator(".amount")).toHaveText(["$230.00", "−$60.00"]);
  await expect(rent.locator(".status-label")).toHaveText("Spent $60.00 of $230.00");
  const rp = rent.locator(".available-pill");
  await expect(rp).toHaveText("$170.00");
  expect(await css(rp, "background-color")).toBe("rgb(119, 186, 33)");
  expect(await css(rp, "color")).toBe("rgb(12, 13, 34)");
  expect(await rp.getAttribute("title")).toMatch(/^\$170\.00 Available to plan your spending/);

  const phone = catRow(page, "Phone");
  await expect(phone.locator(".status-label")).toHaveText("Overspent. $50.00 of $0.00");
  const pp = phone.locator(".available-pill");
  await expect(pp).toHaveText("−$50.00");
  expect(await css(pp, "background-color")).toBe("rgb(191, 46, 59)");
  expect(await css(pp, "color")).toBe("rgb(255, 255, 255)");
  await expect(phone.locator(".progress-segment")).toHaveAttribute("data-kind", "overspent");
  expect(await phone.locator(".progress-segment").evaluate((e) => e.style.width)).toBe("100%");

  const util = catRow(page, "Utilities");
  await expect(util.locator(".status-label")).toHaveText("Fully Spent");
  await expect(util.locator(".available-pill")).toBeDisabled();
  await expect(catRow(page, "Groceries").locator(".status-label")).toHaveText(
    "Spent $30.00 of $125.00",
  );
  const em = catRow(page, "Emergency fund");
  await expect(em.locator(".status-label")).toHaveCount(0);
  await expect(em.locator(".progress-segment")).toHaveCount(0);
  await expect(em.locator(".available-pill")).toBeDisabled();
  expect(await css(em.locator(".available-pill"), "background-color")).toBe("rgb(60, 62, 83)");
});

test("subtotals are plain text and hidden rows are left out", async ({ page }) => {
  await stub(page, fixtureF(ISO));
  await open(page);
  const bills = groupRow(page, "Bills");
  await expect(bills.locator(".num")).toHaveText(["$270.00", "−$150.00", "$120.00"]);
  await expect(bills.locator(".available-pill")).toHaveCount(0);
  await expect(groupRow(page, "Needs").locator(".num")).toHaveText([
    "$100.00",
    "−$30.00",
    "$95.00",
  ]);
  await expect(page.getByText("Secret stash")).toHaveCount(0);
  await expect(page.getByText("Old stuff")).toHaveCount(0);
  await expect(page.locator(".grid-error")).toHaveCount(0);
});

test("Uncategorized Transactions appears only with uncategorized activity", async ({ page }) => {
  await stub(page, fixtureF(ISO));
  await open(page);
  const u = page.locator(".uncategorized-row");
  await expect(u).toHaveCount(1);
  await expect(page.locator(".grid-body .grid-row").first()).toHaveClass(/uncategorized-row/);
  expect(await css(u.locator(".category-name"), "color")).toBe("rgb(218, 172, 0)");
  await expect(u.locator(".amount")).toHaveText(["-", "−$12.34"]);
  await expect(u.locator(".available-pill")).toHaveText("−$12.34");
  await expect(u.locator(".available-pill")).toBeDisabled();
  await page.unroute("**/api/v1/budgets/*/months/*");
  await stub(page, fixtureF0(ISO));
  await page.reload();
  await expect(page.locator(".group-row")).toHaveCount(2);
  await expect(page.locator(".uncategorized-row")).toHaveCount(0);
});

test("collapse: one group, all, shortcuts, and it survives a reload", async ({ page }) => {
  await stub(page, fixtureF(ISO));
  await open(page);
  await page.getByRole("button", { name: "Collapse Bills categories" }).click();
  await expect(cats(page)).toHaveCount(2);
  await expect(groupRow(page, "Bills").locator(".num")).toHaveText([
    "$270.00",
    "−$150.00",
    "$120.00",
  ]);
  await expect(page.getByRole("button", { name: "Expand Bills categories" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand Bills categories" })).toBeVisible();
  await expect(cats(page)).toHaveCount(2);

  await page.getByRole("button", { name: "Expand Bills categories" }).click();
  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(cats(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Expand all" })).toBeVisible();
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(cats(page)).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Collapse all" })).toBeVisible();

  await page.keyboard.press("Control+ArrowUp");
  await expect(cats(page)).toHaveCount(0);
  await page.keyboard.press("Control+ArrowDown");
  await expect(cats(page)).toHaveCount(5);
});

test("progress bars off: compact rows, no bars or labels, and it survives a reload", async ({
  page,
}) => {
  await stub(page, fixtureF(ISO));
  await open(page);
  const grid = page.locator(".plan-grid");
  const row = catRow(page, "Rent");
  expect(await height(row)).toBeCloseTo(44, 0);
  await page.getByRole("tab", { name: "Progress Bars Off" }).click();
  await expect(page.locator(".progress-bar")).toHaveCount(0);
  await expect(page.locator(".status-label")).toHaveCount(0);
  expect(await height(row)).toBeCloseTo(36, 0);
  expect(await css(row.locator(".category-name"), "font-size")).toBe("14px");
  const w = (await grid.boundingBox())?.width ?? 0;
  const nw = (await row.locator(".cell-activity").boundingBox())?.width ?? 0;
  expect(Math.abs(nw - w * 0.18)).toBeLessThan(2);
  await expect(page.getByRole("tab", { name: "Progress Bars Off" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.reload();
  await expect(page.locator(".progress-bar")).toHaveCount(0);
  await page.getByRole("tab", { name: "Progress Bars On" }).click();
  expect(await height(catRow(page, "Rent"))).toBeCloseTo(44, 0);
  await expect(page.locator(".progress-bar").first()).toBeVisible();
});

test("states: error with retry, no groups, loading", async ({ page }) => {
  await stub(page, { error: { id: "500", name: "error", detail: "x" } }, 500);
  await open(page);
  await expect(page.getByRole("alert")).toContainText("Couldn't load this month.");
  await expect(page.locator(".grid-toolbar")).toBeVisible();
  await expect(page.locator(".header-row")).toBeVisible();
  await page.unroute("**/api/v1/budgets/*/months/*");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".group-row")).toHaveCount(3);

  await page.unroute("**/api/v1/budgets/*/months/*");
  const empty = fixtureF(ISO);
  empty.data.groups = [];
  empty.data.uncategorized = null;
  await stub(page, empty);
  await page.reload();
  await expect(page.locator(".grid-toolbar")).toBeVisible();
  await expect(page.locator(".grid-row.group-row")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.unroute("**/api/v1/budgets/*/months/*");
  await stub(page, fixtureF(ISO), 200, 1500);
  await page.reload();
  await expect(page.locator(".grid-toolbar")).toBeVisible();
  await expect(page.getByRole("treegrid", { name: "Plan" })).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".group-row")).toHaveCount(2);
});

test("the month in the URL drives the request", async ({ page }) => {
  const other = `${now.getFullYear() + 1}03`;
  let req = page.waitForRequest(/\/months\/\d{4}-\d{2}-01$/);
  await page.goto(`/${planId}/budget/${other}`);
  expect((await req).url()).toMatch(new RegExp(`/months/${other.slice(0, 4)}-03-01$`));
  req = page.waitForRequest(/\/months\/\d{4}-\d{2}-01$/);
  await page.goto(`/${planId}/budget`);
  expect((await req).url()).toMatch(new RegExp(`/months/${ISO}$`));
});

test("the grid never shows the source app's name", async ({ page }) => {
  await stub(page, fixtureF(ISO));
  await open(page);
  await expect(page.locator(".plan-grid")).not.toContainText(/ynab/i);
});
