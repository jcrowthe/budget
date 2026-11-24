import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { BANNER, seedApprove, stubReject } from "./support/approve-seed";
import { authHeaders } from "./support/auth";
import { accountBalance, accountRows, seedBulk } from "./support/bulk-seed";
import { call, realClick, TODAY, txs } from "./support/register-seed";

// EXF-530 U3: Undo and Redo in the register. Every test seeds its own plan (a few rows) and fails on main, where
// the two toolbar buttons are drawn disabled.

const UNDO_TIP = "Undo the last thing you did (in Budget, not in life).";
const REDO_TIP = "Redo that thing you just undid. Practice decisiveness.";

const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Register toolbar" });
const undoBtn = (page: Page) => toolbar(page).getByRole("button", { name: "Undo", exact: true });
const redoBtn = (page: Page) => toolbar(page).getByRole("button", { name: "Redo", exact: true });
const rowOf = (page: Page, payee: string) =>
  page.locator(".register-table tbody tr[data-tx]").filter({ hasText: payee });
const flagCell = (page: Page, payee: string) => rowOf(page, payee).locator("td.cell-flag button");
const flagMenu = (page: Page) => page.getByRole("menu", { name: "Flags" });
const balance = (page: Page, key: string) => page.locator(`[data-balance=${key}] .acct-amount`);
const box = (page: Page, payee: string) =>
  rowOf(page, payee).getByRole("checkbox", { name: "Select transaction", exact: true });
const flagOf = async (request: APIRequestContext, plan: string, acct: string, id: string) =>
  (await accountRows(request, plan, acct)).find((t) => t.id === id)?.flag_color;
const memoOf = async (request: APIRequestContext, plan: string, acct: string, id: string) =>
  (await accountRows(request, plan, acct)).find((t) => t.id === id)?.memo;

/** Picks a colour from a row's flag menu, then moves focus off every field so the keys reach the page. */
async function flag(page: Page, payee: string, colour: string, inline = true) {
  await realClick(page, flagCell(page, payee));
  await realClick(page, flagMenu(page).getByRole("menuitem", { name: colour, exact: true }));
  await expect(flagMenu(page)).toHaveCount(0);
  await page.getByRole("heading", { name: "ZZ Checking" }).first().click();
  // The key does nothing while the write is in flight: wait for the button, as a person would see it.
  if (inline) await expect(undoBtn(page)).toBeEnabled();
}

/** A first click selects the row, a second on its memo cell opens it for editing. */
async function openMemo(page: Page, payee: string) {
  await realClick(page, rowOf(page, payee).locator("td[data-field=payee]"));
  await expect(rowOf(page, payee)).toHaveClass(/is-checked/);
  await realClick(page, rowOf(page, payee).locator("td[data-field=memo]"));
  await expect(page.getByRole("textbox", { name: "Memo", exact: true })).toBeVisible();
}

test.use({ viewport: { width: 1440, height: 900 } });

test("1 transfer delete, undo, redo, undo", async ({ page, request }) => {
  const s = await seedBulk(request);
  const made = await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.checking,
    transfer_account_id: s.savings,
    date: TODAY,
    amount: -33300,
    memo: "ZZ moved",
    cleared: "cleared",
  });
  const first = made.transaction.id as string;
  const shape = async () => {
    const pick = (rows: { memo: string | null }[]) =>
      rows
        .filter((t) => t.memo === "ZZ moved")
        .map((t) => {
          const r = t as unknown as { amount: number; date: string; cleared: string };
          return { amount: r.amount, date: r.date, cleared: r.cleared, memo: t.memo };
        });
    return {
      checking: pick(await txs(request, s.plan, s.checking)),
      savings: pick(await txs(request, s.plan, s.savings)),
    };
  };
  const before = await shape();
  expect(before.checking).toHaveLength(1);
  expect(before.savings).toHaveLength(1);

  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await expect(undoBtn(page)).toBeDisabled();
  const row = page.locator(".register-table tbody tr[data-tx]").filter({ hasText: "ZZ moved" });
  await realClick(page, row.getByRole("checkbox", { name: "Select transaction", exact: true }));
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await shape()).checking.length).toBe(0);
  expect((await shape()).savings).toHaveLength(0);

  await expect(undoBtn(page)).toBeEnabled();
  await realClick(page, undoBtn(page));
  await expect.poll(async () => (await shape()).savings.length).toBe(1);
  expect(await shape()).toEqual(before);
  await expect(
    page.locator(".register-table tbody tr[data-tx].is-checked").filter({ hasText: "ZZ moved" }),
  ).toHaveCount(1);
  void first;

  await expect(redoBtn(page)).toBeEnabled();
  await realClick(page, redoBtn(page));
  await expect.poll(async () => (await shape()).checking.length).toBe(0);
  expect((await shape()).savings).toHaveLength(0);

  await expect(undoBtn(page)).toBeEnabled();
  await realClick(page, undoBtn(page));
  await expect.poll(async () => (await shape()).checking.length).toBe(1);
  expect(await shape()).toEqual(before);
});

test("2 flag, ctrl+Z, ctrl+shift+Z, ctrl+Y", async ({ page, request }) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await flag(page, "ZZ Rent", "Red");
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.rent)).toBe("red");

  await page.keyboard.press("Control+z");
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.rent)).toBeNull();
  await expect(
    rowOf(page, "ZZ Rent").getByRole("button", { name: "Flag", exact: true }),
  ).toBeVisible();

  await expect(redoBtn(page)).toBeEnabled();
  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.rent)).toBe("red");
  await expect(
    rowOf(page, "ZZ Rent").getByRole("button", { name: "Red", exact: true }),
  ).toBeVisible();

  await expect(undoBtn(page)).toBeEnabled();
  await page.keyboard.press("Control+z");
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.rent)).toBeNull();
  await expect(redoBtn(page)).toBeEnabled();
  await page.keyboard.press("Control+y");
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.rent)).toBe("red");
});

test("3 bulk clear two rows, undo restores balances", async ({ page, request }) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  const read = async () => [
    await balance(page, "cleared").innerText(),
    await balance(page, "uncleared").innerText(),
    await balance(page, "working").innerText(),
  ];
  await expect(balance(page, "cleared")).toHaveText("$901.00");
  const earlier = await read();
  await realClick(page, box(page, "ZZ Rent"));
  await realClick(page, box(page, "ZZ Gas"));
  await page.keyboard.press("c");
  await expect(balance(page, "cleared")).toHaveText("$741.00");
  expect(await read()).not.toEqual(earlier);

  await realClick(page, undoBtn(page));
  await expect(balance(page, "cleared")).toHaveText(earlier[0] as string);
  await expect(balance(page, "uncleared")).toHaveText(earlier[1] as string);
  await expect(balance(page, "working")).toHaveText(earlier[2] as string);
  expect(await accountBalance(request, s.plan, s.checking)).toBe(655500 + 250000 - 4500 - 160000);
});

test("4 undo from another account navigates and selects", async ({ page, request }) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  // Edit the memo of ZZ Rent inline and save.
  await openMemo(page, "ZZ Rent");
  const memo = page.getByRole("textbox", { name: "Memo", exact: true });
  await memo.fill("ZZ changed");
  await memo.press("Enter");
  await expect.poll(() => memoOf(request, s.plan, s.checking, s.rent)).toBe("ZZ changed");

  await page
    .getByRole("link", { name: /ZZ Savings/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/accounts/${s.savings}$`));
  await expect(undoBtn(page)).toBeEnabled();
  await realClick(page, undoBtn(page));

  await expect(page).toHaveURL(new RegExp(`/accounts/${s.checking}$`));
  await expect.poll(() => memoOf(request, s.plan, s.checking, s.rent)).toBeNull();
  const rent = rowOf(page, "ZZ Rent");
  await expect(rent).toHaveClass(/is-checked/);
  await expect(page.locator("tr.is-checked")).toHaveCount(1);
  await page.screenshot({ path: "test-results/register-undo-navigate.png" });
});

test("5 a new change disables Redo", async ({ page, request }) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await flag(page, "ZZ Rent", "Red");
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.rent)).toBe("red");
  await realClick(page, undoBtn(page));
  await expect(redoBtn(page)).toBeEnabled();
  await flag(page, "ZZ Gas", "Blue");
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.gas)).toBe("blue");
  await expect(redoBtn(page)).toBeDisabled();
});

test("6 disabled states and reload", async ({ page, request }) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await expect(undoBtn(page)).toBeDisabled();
  await expect(redoBtn(page)).toBeDisabled();
  await expect(undoBtn(page)).not.toHaveAttribute("title", /./);
  await expect(redoBtn(page)).not.toHaveAttribute("title", /./);

  await flag(page, "ZZ Rent", "Red");
  await expect(undoBtn(page)).toBeEnabled();
  await expect(undoBtn(page)).toHaveAttribute("title", UNDO_TIP);
  await expect(redoBtn(page)).toBeDisabled();
  await page.screenshot({ path: "test-results/register-undo-toolbar.png" });

  await openMemo(page, "ZZ Gas");
  await expect(page.getByRole("textbox", { name: "Memo", exact: true })).toBeVisible();
  await expect(undoBtn(page)).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "Memo", exact: true })).toHaveCount(0);
  await expect(undoBtn(page)).toBeEnabled();

  await realClick(page, undoBtn(page));
  await expect(redoBtn(page)).toBeEnabled();
  await expect(redoBtn(page)).toHaveAttribute("title", REDO_TIP);
  await flag(page, "ZZ Rent", "Green");
  await page.reload();
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await expect(undoBtn(page)).toBeDisabled();
  await expect(redoBtn(page)).toBeDisabled();
});

test("7 undo after reject brings the import back", async ({ page, request }) => {
  const s = await seedApprove(request);
  const id = s.unapproved[0] as string;
  await stubReject(page, request, s.plan, [id], "delete");
  // Later routes win: this one runs one real bulk delete, so the server holds a change set to undo.
  await page.route(/\/transactions\/reject$/, async (route) => {
    const res = await request.fetch(`/api/v1/budgets/${s.plan}/transactions/bulk`, {
      method: "POST",
      headers: await authHeaders(),
      data: { op: "delete", ids: [id] },
    });
    expect(res.ok()).toBe(true);
    await route.fulfill({
      json: { data: { transactions: [] } },
      headers: { "Budget-Change-Set": res.headers()["budget-change-set"] ?? "" },
    });
  });
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(page.getByRole("region", { name: "New transactions" })).toContainText(BANNER(3));
  const needs = (payee: string) =>
    rowOf(page, payee).getByRole("button", { name: "This transaction needs approval" });
  await realClick(page, needs("ZZ New One"));
  await realClick(
    page,
    page
      .getByRole("menu", { name: "Approval", exact: true })
      .getByRole("menuitem", { name: "Reject Transaction", exact: true }),
  );
  await expect(rowOf(page, "ZZ New One")).toHaveCount(0);
  await expect(undoBtn(page)).toBeEnabled();
  await realClick(page, undoBtn(page));
  await expect
    .poll(async () => (await txs(request, s.plan, s.checking)).some((t) => t.id === id))
    .toBe(true);
  await expect(rowOf(page, "ZZ New One")).toBeVisible();
  await expect(needs("ZZ New One")).toBeVisible();
});

test("8 ctrl+Z in the memo field does not undo", async ({ page, request }) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await flag(page, "ZZ Rent", "Red");
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.rent)).toBe("red");

  await openMemo(page, "ZZ Gas");
  const memo = page.getByRole("textbox", { name: "Memo", exact: true });
  await memo.fill("typed");
  await memo.press("Control+z");
  await page.waitForTimeout(300);
  expect(await flagOf(request, s.plan, s.checking, s.rent)).toBe("red");
  await expect(
    rowOf(page, "ZZ Rent").getByRole("button", { name: "Red", exact: true }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(memo).toHaveCount(0);
  await page.getByRole("heading", { name: "ZZ Checking" }).first().click();
  await page.keyboard.press("Control+z");
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.rent)).toBeNull();
});

test("9 stale undo shows refusal, changes nothing", async ({ page, request }) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await flag(page, "ZZ Rent", "Red");
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.rent)).toBe("red");
  await call(request, "PATCH", `/api/v1/budgets/${s.plan}/transactions/${s.rent}`, {
    memo: "ZZ edited elsewhere",
  });
  await realClick(page, undoBtn(page));
  await expect(page.locator("[data-undo-notice]")).toContainText(
    /changed after this action, so it can't be undone/,
  );
  expect(await flagOf(request, s.plan, s.checking, s.rent)).toBe("red");
  expect(await memoOf(request, s.plan, s.checking, s.rent)).toBe("ZZ edited elsewhere");
  await expect(undoBtn(page)).toBeDisabled();
});

test("10 More menu at 1100px", async ({ page, request }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await flag(page, "ZZ Rent", "Red", false);
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.rent)).toBe("red");
  await expect(undoBtn(page)).toHaveCount(0);
  await realClick(page, toolbar(page).getByRole("button", { name: "More", exact: true }));
  const menu = page.getByRole("menu", { name: "More toolbar actions" });
  const inMenu = menu.getByRole("button", { name: "Undo", exact: true });
  await expect(inMenu).toBeEnabled();
  await expect(inMenu).toHaveAttribute("title", UNDO_TIP);
  await realClick(page, inMenu);
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.rent)).toBeNull();
});
