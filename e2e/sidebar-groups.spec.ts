import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

async function newPlan(request: APIRequestContext) {
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: testName("sidebar") },
  });
  return (await res.json()).data.budget.id as string;
}
async function addAccount(
  request: APIRequestContext,
  id: string,
  name: string,
  type: string,
  balance: number,
) {
  const res = await request.post(`/api/v1/budgets/${id}/accounts`, {
    headers: await authHeaders(),
    data: { name, type, balance },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).data.account.id as string;
}

const RED = "rgb(238, 88, 103)";
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Sidebar" });
const headers = (page: Page) => sidebar(page).locator(".nav-account-block .label");
const group = (page: Page, name: string) => sidebar(page).locator(`[data-group=${name}]`);
const headerValue = (page: Page, name: string) =>
  group(page, name).locator(".nav-account-block .value");

let seq = 0;
function fx(p: Record<string, unknown>) {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    budget_id: "00000000-0000-4000-8000-000000000000",
    name: `ZZ-TEST ${seq}`,
    type: "checking",
    on_budget: true,
    note: null,
    starred: false,
    closed: false,
    group: "cash",
    sort: seq,
    created_at: "2026-01-01T00:00:00.000Z",
    cleared_balance: 0,
    uncleared_balance: 0,
    balance: 0,
    bank_account_id: null,
    linked: false,
    import_start_date: null,
    last_reconciled_at: null,
    can_delete: false,
    ...p,
  };
}
async function stubAccounts(page: Page, accounts: unknown[]) {
  await page.route("**/api/v1/budgets/*/accounts*", (route) => {
    if (route.request().method() !== "GET" || /accounts\/[^/?]+/.test(route.request().url())) {
      return route.continue();
    }
    return route.fulfill({ json: { data: { accounts } } });
  });
}

test("real accounts: groups, totals and colours", async ({ page, request }) => {
  const id = await newPlan(request);
  await addAccount(request, id, "ZZ-TEST Check", "checking", 250000);
  await page.goto(`/${id}/budget`);
  await expect(headers(page)).toHaveText(["CASH"]);
  await expect(headerValue(page, "cash")).toHaveText("$250.00");
  await expect(group(page, "cash").locator(".nav-account-row")).toHaveCount(1);

  await addAccount(request, id, "ZZ-TEST Card", "creditCard", 150000);
  await addAccount(request, id, "ZZ-TEST Asset", "otherAsset", 5000000);
  await addAccount(request, id, "ZZ-TEST Liab", "otherLiability", 700000);
  await addAccount(request, id, "ZZ-TEST Zero", "savings", 0);
  await page.reload();
  await expect(headers(page)).toHaveText(["CASH", "CREDIT", "TRACKING"]);
  await expect(headerValue(page, "credit")).toHaveText("−$150.00");
  await expect(headerValue(page, "tracking")).toHaveText("$4,300.00");
  const card = group(page, "credit").locator(".nav-account-row .value");
  await expect(card).toHaveText("−$150.00");
  await expect(card).toHaveCSS("color", RED);
  // Zero and positive rows are white (rgb(255, 255, 255)), not red.
  for (const name of ["ZZ-TEST Check", "ZZ-TEST Zero"]) {
    await expect(
      group(page, "cash").locator(".nav-account-row", { hasText: name }).locator(".value"),
    ).toHaveCSS("color", "rgb(255, 255, 255)");
  }
});

test("collapse is saved and survives a reload", async ({ page, request }) => {
  const id = await newPlan(request);
  await addAccount(request, id, "ZZ-TEST Check", "checking", 250000);
  await addAccount(request, id, "ZZ-TEST Card", "creditCard", 150000);
  await page.goto(`/${id}/budget`);
  const saved = page.waitForResponse(
    (r) => r.url().includes("/ui-state") && r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "collapse CREDIT", exact: true }).click();
  await expect(group(page, "credit").locator(".nav-account-row")).toHaveCount(0);
  await expect(headerValue(page, "credit")).toHaveText("−$150.00");
  await expect(page.getByRole("button", { name: "open CREDIT", exact: true })).toBeVisible();
  await saved;
  await page.reload();
  await expect(page.getByRole("button", { name: "open CREDIT", exact: true })).toBeVisible();
  const res = await request.get(`/api/v1/budgets/${id}/ui-state`, { headers: await authHeaders() });
  expect((await res.json()).data.ui_state.collapsed_account_groups).toEqual(["credit"]);
  const saved2 = page.waitForResponse(
    (r) => r.url().includes("/ui-state") && r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "open CREDIT", exact: true }).click();
  await saved2;
  await page.reload();
  await expect(page.getByRole("button", { name: "collapse CREDIT", exact: true })).toBeVisible();
  await expect(group(page, "credit").locator(".nav-account-row")).toHaveCount(1);
});

test("a failed save keeps the screen state, silently", async ({ page, request }) => {
  const id = await newPlan(request);
  await addAccount(request, id, "ZZ-TEST Check", "checking", 250000);
  await page.route("**/ui-state", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 500, body: "" })
      : route.continue(),
  );
  await page.goto(`/${id}/budget`);
  await page.getByRole("button", { name: "collapse CASH", exact: true }).click();
  await expect(page.getByRole("button", { name: "open CASH", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("fixture: starred, loans and closed", async ({ page, request }) => {
  const id = await newPlan(request);
  await stubAccounts(page, [
    fx({ name: "ZZ-TEST Star", starred: true, balance: 312500 }),
    fx({ name: "ZZ-TEST Card", type: "creditCard", group: "credit", balance: -150000 }),
    fx({ name: "ZZ-TEST Card 2", type: "creditCard", group: "credit", balance: -75000 }),
    fx({ name: "ZZ-TEST Loan", type: "mortgage", group: "loans", balance: -100000000 }),
    fx({ name: "ZZ-TEST Asset", type: "otherAsset", group: "tracking", balance: 5000000 }),
    fx({ name: "ZZ-TEST Liab", type: "otherLiability", group: "tracking", balance: -700000 }),
    fx({ name: "ZZ-TEST Zeta", closed: true, group: "closed", balance: 1000 }),
    fx({ name: "ZZ-TEST Alpha", closed: true, group: "closed", balance: 2000 }),
  ]);
  await page.goto(`/${id}/budget`);
  await expect(headers(page)).toHaveText([
    "STARRED",
    "CASH",
    "CREDIT",
    "LOANS",
    "TRACKING",
    "CLOSED",
  ]);
  await expect(headerValue(page, "starred")).toHaveText("$312.50");
  await expect(headerValue(page, "cash")).toHaveText("$312.50");
  await expect(headerValue(page, "credit")).toHaveText("−$225.00");
  await expect(headerValue(page, "loans")).toHaveText("−$100,000.00");
  await expect(headerValue(page, "loans")).not.toHaveCSS("color", RED);
  await expect(headerValue(page, "tracking")).toHaveText("$4,300.00");
  await expect(headerValue(page, "closed")).toHaveCount(0);
  await expect(
    sidebar(page).locator(".nav-account-row .name", { hasText: "ZZ-TEST Star" }),
  ).toHaveCount(2);
  await expect(group(page, "closed").locator(".name")).toHaveText([
    "ZZ-TEST Alpha",
    "ZZ-TEST Zeta",
  ]);
});

test("pencil shows on hover and opens Edit Account", async ({ page, request }) => {
  const id = await newPlan(request);
  await addAccount(request, id, "ZZ-TEST Check", "checking", 250000);
  await page.goto(`/${id}/budget`);
  const row = sidebar(page).locator(".nav-account-row");
  const pencil = row.getByRole("button", { name: "Edit Account" });
  await expect(pencil).toHaveCSS("opacity", "0");
  await row.hover();
  await expect(pencil).not.toHaveCSS("opacity", "0");
  await expect(pencil).toHaveAttribute("title", "Edit Account");
  const url = page.url();
  await pencil.click();
  expect(page.url()).toBe(url);
  await expect(page.getByRole("dialog", { name: "Edit Account", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("long names truncate with the full name in the title", async ({ page, request }) => {
  const id = await newPlan(request);
  const name = `ZZ-TEST ${"Very long account name ".repeat(4).trim()}`.slice(0, 100);
  await addAccount(request, id, name, "checking", 1000);
  await page.goto(`/${id}/budget`);
  const el = sidebar(page).locator(".nav-account-row .name");
  await expect(el).toHaveAttribute("title", name);
  await expect(el).toHaveCSS("text-overflow", "ellipsis");
  expect(await el.evaluate((n) => n.scrollWidth > n.clientWidth)).toBe(true);
});

test("the current account's row is highlighted", async ({ page, request }) => {
  const id = await newPlan(request);
  const a = await addAccount(request, id, "ZZ-TEST One", "checking", 1000);
  await addAccount(request, id, "ZZ-TEST Two", "savings", 2000);
  await page.goto(`/${id}/accounts/${a}`);
  const rows = sidebar(page).locator(".nav-account-row");
  const one = rows.filter({ hasText: "ZZ-TEST One" });
  await expect(one).toHaveClass(/is-selected/);
  await expect(one).toHaveCSS("background-color", "rgb(28, 31, 88)");
  await expect(rows.filter({ hasText: "ZZ-TEST Two" })).not.toHaveClass(/is-selected/);
});

test("an empty plan shows no groups", async ({ page, request }) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  await expect(sidebar(page).getByRole("heading", { name: "No Accounts" })).toBeVisible();
  await expect(sidebar(page).getByRole("button", { name: "Add Account" })).toBeVisible();
  await expect(sidebar(page).locator(".nav-account-group")).toHaveCount(0);
});

test("header and row geometry match the source", async ({ page, request }) => {
  const id = await newPlan(request);
  await stubAccounts(page, [
    fx({ name: "ZZ-TEST Zeta", closed: true, group: "closed", balance: 1000 }),
    fx({ name: "ZZ-TEST Alpha", closed: true, group: "closed", balance: 2000 }),
  ]);
  await page.goto(`/${id}/budget`);
  const g = group(page, "closed");
  const header = g.locator(".nav-account-block");
  const px = async (loc: ReturnType<typeof g.locator>, prop: string) =>
    loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  // Measured in "Test Budget" (source) — design doc, Acceptance case 13.
  const hb = (await header.boundingBox())!;
  expect(hb.height).toBe(32);
  const label = header.locator(".label");
  expect(await px(label, "font-size")).toBe("12px");
  expect(await px(label, "font-weight")).toBe("500");
  expect(await px(label, "letter-spacing")).toBe("1.36px");
  const lb = (await label.boundingBox())!;
  expect(lb.x - hb.x).toBe(28);
  const chev = (await header.locator("svg").first().boundingBox())!;
  expect(chev.width).toBe(8);
  expect(chev.height).toBe(8);
  const rows = g.locator(".nav-account-row");
  await expect(rows).toHaveCount(2);
  const r0 = (await rows.nth(0).boundingBox())!;
  const r1 = (await rows.nth(1).boundingBox())!;
  expect(r0.height).toBe(32);
  expect(r1.y - r0.y).toBe(36);
  const name = rows.nth(0).locator(".name");
  expect(await px(name, "font-size")).toBe("14px");
  expect(await px(name, "font-weight")).toBe("500");
  const nb = (await name.boundingBox())!;
  const sb = (await sidebar(page).boundingBox())!;
  expect(nb.x - sb.x).toBe(40);
});
