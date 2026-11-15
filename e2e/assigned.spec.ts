import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

const pad = (n: number) => String(n).padStart(2, "0");
const ym = (offset: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}`;
};
const iso = (yyyymm: string) => `${yyyymm.slice(0, 4)}-${yyyymm.slice(4)}-01`;

type Req = import("@playwright/test").APIRequestContext;
let planId = "";

test.beforeEach(async ({ request }: { request: Req }) => {
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: testName("assigned") },
  });
  planId = (await res.json()).data.budget.id;
});
test.afterEach(async ({ request }: { request: Req }) => {
  await request.delete(`/api/v1/budgets/${planId}`, { headers: await authHeaders() });
});

const RENT = "🏠 Rent/Mortgage";
const open = async (page: Page, path = "budget") => {
  await page.goto(`/${planId}/${path}`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
};
const catRow = (page: Page, name: string) =>
  page.locator(".category-row", { has: page.getByText(name, { exact: true }) });
const groupRow = (page: Page, name: string) =>
  page.locator(".group-row", { has: page.getByText(name, { exact: true }) });
const input = (page: Page, name: string) =>
  page.getByRole("textbox", { name: `Assigned for ${name}` });
const amountOf = (page: Page, name: string) => catRow(page, name).locator(".assigned-box .amount");
const css = (loc: Locator, prop: string) =>
  loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

async function month(request: Req, m: string) {
  const res = await request.get(`/api/v1/budgets/${planId}/months/${iso(m)}`, {
    headers: await authHeaders(),
  });
  return (await res.json()).data as {
    ready_to_assign: number;
    groups: { categories: { name: string; assigned: number }[] }[];
  };
}
const apiAssigned = async (request: Req, m: string, name: string) =>
  (await month(request, m)).groups.flatMap((g) => g.categories).find((c) => c.name === name)
    ?.assigned;

const patches = (page: Page) => {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PATCH" && /\/categories\//.test(r.url())) seen.push(r.url());
  });
  return seen;
};
const isPatch = (r: import("@playwright/test").Response) =>
  r.request().method() === "PATCH" && /\/categories\//.test(r.url());

/** Opens a cell, types and commits with Enter, waiting for the PATCH when one is expected. */
async function setTo(page: Page, name: string, text: string, expectPatch = true) {
  await amountOf(page, name).click();
  const field = input(page, name);
  await page.keyboard.type(text);
  const done = expectPatch ? page.waitForResponse(isPatch) : Promise.resolve();
  await field.press("Enter");
  await done;
}

test("open shows the value selected, styled as the source", async ({ page }) => {
  await open(page);
  await amountOf(page, RENT).click();
  const field = input(page, RENT);
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("0.00");
  expect(await field.evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd])).toEqual(
    [0, 4],
  );
  await page.mouse.move(0, 0);
  const box = catRow(page, RENT).locator(".assigned-box");
  await expect(box).toHaveClass(/is-editing/);
  // Measured on the source's open cell (computed styles, 1600x813): 1px #545bfe border, no shadow.
  expect(await css(box, "border-top-color")).toBe("rgb(84, 91, 254)");
  expect(await css(box, "border-top-width")).toBe("1px");
  expect(await css(box, "box-shadow")).toBe("none");
  expect(await css(box.locator(".calculator-button"), "opacity")).toBe("1");
  await expect(page.getByRole("textbox")).toHaveCount(1);
});

test("hover shows the border, background and calculator icon", async ({ page }) => {
  await open(page);
  await amountOf(page, RENT).hover();
  const box = catRow(page, RENT).locator(".assigned-box");
  // Measured on the source's hovered cell: #7583ff border, #0c0d22 background, text cursor.
  await expect.poll(() => css(box, "border-top-color")).toBe("rgb(117, 131, 255)");
  expect(await css(box, "background-color")).toBe("rgb(12, 13, 34)");
  expect(await css(box.locator(".calculator-button"), "opacity")).toBe("1");
  expect(await css(amountOf(page, RENT), "cursor")).toBe("text");
});

test("Enter commits 400 and the grid updates without a reload", async ({ page, request }) => {
  await open(page);
  const r0 = (await month(request, ym(0))).ready_to_assign;
  await setTo(page, RENT, "400");
  await expect(amountOf(page, RENT)).toHaveText("$400.00");
  const pill = catRow(page, RENT).locator(".available-pill");
  await expect(pill).toHaveText("$400.00");
  await expect(pill).toHaveClass(/positive/);
  await expect(groupRow(page, "Bills").locator(".num")).toHaveText(["$400.00", "$0.00", "$400.00"]);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
  expect(await apiAssigned(request, ym(0), RENT)).toBe(400000);
  expect((await month(request, ym(0))).ready_to_assign).toBe(r0 - 400000);
});

test("arithmetic continues from the value", async ({ page }) => {
  await open(page);
  await setTo(page, RENT, "400");
  await amountOf(page, RENT).click();
  await page.keyboard.type("+50");
  await expect(input(page, RENT)).toHaveValue("400.00+50");
  const done = page.waitForResponse(isPatch);
  await page.keyboard.press("Enter");
  await done;
  await expect(amountOf(page, RENT)).toHaveText("$450.00");
  await setTo(page, RENT, "100");
  for (const [typed, want] of [
    ["*2", "$200.00"],
    ["/4", "$50.00"],
    ["-10", "$40.00"],
    ["x2", "$80.00"],
  ] as const) {
    await setTo(page, RENT, typed);
    await expect(amountOf(page, RENT)).toHaveText(want);
  }
  const seen = patches(page);
  await setTo(page, "📱 Phone & Internet", "*2", false);
  await expect(amountOf(page, "📱 Phone & Internet")).toHaveText("$0.00");
  expect(seen).toHaveLength(0);
});

test("parsing: rounding, thousands separators, junk, negative", async ({ page, request }) => {
  await open(page);
  for (const [typed, stored, shown] of [
    ["12.345", 12350, "$12.35"],
    ["1,234.5", 1234500, "$1,234.50"],
    ["abc", 0, "$0.00"],
    ["0-25", -25000, "−$25.00"],
  ] as const) {
    await setTo(page, RENT, typed, stored !== (await apiAssigned(request, ym(0), RENT)));
    await expect(amountOf(page, RENT)).toHaveText(shown);
    expect(await apiAssigned(request, ym(0), RENT)).toBe(stored);
  }
  await expect(catRow(page, RENT).locator(".available-pill")).toHaveClass(/negative/);
});

test("Escape discards and sends nothing", async ({ page, request }) => {
  await open(page);
  await setTo(page, RENT, "40");
  const seen = patches(page);
  await amountOf(page, RENT).click();
  await page.keyboard.type("999");
  await page.keyboard.press("Escape");
  await expect(amountOf(page, RENT)).toHaveText("$40.00");
  expect(seen).toHaveLength(0);
  expect(await apiAssigned(request, ym(0), RENT)).toBe(40000);
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
});

test("Tab goes to the Available pill, Shift+Tab to the name", async ({ page }) => {
  await open(page);
  await amountOf(page, RENT).click();
  await page.keyboard.type("400");
  const done = page.waitForResponse(isPatch);
  await page.keyboard.press("Tab");
  await done;
  const pill = catRow(page, RENT).locator(".available-pill");
  await expect(pill).toHaveText("$400.00");
  await expect(pill).toBeFocused();
  const seen = patches(page);
  await amountOf(page, RENT).click();
  await page.keyboard.press("Shift+Tab");
  await expect(catRow(page, RENT).locator("button.category-name")).toBeFocused();
  expect(seen).toHaveLength(0);
});

test("arrows move across groups and skip collapsed ones", async ({ page }) => {
  await open(page);
  const u = "⚡️ Utilities";
  await amountOf(page, u).click();
  await page.keyboard.type("10");
  const done = page.waitForResponse(isPatch);
  await page.keyboard.press("ArrowDown");
  await done;
  await expect(amountOf(page, u)).toHaveText("$10.00");
  const g = input(page, "🛒 Groceries");
  await expect(g).toBeFocused();
  await expect(g).toHaveValue("0.00");
  await page.keyboard.press("ArrowUp");
  await expect(input(page, u)).toHaveValue("10.00");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Collapse Needs categories" }).click();
  await amountOf(page, u).click();
  await page.keyboard.press("ArrowDown");
  await expect(input(page, "🍽️ Dining out")).toBeFocused();
  await page.keyboard.press("Escape");
  const last = "❗️ Stuff I forgot to plan for";
  await amountOf(page, last).click();
  await page.keyboard.type("5");
  const done2 = page.waitForResponse(isPatch);
  await page.keyboard.press("ArrowDown");
  await done2;
  await expect(amountOf(page, last)).toHaveText("$5.00");
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

test("clicking elsewhere commits", async ({ page, request }) => {
  await open(page);
  await amountOf(page, RENT).click();
  await page.keyboard.type("75");
  const done = page.waitForResponse(isPatch);
  await page.getByRole("columnheader", { name: "ASSIGNED" }).click();
  await done;
  await expect(amountOf(page, RENT)).toHaveText("$75.00");
  expect(await apiAssigned(request, ym(0), RENT)).toBe(75000);
});

test("an unchanged value sends no request", async ({ page }) => {
  await open(page);
  const seen = patches(page);
  await amountOf(page, RENT).click();
  await page.keyboard.press("Enter");
  await amountOf(page, RENT).click();
  await page.keyboard.press("ArrowDown");
  await expect(input(page, "📱 Phone & Internet")).toBeVisible();
  expect(seen).toHaveLength(0);
});

test("a failed request restores the old value and says so", async ({ page }) => {
  await open(page);
  await page.route("**/months/*/categories/*", (r) => r.fulfill({ status: 500, body: "{}" }));
  await amountOf(page, RENT).click();
  await page.keyboard.type("400");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("Couldn't save the assigned amount.");
  await expect(amountOf(page, RENT)).toHaveText("$0.00");
  await expect(catRow(page, RENT).locator(".available-pill")).toHaveText("$0.00");
});

test("past and future months edit the same way", async ({ page, request }) => {
  await open(page, `budget/${ym(-1)}`);
  await setTo(page, RENT, "30");
  await expect(amountOf(page, RENT)).toHaveText("$30.00");
  await open(page, `budget/${ym(1)}`);
  await setTo(page, RENT, "60");
  await expect(amountOf(page, RENT)).toHaveText("$60.00");
  expect(await apiAssigned(request, ym(-1), RENT)).toBe(30000);
  expect(await apiAssigned(request, ym(1), RENT)).toBe(60000);
  expect(await apiAssigned(request, ym(0), RENT)).toBe(0);
});

test("group rows are not editable", async ({ page }) => {
  await open(page);
  await groupRow(page, "Bills").locator(".cell-assigned").click();
  await expect(page.getByRole("textbox")).toHaveCount(0);
});

async function rpc(request: Req, method: string, params: unknown, id: number) {
  const res = await request.post("/mcp", {
    headers: await authHeaders({
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    }),
    data: { jsonrpc: "2.0", id, method, params },
  });
  expect(res.status()).toBe(200);
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(line ? line.slice(5) : text);
}

test("REST and MCP answer the same", async ({ request }) => {
  const m = await month(request, ym(0));
  const rest = m.groups[0]?.categories as unknown as { id: string }[];
  const [a, b] = [rest[0]?.id, rest[1]?.id];
  const res = await request.patch(
    `/api/v1/budgets/${planId}/months/${iso(ym(0))}/categories/${a}`,
    {
      headers: await authHeaders(),
      data: { assigned: 1000 },
    },
  );
  expect(res.status()).toBe(200);
  const viaRest = (await res.json()).data;
  await rpc(
    request,
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } },
    1,
  );
  const viaMcp = (
    await rpc(
      request,
      "tools/call",
      {
        name: "set_assigned",
        arguments: { budget_id: planId, month: iso(ym(0)), category_id: b, assigned: 1000 },
      },
      2,
    )
  ).result.structuredContent;
  expect({ ...viaMcp.category, id: "x" }).toEqual({ ...viaRest.category, id: "x" });
  expect(viaMcp.ready_to_assign).toBe(viaRest.ready_to_assign - 1000);
});
