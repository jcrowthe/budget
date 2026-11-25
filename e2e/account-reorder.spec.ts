import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { api, newAccount, newPlan, post } from "./support/account-edit-seed";
import { authHeaders } from "./support/auth";

// EXF-490: reorder accounts by dragging their rows in the sidebar, within one section. The drag is the
// browser's own HTML5 drag, driven with the mouse in several steps.

let planId = "";

test.beforeEach(async ({ request }) => {
  planId = await newPlan(request);
});
test.afterEach(async ({ request }) => {
  await request.delete(`/api/v1/budgets/${planId}`, { headers: await authHeaders() });
});

const group = (page: Page, name: string) => page.locator(`[data-group="${name}"]`);
const rows = (page: Page, name: string) => group(page, name).locator(".nav-account-row");
const rowOf = (page: Page, name: string, account: string) =>
  rows(page, name).filter({ hasText: account });
const names = (page: Page, name: string) => rows(page, name).locator(".name").allTextContents();

const open = async (page: Page) => {
  await page.goto(`/${planId}/budget`);
  await expect(page.locator(".nav-account-row").first()).toBeVisible();
};

/** Mouse down on the row's name, move in steps over the target half, optionally release. */
async function drag(
  page: Page,
  source: Locator,
  target: Locator,
  half: "top" | "bottom",
  release = true,
) {
  const s = await source.locator(".name").boundingBox();
  const t = await target.boundingBox();
  if (!s || !t) throw new Error("no box");
  const sx = s.x + 6;
  const sy = s.y + s.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 12, sy + 8, { steps: 4 });
  const y = half === "top" ? t.y + 3 : t.y + t.height - 3;
  await page.mouse.move(t.x + t.width / 2, y, { steps: 12 });
  await page.mouse.move(t.x + t.width / 2, y + (half === "top" ? 1 : -1), { steps: 2 });
  if (release) await page.mouse.up();
}

async function seedCash(request: APIRequestContext) {
  return {
    a: await newAccount(request, planId, "ZZ-TEST A"),
    b: await newAccount(request, planId, "ZZ-TEST B"),
    c: await newAccount(request, planId, "ZZ-TEST C"),
  };
}

test("drag shows a gap, drops there, and the order survives a reload (AC 1, 2)", async ({
  page,
  request,
}) => {
  await seedCash(request);
  await open(page);
  expect(await names(page, "cash")).toEqual(["ZZ-TEST A", "ZZ-TEST B", "ZZ-TEST C"]);
  await drag(
    page,
    rowOf(page, "cash", "ZZ-TEST C"),
    rowOf(page, "cash", "ZZ-TEST A"),
    "top",
    false,
  );
  const gap = group(page, "cash").locator(".nav-drop-gap");
  await expect(gap).toBeVisible();
  // the gap is the first thing after the header: right before A's row
  const first = group(page, "cash").locator(".nav-drop-gap, .nav-account-row").first();
  await expect(first).toHaveClass(/nav-drop-gap/);
  await page.mouse.up();
  await expect.poll(() => names(page, "cash")).toEqual(["ZZ-TEST C", "ZZ-TEST A", "ZZ-TEST B"]);
  await expect(gap).toHaveCount(0);
  await page.reload();
  await expect(rows(page, "cash").first()).toBeVisible();
  expect(await names(page, "cash")).toEqual(["ZZ-TEST C", "ZZ-TEST A", "ZZ-TEST B"]);
});

test("a drop in another section opens no gap and sends nothing (AC 3)", async ({
  page,
  request,
}) => {
  await newAccount(request, planId, "ZZ-TEST T1", "otherAsset");
  for (const name of ["ZZ-TEST L1", "ZZ-TEST L2"]) {
    await post(request, `/api/v1/budgets/${planId}/accounts`, {
      name,
      type: "mortgage",
      balance: 1000,
      interest_rate: "6.5",
      minimum_payment: 10,
      date: "2026-11-10",
    });
  }
  const puts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes("/accounts/order")) puts.push(r.url());
  });
  await open(page);
  const before = await names(page, "loans");
  // over its own section the gap opens ...
  await drag(
    page,
    rowOf(page, "loans", "ZZ-TEST L2"),
    rowOf(page, "loans", "ZZ-TEST L1"),
    "top",
    false,
  );
  await expect(group(page, "loans").locator(".nav-drop-gap")).toBeVisible();
  // ... and closes when the pointer moves over another section, where nothing is offered
  const t = await rowOf(page, "tracking", "ZZ-TEST T1").boundingBox();
  if (!t) throw new Error("no box");
  await page.mouse.move(t.x + t.width / 2, t.y + 3, { steps: 10 });
  await page.mouse.move(t.x + t.width / 2, t.y + 4, { steps: 2 });
  await expect(page.locator(".nav-drop-gap")).toHaveCount(0);
  await page.mouse.up();
  expect(await names(page, "loans")).toEqual(before);
  expect(before).toEqual(["ZZ-TEST L1", "ZZ-TEST L2"]);
  expect(await names(page, "tracking")).toEqual(["ZZ-TEST T1"]);
  await page.waitForTimeout(300);
  expect(puts).toEqual([]);
});

test("a plain click still opens the account (AC 4)", async ({ page, request }) => {
  const { a } = await seedCash(request);
  await open(page);
  await rowOf(page, "cash", "ZZ-TEST A").locator(".nav-account-link").click();
  await expect(page).toHaveURL(new RegExp(`/${planId}/accounts/${a}`));
});

test("an account created after a reorder is last in its section (AC 6)", async ({
  page,
  request,
}) => {
  const { a, b, c } = await seedCash(request);
  const res = await api(request, "PUT", `/api/v1/budgets/${planId}/accounts/order`, {
    account_ids: [c, a, b],
  });
  expect(res.status()).toBe(200);
  await newAccount(request, planId, "ZZ-TEST D");
  await open(page);
  expect(await names(page, "cash")).toEqual(["ZZ-TEST C", "ZZ-TEST A", "ZZ-TEST B", "ZZ-TEST D"]);
});

test("closed rows are not draggable; open ones are", async ({ page, request }) => {
  const { b } = await seedCash(request);
  await post(request, `/api/v1/budgets/${planId}/accounts/${b}/close`, {});
  await open(page);
  await expect(rowOf(page, "cash", "ZZ-TEST A")).toHaveAttribute("draggable", "true");
  await expect(rowOf(page, "closed", "ZZ-TEST B")).not.toHaveAttribute("draggable", "true");
});

test("starred rows reorder among themselves and swap places in their section", async ({
  page,
  request,
}) => {
  const { a, c } = await seedCash(request);
  for (const id of [a, c]) {
    const res = await api(request, "PATCH", `/api/v1/budgets/${planId}/accounts/${id}`, {
      starred: true,
    });
    expect(res.ok()).toBe(true);
  }
  await open(page);
  expect(await names(page, "starred")).toEqual(["ZZ-TEST A", "ZZ-TEST C"]);
  await drag(page, rowOf(page, "starred", "ZZ-TEST C"), rowOf(page, "starred", "ZZ-TEST A"), "top");
  await expect.poll(() => names(page, "starred")).toEqual(["ZZ-TEST C", "ZZ-TEST A"]);
  await expect.poll(() => names(page, "cash")).toEqual(["ZZ-TEST C", "ZZ-TEST B", "ZZ-TEST A"]);
});

test("Undo in a register puts the sidebar order back", async ({ page, request }) => {
  await seedCash(request);
  await open(page);
  await drag(page, rowOf(page, "cash", "ZZ-TEST C"), rowOf(page, "cash", "ZZ-TEST A"), "top");
  await expect.poll(() => names(page, "cash")).toEqual(["ZZ-TEST C", "ZZ-TEST A", "ZZ-TEST B"]);
  await rowOf(page, "cash", "ZZ-TEST A").locator(".nav-account-link").click();
  const undo = page
    .getByRole("toolbar", { name: "Register toolbar" })
    .getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(() => names(page, "cash")).toEqual(["ZZ-TEST A", "ZZ-TEST B", "ZZ-TEST C"]);
});
