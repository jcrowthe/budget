import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { MONTH, payeeList, seed, TODAY, txs } from "./support/register-seed";

const mmddyyyy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const YEAR = TODAY.slice(0, 4);

const rows = (page: Page) => page.locator(".register-table tbody tr");
const date = (page: Page) => page.getByRole("textbox", { name: "Date", exact: true });
const payee = (page: Page) => page.getByRole("combobox", { name: "Payee", exact: true });
const category = (page: Page) => page.getByRole("combobox", { name: "Category", exact: true });
const memo = (page: Page) => page.getByRole("textbox", { name: "Memo", exact: true });
const outflow = (page: Page) => page.getByRole("textbox", { name: "Outflow", exact: true });
const inflow = (page: Page) => page.getByRole("textbox", { name: "Inflow", exact: true });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const option = (page: Page, name: string) => page.getByRole("option", { name, exact: true });
const working = (page: Page) => page.locator('[data-balance="working"] .acct-amount');

async function openAdd(page: Page, s: { plan: string; checking: string }) {
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rows(page)).toHaveCount(1);
  await button(page, "Add Transaction").click();
  await expect(date(page)).toBeFocused();
}

test("Shift+N opens the add row with today selected and the calendar open", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rows(page)).toHaveCount(1);
  await page.locator("body").press("Shift+N");
  await expect(date(page)).toBeFocused();
  await expect(date(page)).toHaveValue(mmddyyyy(TODAY));
  expect(
    await date(page).evaluate(
      (e: HTMLInputElement) => e.selectionStart === 0 && e.selectionEnd === e.value.length,
    ),
  ).toBe(true);
  await expect(
    rows(page).first().getByRole("checkbox", { name: "Select transaction" }),
  ).toHaveAttribute("aria-checked", "true");
  const cal = page.getByRole("dialog", { name: "Calendar", exact: true });
  const title = new Date(`${TODAY}T00:00:00`).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
  });
  await expect(cal.getByText(title, { exact: true })).toBeVisible();
  await expect(cal.getByRole("button", { name: "Previous month", exact: true })).toBeVisible();
  for (const d of ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"])
    await expect(cal.getByText(d, { exact: true })).toBeVisible();
  await expect(cal.getByRole("button", { name: TODAY, exact: true })).toHaveClass(/is-today/);
  await expect(payee(page)).toHaveAttribute("placeholder", "payee");
  await expect(button(page, "Cancel")).toBeVisible();
  await expect(button(page, "Save")).toBeVisible();
  await expect(button(page, "Save and add another")).toBeVisible();
  // Shift+N inside a field types the letter.
  await memo(page).focus();
  await page.keyboard.press("Shift+N");
  await expect(memo(page)).toHaveValue("N");
  await expect(page.locator(".entry-body")).toHaveCount(1);
  // Escape discards.
  await page.keyboard.press("Escape");
  await expect(page.locator(".entry-body")).toHaveCount(0);
  await button(page, "Add Transaction").click();
  await expect(date(page)).toBeFocused();
});

test("the date keys, typed dates and the calendar", async ({ page, request }) => {
  const s = await seed(request);
  await openAdd(page, s);
  const keys: [string, string][] = [
    ["m", "11/01/2026"],
    ["Shift+M", "11/30/2026"],
    ["y", "01/01/2026"],
    ["r", "12/31/2026"],
    ["Shift+Y", "12/31/2026"],
    ["-", "11/14/2026"],
    ["+", "11/16/2026"],
    ["=", "11/16/2026"],
    ["ArrowDown", "11/22/2026"],
    ["ArrowUp", "11/08/2026"],
  ];
  for (const [key, want] of keys) {
    await date(page).fill("11/15/2026");
    await date(page).press(key);
    await expect(date(page), key).toHaveValue(want);
  }
  await date(page).fill("11/15/2026");
  await date(page).press("-");
  await date(page).press("-");
  await expect(date(page)).toHaveValue("11/13/2026");
  await date(page).press("+");
  await date(page).press("+");
  await date(page).press("+");
  await date(page).press("+");
  await expect(date(page)).toHaveValue("11/17/2026");
  await date(page).press("t");
  await expect(date(page)).toHaveValue(mmddyyyy(TODAY));
  for (const [typed, want] of [
    ["11/3", `11/03/${YEAR}`],
    ["1/2/27", "01/02/2027"],
    ["3", `03/01/${YEAR}`],
  ]) {
    await date(page).fill(typed as string);
    await date(page).press("Tab");
    await expect(date(page), typed).toHaveValue(want as string);
    await date(page).focus();
  }
  // Calendar: next month, then a day.
  await date(page).fill("01/15/2027");
  const cal = page.getByRole("dialog", { name: "Calendar", exact: true });
  await cal.getByRole("button", { name: "Next month", exact: true }).click();
  await cal.getByRole("button", { name: "2027-02-10", exact: true }).click();
  await expect(date(page)).toHaveValue("02/10/2027");
  await expect(date(page)).toBeFocused();
  // Unparseable text refuses to save.
  await date(page).fill("garbage");
  await button(page, "Save").click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter a date like 11/15/2026." }),
  ).toBeVisible();
  await expect(date(page)).toBeFocused();
  expect((await txs(request, s.plan, s.checking)).length).toBe(1);
});

test("new payee, then the picker finds it and fills its last category", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await openAdd(page, s);
  await payee(page).fill("D4 Corner Market");
  await expect(option(page, 'Create "D4 Corner Market" Payee')).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByText('"D4 Corner Market" will be created as a payee.', { exact: true }),
  ).toBeVisible();
  await payee(page).press("Tab");
  await expect(payee(page)).toHaveValue("D4 Corner Market");
  await category(page).fill("d4 gro");
  await expect(option(page, "D4 Groceries")).toHaveAttribute("aria-selected", "true");
  await category(page).press("Tab");
  await expect(category(page)).toHaveValue("D4 Register: D4 Groceries");
  await outflow(page).fill("10");
  await button(page, "Save").click();
  await expect(page.locator(".entry-body")).toHaveCount(0);
  await expect(rows(page).filter({ hasText: "D4 Corner Market" })).toContainText(
    "D4 Register: D4 Groceries",
  );

  await button(page, "Add Transaction").click();
  await payee(page).fill("D4 Cor");
  await expect(option(page, "D4 Corner Market")).toHaveAttribute("aria-selected", "true");
  await payee(page).press("Tab");
  await expect(payee(page)).toHaveValue("D4 Corner Market");
  await expect(category(page)).toHaveValue("D4 Register: D4 Groceries");
  const list = await payeeList(request, s.plan);
  expect(list.filter((p) => p.name === "D4 Corner Market")).toHaveLength(1);
});

test("category search and the disabled footer", async ({ page, request }) => {
  const s = await seed(request);
  await openAdd(page, s);
  await category(page).click();
  await expect(page.getByText("Inflow", { exact: true })).toBeVisible();
  await expect(option(page, "Ready to Assign")).toBeVisible();
  await expect(option(page, "D4 Groceries")).toContainText("$200.00");
  await expect(button(page, "Payment/Transfer")).toBeDisabled();
  await expect(button(page, "Split (Multiple Categories)")).toBeDisabled();
  await category(page).fill("zzzz");
  await expect(
    page.getByText("No categories found with that name.", { exact: true }),
  ).toBeVisible();
  await category(page).fill("d4 reg");
  await expect(option(page, "D4 Groceries")).toBeVisible();
  await category(page).fill("inflow");
  await expect(option(page, "Ready to Assign")).toBeVisible();
  await category(page).press("Tab");
  await expect(category(page)).toHaveValue("Inflow: Ready to Assign");
});

test("amount arithmetic, exclusivity and the stored amount", async ({ page, request }) => {
  const s = await seed(request);
  await openAdd(page, s);
  const table: [string, string][] = [
    ["12.34+5", "17.34"],
    ["100/4", "25.00"],
    ["3*2.5", "7.50"],
    ["10-2.5", "7.50"],
    ["(2+3)*2", "10.00"],
    ["1,234.5", "1,234.50"],
    ["5+", "5.00"],
    ["-5", "5.00"],
    ["abc", ""],
    ["0", ""],
  ];
  for (const [typed, want] of table) {
    await outflow(page).fill(typed);
    await outflow(page).press("Tab");
    await expect(outflow(page), typed).toHaveValue(want);
  }
  await outflow(page).fill("12.34+5");
  await outflow(page).press("Tab");
  await inflow(page).focus();
  // Source: the 16px calculator shows (opacity 1) only on the focused amount field.
  await expect(page.locator(".entry-amount.is-focused .entry-calculator")).toHaveCSS(
    "opacity",
    "1",
  );
  await inflow(page).fill("5");
  await expect(outflow(page)).toHaveValue("");
  await outflow(page).fill("12.34+5");
  await expect(inflow(page)).toHaveValue("");
  await memo(page).focus();
  await button(page, "Save").click();
  await expect(rows(page).filter({ hasText: "$17.34" })).toHaveCount(1);
  expect((await txs(request, s.plan, s.checking)).some((t) => t.amount === -17340)).toBe(true);
});

test("Enter saves and opens the next row; Cancel and Escape discard", async ({ page, request }) => {
  const s = await seed(request);
  await openAdd(page, s);
  await date(page).fill("11/15/2026");
  await payee(page).fill("ZZ One");
  await payee(page).press("Tab");
  await memo(page).fill("first");
  await memo(page).press("Enter");
  await expect(rows(page).filter({ hasText: "ZZ One" })).toHaveCount(1);
  await expect(date(page)).toBeFocused();
  await expect(date(page)).toHaveValue("11/15/2026");
  await expect(payee(page)).toHaveValue("");
  await button(page, "Cancel").click();
  await expect(page.locator(".entry-body")).toHaveCount(0);
  await button(page, "Add Transaction").click();
  await memo(page).fill("never saved");
  await page.keyboard.press("Escape");
  await expect(page.locator(".entry-body")).toHaveCount(0);
  const saved = await txs(request, s.plan, s.checking);
  expect(saved).toHaveLength(2);
  const one = saved.find((t) => t.payee_name === "ZZ One");
  expect(one).toMatchObject({
    cleared: "uncleared",
    approved: true,
    date: "2026-11-15",
    memo: "first",
  });
});

test("an empty row saves as $0.00 and the pill opens the category list", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await openAdd(page, s);
  await button(page, "Save").click();
  const row = rows(page)
    .filter({ hasText: mmddyyyy(TODAY) })
    .filter({ hasText: "$0.00" })
    .first();
  const pill = page.getByRole("button", { name: "This needs a category", exact: true });
  await expect(pill).toBeVisible();
  const saved = (await txs(request, s.plan, s.checking)).find((t) => t.amount === 0);
  expect(saved).toMatchObject({ payee_name: null, cleared: "uncleared", approved: true });
  await pill.click();
  await expect(category(page)).toBeFocused();
  await expect(option(page, "D4 Groceries")).toBeVisible();
});

test("edit: select, open, change, balances follow; Escape restores", async ({ page, request }) => {
  const s = await seed(request);
  await openAdd(page, s);
  await payee(page).fill("ZZ Edit");
  await outflow(page).fill("12.34+5");
  await button(page, "Save").click();
  const row = () => rows(page).filter({ hasText: "ZZ Edit" });
  await expect(working(page)).toHaveText("$2,482.66");
  const sidebar = page.getByRole("navigation", { name: "Sidebar" });
  await expect(sidebar.getByRole("link", { name: /ZZ Checking/ })).toContainText("$2,482.66");
  // One click selects only that row; the second opens it.
  await row().locator("td").nth(2).click();
  await expect(row().getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".entry-body")).toHaveCount(0);
  await row().locator("td").nth(2).click();
  await expect(page.locator(".entry-body")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(row()).toContainText("$17.34");
  // Double-click the outflow cell: focus lands in Outflow.
  await row().locator('td[data-field="outflow"]').dblclick();
  await expect(outflow(page)).toBeFocused();
  await expect(outflow(page)).toHaveValue("17.34");
  await outflow(page).fill("5");
  await page.keyboard.press("Escape");
  await expect(row()).toContainText("$17.34");
  await row().locator('td[data-field="outflow"]').dblclick();
  await outflow(page).fill("20");
  await outflow(page).press("Enter");
  await expect(page.locator(".entry-body")).toHaveCount(0);
  await expect(row()).toContainText("$20.00");
  await expect(working(page)).toHaveText("$2,480.00");
  await expect(sidebar.getByRole("link", { name: /ZZ Checking/ })).toContainText("$2,480.00");
});

test("a saved category outflow reaches the Plan without a reload", async ({ page, request }) => {
  const s = await seed(request);
  await openAdd(page, s);
  await category(page).fill("d4 gro");
  await category(page).press("Tab");
  await outflow(page).fill("10");
  await button(page, "Save").click();
  await expect(page.locator(".entry-body")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Sidebar" })
    .getByRole("link", { name: "Plan", exact: true })
    .click();
  const cat = page.locator(".category-row", {
    has: page.getByText("D4 Groceries", { exact: true }),
  });
  await expect(cat.locator(".cell-activity")).toHaveText("\u2212$10.00");
  await expect(cat.locator(".cell-available")).toHaveText("$190.00");
});

test("All Accounts asks for an account; a tracking account has no category", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await page.goto(`/${s.plan}/accounts`);
  await expect(rows(page).first()).toBeVisible();
  await button(page, "Add Transaction").click();
  const account = page.getByRole("combobox", { name: "Account", exact: true });
  await expect(account).toBeFocused();
  await expect(page.getByRole("option")).toHaveText(["ZZ Checking", "ZZ Card", "ZZ Asset"]);
  await button(page, "Save").click();
  await expect(page.getByRole("alert").filter({ hasText: "Choose an account." })).toBeVisible();
  await account.click();
  await option(page, "ZZ Asset").click();
  await expect(category(page)).toBeDisabled();
  await account.click();
  await option(page, "ZZ Checking").click();
  await expect(category(page)).toBeEnabled();
  await outflow(page).fill("5");
  await button(page, "Save").click();
  await expect(page.locator(".entry-body")).toHaveCount(0);
  const mine = (await txs(request, s.plan, s.checking)).find((t) => t.amount === -5000);
  expect(mine).toBeTruthy();
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rows(page).filter({ hasText: "$5.00" })).toHaveCount(1);
});

test("a credit card's Starting Balance keeps its payee and category but takes an amount", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await page.goto(`/${s.plan}/accounts/${s.card}`);
  const start = rows(page).filter({ hasText: "Starting Balance" });
  await start.locator('td[data-field="outflow"]').dblclick();
  await expect(payee(page)).toBeDisabled();
  await expect(category(page)).toBeDisabled();
  await outflow(page).fill("1600");
  await outflow(page).press("Enter");
  await expect(start).toContainText("$1,600.00");
  expect((await txs(request, s.plan, s.card))[0]?.amount).toBe(-1600000);
});

test.describe("a real mouse reaches every list", () => {
  async function clickWithMouse(page: Page, name: string) {
    const opt = option(page, name);
    await opt.scrollIntoViewIfNeeded();
    const box = await opt.boundingBox();
    if (!box) throw new Error("no box");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const top = await page.evaluate(
      ([px, py]) =>
        document.elementFromPoint(px as number, py as number)?.closest("[role=option],button")
          ?.textContent ?? "",
      [x, y],
    );
    expect(top).toContain(name);
    await page.mouse.move(x, y);
    await page.mouse.click(x, y);
  }

  for (const size of [
    { width: 1600, height: 900 },
    { width: 1024, height: 700 },
  ]) {
    test(`at ${size.width}x${size.height}`, async ({ page, request }) => {
      await page.setViewportSize(size);
      const s = await seed(request);
      await page.goto(`/${s.plan}/accounts/${s.checking}`);
      await expect(rows(page)).toHaveCount(1);
      await request.post(`/api/v1/budgets/${s.plan}/transactions`, {
        headers: await authHeaders(),
        data: { account_id: s.checking, date: TODAY, amount: -1000, payee_name: "ZZ Mouse" },
      });
      await page.reload();
      await button(page, "Add Transaction").click();
      await payee(page).click();
      await clickWithMouse(page, "ZZ Mouse");
      await expect(payee(page)).toHaveValue("ZZ Mouse");
      await category(page).click();
      await clickWithMouse(page, "D4 Groceries");
      await expect(category(page)).toHaveValue("D4 Register: D4 Groceries");
      await date(page).focus();
      const cal = page.getByRole("dialog", { name: "Calendar", exact: true });
      const day = cal.getByRole("button", { name: `${MONTH.slice(0, 7)}-20`, exact: true });
      const b = await day.boundingBox();
      if (!b) throw new Error("no day");
      const top = await page.evaluate(
        ([px, py]) =>
          document
            .elementFromPoint(px as number, py as number)
            ?.closest("button")
            ?.getAttribute("aria-label") ?? "",
        [b.x + b.width / 2, b.y + b.height / 2],
      );
      expect(top).toBe(`${MONTH.slice(0, 7)}-20`);
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await expect(date(page)).toHaveValue(mmddyyyy(`${MONTH.slice(0, 7)}-20`));
    });
  }

  test("the last row of a 25-row register opens its list above", async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    const s = await seed(request);
    for (let i = 0; i < 25; i++) {
      await request.post(`/api/v1/budgets/${s.plan}/transactions`, {
        headers: await authHeaders(),
        data: {
          account_id: s.checking,
          date: `2026-01-${String((i % 27) + 1).padStart(2, "0")}`,
          amount: -1000,
          payee_name: `ZZ Row ${i}`,
        },
      });
    }
    await page.goto(`/${s.plan}/accounts/${s.checking}`);
    await expect(rows(page)).toHaveCount(26);
    const last = rows(page).last();
    await last.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 5000);
    await last.locator('td[data-field="payee"]').dblclick();
    await expect(payee(page)).toBeFocused();
    await payee(page).press("ArrowDown");
    const list = page.getByRole("listbox", { name: "Payees", exact: true });
    await expect(list).toBeVisible();
    const lb = await list.boundingBox();
    const pb = await payee(page).boundingBox();
    expect(lb && pb && lb.y + lb.height <= pb.y + 1).toBe(true);
    await clickWithMouse(page, "ZZ Row 0");
    await expect(payee(page)).toHaveValue("ZZ Row 0");
  });
});

test("Enter pressed twice while a save is in flight saves one row", async ({ page, request }) => {
  const s = await seed(request);
  await openAdd(page, s);
  await page.route("**/api/v1/budgets/*/transactions", async (route) => {
    if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await memo(page).fill("dup");
  await memo(page).press("Enter");
  await memo(page).press("Enter");
  await expect(rows(page).filter({ hasText: "dup" })).toHaveCount(1);
  await page.waitForTimeout(1200);
  expect((await txs(request, s.plan, s.checking)).filter((t) => t.memo === "dup")).toHaveLength(1);
});
