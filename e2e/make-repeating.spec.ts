import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { call, realClick, seed, txs } from "./support/register-seed";
import { createSched, fixClock, listSched, mmddyyyy } from "./support/scheduled-seed";

// EXF-503 Make Repeating. The browser's clock is fixed at 2026-11-20; the source is dated 2026-11-15, so
// the new series starts 2026-12-15 (original + 1 month), in the future.

const DAY = "2026-11-20";
const SOURCE = "2026-11-15";
const NEXT = "2026-12-15";
const PAYEE = "ZZ-TEST Phone Co";
const MEMO = "ZZ-TEST monthly bill";
const CATEGORY = "D4 Register: D4 Groceries";
const SPLIT_REASON = "Scheduled splits and transfers are not available yet.";

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const date = (page: Page) => page.getByRole("textbox", { name: "Date", exact: true });
const payee = (page: Page) => page.getByRole("combobox", { name: "Payee", exact: true });
const memo = (page: Page) => page.getByRole("textbox", { name: "Memo", exact: true });
const outflow = (page: Page) => page.getByRole("textbox", { name: "Outflow", exact: true });
const category = (page: Page) => page.getByRole("combobox", { name: "Category", exact: true });
const repeat = (page: Page) => page.getByRole("combobox", { name: "Repeat", exact: true });
const calendar = (page: Page) => page.getByRole("dialog", { name: "Calendar", exact: true });
const menu = (page: Page) => page.getByRole("menu", { name: "More actions" });
const item = (page: Page) => menu(page).getByRole("menuitem", { name: "Make Repeating" });
const realRows = (page: Page) => page.locator(".register-table tbody tr[data-tx]");
const realRow = (page: Page, text: string) => realRows(page).filter({ hasText: text });
const schedRows = (page: Page) => page.locator("tr[data-scheduled]");
const checkbox = (row: ReturnType<typeof realRow>) =>
  row.getByRole("checkbox", { name: "Select transaction", exact: true });

type Seed = Awaited<ReturnType<typeof seed>>;

async function post(request: APIRequestContext, s: Seed, body: Record<string, unknown>) {
  return (await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.checking,
    ...body,
  })) as { transaction: { id: string } };
}

async function setup(page: Page, request: APIRequestContext) {
  const s = await seed(request);
  await post(request, s, {
    date: SOURCE,
    amount: -45000,
    payee_name: PAYEE,
    category_id: s.category,
    memo: MEMO,
  });
  await fixClock(page, DAY);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(realRow(page, PAYEE)).toBeVisible();
  return s;
}

const source = (page: Page) => realRow(page, PAYEE);
const rightClickAt = async (page: Page, row: ReturnType<typeof realRow>) => {
  await row.scrollIntoViewIfNeeded();
  const box = await row.locator("td[data-field=payee]").boundingBox();
  if (!box) throw new Error("no box");
  const at = { x: box.x + 20, y: box.y + box.height / 2 };
  await page.mouse.click(at.x, at.y, { button: "right" });
  return at;
};

async function expectPrefilled(page: Page) {
  await expect(date(page)).toHaveValue(mmddyyyy(NEXT));
  await expect(payee(page)).toHaveValue(PAYEE);
  await expect(category(page)).toHaveValue(CATEGORY);
  await expect(memo(page)).toHaveValue(MEMO);
  await expect(outflow(page)).toHaveValue("45.00");
  await expect(calendar(page)).toBeVisible();
  await expect(date(page)).toBeFocused();
  await expect(repeat(page)).toHaveValue("monthly");
}

test("right-click selects the row and opens the More menu at the pointer (AC1)", async ({
  page,
  request,
}) => {
  await setup(page, request);
  await page.evaluate(() => {
    (window as unknown as { __prevented: boolean[] }).__prevented = [];
    document.addEventListener("contextmenu", (e) => {
      setTimeout(
        () =>
          (window as unknown as { __prevented: boolean[] }).__prevented.push(e.defaultPrevented),
        0,
      );
    });
  });
  const at = await rightClickAt(page, source(page));
  await expect(checkbox(source(page))).toHaveAttribute("aria-checked", "true");
  await expect(menu(page)).toBeVisible();
  const box = await menu(page).boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs((box?.x ?? 0) - at.x)).toBeLessThanOrEqual(8);
  await expect(item(page)).toBeVisible();
  await expect(item(page)).not.toHaveAttribute("aria-disabled", "true");
  await expect(item(page)).toHaveText("Make RepeatingshiftT");
  expect(
    await page.evaluate(() => (window as unknown as { __prevented: boolean[] }).__prevented),
  ).toEqual([true]);
});

test("Make Repeating opens a pre-filled add row: +1 month, picker open, Monthly (AC2)", async ({
  page,
  request,
}) => {
  const s = await setup(page, request);
  await rightClickAt(page, source(page));
  await realClick(page, item(page));
  await expect(menu(page)).toHaveCount(0);
  await expectPrefilled(page);
  await expect(source(page)).toHaveCount(1);
  const [orig] = await txs(request, s.plan, s.checking);
  expect(orig?.date).toBe(SOURCE);
});

test("Shift+T opens the same pre-filled row (AC1 shortcut)", async ({ page, request }) => {
  await setup(page, request);
  await realClick(page, source(page).locator("td[data-field=payee]"));
  await expect(checkbox(source(page))).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Shift+T");
  await expectPrefilled(page);
});

test("Save adds a repeating row under Scheduled Transactions; the original is untouched (AC3)", async ({
  page,
  request,
}) => {
  const s = await setup(page, request);
  const before = await txs(request, s.plan, s.checking);
  await rightClickAt(page, source(page));
  await realClick(page, item(page));
  await expectPrefilled(page);
  await memo(page).focus();
  await expect(calendar(page)).toHaveCount(0);
  await realClick(page, button(page, "Save"));
  const row = schedRows(page);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("12/15/2026");
  await expect(row.getByRole("img", { name: "Repeats monthly", exact: true })).toBeVisible();
  const list = await listSched(request, s.plan);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({
    frequency: "monthly",
    date_next: NEXT,
    amount: -45000,
    payee_name: PAYEE,
    category_id: s.category,
    memo: MEMO,
  });
  expect(await txs(request, s.plan, s.checking)).toEqual(before);
  await expect(realRows(page)).toHaveCount(before.length);
});

test("Cancel adds nothing (AC3)", async ({ page, request }) => {
  const s = await setup(page, request);
  const before = await txs(request, s.plan, s.checking);
  await rightClickAt(page, source(page));
  await realClick(page, item(page));
  await expectPrefilled(page);
  await memo(page).focus();
  await realClick(page, button(page, "Cancel"));
  await expect(date(page)).toHaveCount(0);
  await expect(schedRows(page)).toHaveCount(0);
  expect(await listSched(request, s.plan)).toHaveLength(0);
  expect(await txs(request, s.plan, s.checking)).toEqual(before);
});

test("greyed out on a scheduled row, and Shift+T does nothing there (AC1)", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await createSched(request, s.plan, DAY, {
    account_id: s.checking,
    date_first: NEXT,
    frequency: "monthly",
    amount: -1000,
    payee_name: "ZZ-TEST Rent",
  });
  await fixClock(page, DAY);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const row = schedRows(page).first();
  await expect(row).toBeVisible();
  const box = await row.locator("td[data-field=payee]").boundingBox();
  await page.mouse.click((box?.x ?? 0) + 20, (box?.y ?? 0) + 8, { button: "right" });
  await expect(row.getByRole("checkbox", { name: "Select transaction" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(menu(page)).toBeVisible();
  await expect(item(page)).toHaveAttribute("aria-disabled", "true");
  await expect(item(page)).toHaveAttribute("title", /\S/);
  await item(page).click({ force: true });
  await expect(date(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await row.locator("td[data-field=payee]").click();
  await page.keyboard.press("Escape");
  await realClick(page, row.getByRole("checkbox", { name: "Select transaction" }));
  await page.keyboard.press("Shift+T");
  await expect(date(page)).toHaveCount(0);
});

test("greyed out with several rows selected, selection kept (PO rule)", async ({
  page,
  request,
}) => {
  const s = await setup(page, request);
  await post(request, s, { date: SOURCE, amount: -1000, payee_name: "ZZ-TEST Other" });
  await page.reload();
  const a = source(page);
  const b = realRow(page, "ZZ-TEST Other");
  await expect(b).toBeVisible();
  await realClick(page, checkbox(a));
  await realClick(page, checkbox(b));
  await rightClickAt(page, b);
  await expect(page.locator("[role=checkbox][aria-checked=true]")).toHaveCount(2);
  await expect(item(page)).toHaveAttribute("aria-disabled", "true");
  await expect(item(page)).toHaveAttribute("title", /\S/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+T");
  await expect(date(page)).toHaveCount(0);
});

test("greyed out on a split and on a transfer, with the reason", async ({ page, request }) => {
  const s = await seed(request);
  await post(request, s, {
    date: SOURCE,
    amount: -60000,
    payee_name: "ZZ-TEST Split",
    subtransactions: [
      { amount: -25000, category_id: s.category },
      { amount: -35000, category_id: s.category },
    ],
  });
  await post(request, s, {
    date: "2026-11-14",
    amount: -12000,
    transfer_account_id: s.card,
  });
  await fixClock(page, DAY);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const split = page.locator("tr[data-tx]").filter({ hasText: "ZZ-TEST Split" }).first();
  await expect(split).toBeVisible();
  await rightClickAt(page, split);
  await expect(item(page)).toHaveAttribute("aria-disabled", "true");
  await expect(item(page)).toHaveAttribute("title", SPLIT_REASON);
  await page.keyboard.press("Escape");
  const transfer = realRows(page).filter({ hasText: "Transfer" }).first();
  await rightClickAt(page, transfer);
  await expect(item(page)).toHaveAttribute("aria-disabled", "true");
  await expect(item(page)).toHaveAttribute("title", SPLIT_REASON);
});

test("Escape closes the context menu; a right-click on another row moves it", async ({
  page,
  request,
}) => {
  const s = await setup(page, request);
  await post(request, s, { date: SOURCE, amount: -1000, payee_name: "ZZ-TEST Other" });
  await page.reload();
  const other = realRow(page, "ZZ-TEST Other");
  await expect(other).toBeVisible();
  await rightClickAt(page, source(page));
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await rightClickAt(page, source(page));
  await expect(menu(page)).toBeVisible();
  await rightClickAt(page, other);
  await expect(menu(page)).toHaveCount(1);
  await expect(checkbox(other)).toHaveAttribute("aria-checked", "true");
  await expect(checkbox(source(page))).toHaveAttribute("aria-checked", "false");
  await page.mouse.click(5, 5);
  await expect(menu(page)).toHaveCount(0);
});
