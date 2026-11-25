import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

// EXF-496: reorder categories and groups by dragging rows in the Plan grid. The drag is the browser's own
// HTML5 drag, driven with the mouse in several steps.

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const ISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;

type Req = import("@playwright/test").APIRequestContext;
let planId = "";

test.beforeEach(async ({ request }: { request: Req }) => {
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: testName("reorder") },
  });
  planId = (await res.json()).data.budget.id;
});
test.afterEach(async ({ request }: { request: Req }) => {
  await request.delete(`/api/v1/budgets/${planId}`, { headers: await authHeaders() });
});

const RENT = "🏠 Rent/Mortgage";
const PHONE = "📱 Phone & Internet";
const UTILITIES = "⚡️ Utilities";
const GROCERIES = "🛒 Groceries";

const open = async (page: Page) => {
  await page.goto(`/${planId}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(page.locator(".category-row .category-name").first()).toBeVisible();
};
const catRow = (page: Page, name: string) =>
  page.locator(".category-row", { has: page.getByText(name, { exact: true }) });
const block = (page: Page, name: string) =>
  page.locator(".group-block", {
    has: page.locator(".group-row .group-name", { hasText: name }),
  });
const blockNames = (page: Page, group: string) =>
  block(page, group).locator(".category-row .category-name");
const groupNames = (page: Page) => page.locator(".group-row .group-name");

/** Mouse down on the row's left margin (not a button), move in steps over the target half, optionally release. */
async function drag(
  page: Page,
  source: Locator,
  target: Locator,
  half: "top" | "bottom",
  release = true,
) {
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  if (!s || !t) throw new Error("no box");
  const sx = s.x + 6;
  const sy = s.y + s.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 12, sy + 8, { steps: 4 });
  const y = half === "top" ? t.y + 4 : t.y + t.height - 4;
  await page.mouse.move(t.x + t.width / 2, y, { steps: 12 });
  await page.mouse.move(t.x + t.width / 2, y + (half === "top" ? 1 : -1), { steps: 2 });
  if (release) await page.mouse.up();
}

type Month = {
  ready_to_assign: number;
  groups: { id: string; name: string; categories: { id: string; name: string }[] }[];
};
async function month(request: Req, iso = ISO): Promise<Month> {
  const res = await request.get(`/api/v1/budgets/${planId}/months/${iso}`, {
    headers: await authHeaders(),
  });
  return (await res.json()).data;
}
const catId = (m: Month, name: string) =>
  m.groups.flatMap((g) => g.categories).find((c) => c.name === name)?.id ?? "";

test("AC1: drag the 3rd category above the 1st, and below a sibling; the order persists", async ({
  page,
}) => {
  await open(page);
  await expect(blockNames(page, "Bills")).toHaveText([RENT, PHONE, UTILITIES]);
  await drag(page, catRow(page, UTILITIES), catRow(page, RENT), "top");
  await expect(blockNames(page, "Bills")).toHaveText([UTILITIES, RENT, PHONE]);
  await page.reload();
  await expect(blockNames(page, "Bills")).toHaveText([UTILITIES, RENT, PHONE]);

  await drag(page, catRow(page, UTILITIES), catRow(page, RENT), "bottom");
  await expect(blockNames(page, "Bills")).toHaveText([RENT, UTILITIES, PHONE]);
  await page.reload();
  await expect(blockNames(page, "Bills")).toHaveText([RENT, UTILITIES, PHONE]);
  await expect(page.locator(".drop-gap")).toHaveCount(0);
});

test("AC2: a category dragged into another group keeps its amounts, both subtotals move, Ready to Assign holds", async ({
  page,
  request,
}) => {
  const id = catId(await month(request), GROCERIES);
  const res = await request.patch(`/api/v1/budgets/${planId}/months/${ISO}/categories/${id}`, {
    headers: await authHeaders(),
    data: { assigned: 120000 },
  });
  expect(res.ok()).toBe(true);
  const rtaApi = (await month(request)).ready_to_assign;
  await open(page);
  const cells = (name: string) => catRow(page, name).locator(".num");
  const rta = page.locator(".rta-amount");
  const before = await cells(GROCERIES).allTextContents();
  const rtaBefore = await rta.textContent();
  const sub = (g: string) => block(page, g).locator(".group-row .cell-assigned");
  const [needsBefore, billsBefore] = [
    await sub("Needs").textContent(),
    await sub("Bills").textContent(),
  ];

  await drag(page, catRow(page, GROCERIES), catRow(page, PHONE), "bottom");
  await expect(blockNames(page, "Bills")).toHaveText([RENT, PHONE, GROCERIES, UTILITIES]);
  await expect(blockNames(page, "Needs")).not.toContainText([GROCERIES]);
  expect(await cells(GROCERIES).allTextContents()).toEqual(before);
  await expect(sub("Bills")).not.toHaveText(billsBefore ?? "");
  await expect(sub("Needs")).not.toHaveText(needsBefore ?? "");
  await expect(rta).toHaveText(rtaBefore ?? "");

  const moved = await month(request);
  expect(moved.groups.find((g) => g.name === "Bills")?.categories.map((c) => c.name)).toContain(
    GROCERIES,
  );
  expect(moved.ready_to_assign).toBe(rtaApi);
  // The next month shows the same order.
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(blockNames(page, "Bills")).toHaveText([RENT, PHONE, GROCERIES, UTILITIES]);
});

test("AC3: a group dropped below another group's last category goes after that group", async ({
  page,
  request,
}) => {
  await open(page);
  const before = await groupNames(page).allTextContents();
  expect(before).toEqual(["Bills", "Needs", "Wants"]);
  const needsCats = await blockNames(page, "Needs").allTextContents();
  await drag(page, block(page, "Bills").locator(".group-row"), block(page, "Needs"), "bottom");
  await expect(groupNames(page)).toHaveText(["Needs", "Bills", "Wants"]);
  await expect(blockNames(page, "Needs")).toHaveText(needsCats);
  await expect(blockNames(page, "Bills")).toHaveText([RENT, PHONE, UTILITIES]);
  await page.reload();
  await expect(groupNames(page)).toHaveText(["Needs", "Bills", "Wants"]);
  expect((await month(request)).groups.map((g) => g.name)).toEqual(["Needs", "Bills", "Wants"]);
});

test("AC4: while dragging, the gap row sits above the target and the source is dimmed", async ({
  page,
}) => {
  await open(page);
  await drag(page, catRow(page, UTILITIES), catRow(page, PHONE), "top", false);
  await expect(catRow(page, UTILITIES)).toHaveClass(/is-drag-source/);
  const gap = page.getByTestId("drop-gap");
  await expect(gap).toBeVisible();
  const [g, t] = [await gap.boundingBox(), await catRow(page, PHONE).boundingBox()];
  expect(g && t && Math.abs(g.y + g.height - t.y) <= 2).toBe(true);
  await page.mouse.up();
  await expect(gap).toHaveCount(0);
  await expect(catRow(page, UTILITIES)).not.toHaveClass(/is-drag-source/);
  await expect(blockNames(page, "Bills")).toHaveText([RENT, UTILITIES, PHONE]);
});

test("a normal category can't be dropped on the Credit Card Payments group", async ({
  page,
  request,
}) => {
  const res = await request.post(`/api/v1/budgets/${planId}/accounts`, {
    headers: await authHeaders(),
    data: { name: "ZZ Visa", type: "creditCard", balance: 0, date: `${ISO.slice(0, 8)}02` },
  });
  expect(res.ok()).toBe(true);
  await open(page);
  const pay = block(page, "Credit Card Payments");
  await expect(pay).toBeVisible();
  await drag(page, catRow(page, GROCERIES), pay.locator(".category-row").first(), "top", false);
  await expect(page.getByTestId("drop-gap")).toHaveCount(0);
  await page.mouse.up();
  await expect(blockNames(page, "Needs").first()).toHaveText(GROCERIES);
  await expect(pay.locator(".category-row")).toHaveCount(1);
});

test("Undo restores the order after a drag", async ({ page }) => {
  await open(page);
  await drag(page, catRow(page, UTILITIES), catRow(page, RENT), "top");
  await expect(blockNames(page, "Bills")).toHaveText([UTILITIES, RENT, PHONE]);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(blockNames(page, "Bills")).toHaveText([RENT, PHONE, UTILITIES]);
});
