import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { accountOf, readyToAssign, rowsOf, seedWorked } from "./support/reconcile-seed";
import { call, realClick } from "./support/register-seed";

// EXF-533. Nobody opened the source app for this feature: every screen here is built from the ticket's text and
// is "not compared" with the source.

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const popover = (page: Page) => page.getByRole("dialog", { name: "Reconcile", exact: true });
const bar = (page: Page) => page.getByRole("region", { name: "Reconciliation", exact: true });
const row = (page: Page, text: string) =>
  page.locator(".register-table tbody tr[data-tx]").filter({ hasText: text });
const head = (page: Page) => page.locator(".acct-head");
const amount = (page: Page, key: string) => page.locator(`[data-balance=${key}] .acct-amount`);
const header = (page: Page) =>
  page.getByRole("main").getByRole("button", { name: "Reconcile", exact: true });

async function goto(page: Page, plan: string, account: string) {
  await page.goto(`/${plan}/accounts/${account}`);
  await expect(button(page, "Add Transaction")).toBeVisible();
}

/** Reconcile → No → the typed bank balance → Enter. */
async function enterBalance(page: Page, text: string) {
  await realClick(page, header(page));
  await realClick(page, button(page, "No"));
  await expect(popover(page).getByText("Current balance at your bank")).toBeVisible();
  await expect(
    popover(page).getByRole("textbox", { name: "Current balance at your bank" }),
  ).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

const reconciledCount = async (request: Parameters<typeof call>[0], plan: string, id: string) =>
  (await rowsOf(request, plan, id)).filter((r) => r.cleared === "reconciled").length;

test("the popover, its tooltip, shift+E, Escape, and no button on All Accounts (AC1)", async ({
  page,
  request,
}) => {
  const w = await seedWorked(request);
  await goto(page, w.plan, w.checking);
  await header(page).hover();
  await expect(page.getByRole("tooltip")).toHaveText("ReconcileshiftE");
  await realClick(page, header(page));
  const p = popover(page);
  await expect(p.getByText("Is your current balance")).toBeVisible();
  await expect(p.getByText("$755.50?")).toBeVisible();
  await expect(p.getByRole("link")).toHaveCount(0);
  await expect(p.getByRole("button", { name: "No", exact: true })).toBeVisible();
  await expect(p.getByRole("button", { name: "Yes", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(p).toHaveCount(0);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Shift+E");
  await expect(p.getByText("$755.50?")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto(`/${w.plan}/accounts`);
  await expect(page.getByRole("heading", { name: "All Accounts" })).toBeVisible();
  await expect(button(page, "Reconcile")).toHaveCount(0);
  await page.keyboard.press("Shift+E");
  await expect(popover(page)).toHaveCount(0);
});

test("Yes reconciles at once: the art, the lock and the header label (AC2)", async ({
  page,
  request,
}) => {
  const w = await seedWorked(request);
  await goto(page, w.plan, w.savings);
  await expect(head(page).getByText("Not Yet Reconciled")).toBeVisible();
  await realClick(page, header(page));
  await realClick(page, button(page, "Yes"));
  const p = popover(page);
  await expect(p.getByText("Account reconciled")).toBeVisible();
  await expect(p.getByText("Time for the reconciliation dance!")).toBeVisible();
  await expect(p.locator("svg.reconcile-art")).toBeVisible();
  await expect(
    row(page, "Starting Balance").locator(".cleared-button.is-reconciled"),
  ).toBeVisible();
  const label = head(page).getByText(/^Reconciled a few seconds ago$/);
  await expect(label).toBeVisible();
  await expect(head(page).locator(".acct-info-item[title]")).toHaveAttribute(
    "title",
    /^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} (AM|PM)$/,
  );
  await expect
    .poll(async () => (await accountOf(request, w.plan, w.savings)).last_reconciled_at)
    .not.toBeNull();
  expect(
    (await rowsOf(request, w.plan, w.savings)).find((r) => r.payee_name === "Starting Balance")
      ?.cleared,
  ).toBe("reconciled");
});

test("No: the difference, the live bar, finish, edit a locked row, the adjustment and the lock (AC3-AC7)", async ({
  page,
  request,
}) => {
  const w = await seedWorked(request);
  await goto(page, w.plan, w.checking);
  await enterBalance(page, "655.50");
  const modal = page.getByRole("dialog", { name: "Reconcile", exact: true });
  await expect(modal.getByText("−$100.00")).toBeVisible();
  await expect(modal.getByText("Difference", { exact: true }).first()).toBeVisible();
  await expect(
    modal.getByText(
      "The balance recorded in Budget doesn’t match the balance at your financial institution.",
    ),
  ).toBeVisible();
  await expect(
    modal.getByText(/^To correct this, compare each unlocked transaction in Budget/),
  ).toBeVisible();
  await expect(
    modal.getByText(
      "If you can’t find the difference, that’s okay! We’ll make an adjustment transaction and you can move on.",
    ),
  ).toBeVisible();
  await expect(modal.getByText("Don’t Show Again")).toBeVisible();
  await realClick(page, modal.getByRole("button", { name: "Next", exact: true }));
  await expect(modal).toHaveCount(0);
  await expect(
    bar(page).getByText(
      "This account's cleared balance in Budget is $100.00 higher than your actual account.",
    ),
  ).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await expect(
    bar(page).getByRole("button", { name: "Create Adjustment & Finish", exact: true }),
  ).toBeVisible();
  await expect(header(page)).toBeDisabled();

  // AC4: clear the -100.00 transfer, and unclear/clear ZZ Fuel: the bar follows both ways.
  const clearedBtn = (text: string) => row(page, text).locator(".cleared-button");
  await realClick(page, row(page, "Transfer").first().locator(".cleared-button"));
  await expect(amount(page, "cleared")).toHaveText("$655.50");
  await expect(amount(page, "uncleared")).toHaveText("−$160.00");
  await expect(
    bar(page).getByText(
      "This account's cleared balance in Budget is the same as your actual account.",
    ),
  ).toBeVisible();
  await expect(
    bar(page).getByRole("button", { name: "Finish Reconciliation", exact: true }),
  ).toBeVisible();
  await realClick(page, clearedBtn("ZZ Fuel"));
  await expect(bar(page).getByText(/\$20\.00 higher than your actual account\.$/)).toBeVisible();
  await realClick(page, clearedBtn("ZZ Fuel"));
  await expect(bar(page).getByText(/is the same as your actual account\.$/)).toBeVisible();
  await realClick(
    page,
    bar(page).getByRole("button", { name: "Finish Reconciliation", exact: true }),
  );
  await expect(bar(page)).toHaveCount(0);
  await expect.poll(() => reconciledCount(request, w.plan, w.checking)).toBe(7);
  await expect(page.locator(".cleared-button.is-reconciled")).toHaveCount(7);
  await expect(head(page).getByText("Reconciled a few seconds ago")).toBeVisible();

  // AC7: a lock does nothing.
  const lock = row(page, "ZZ Refund").locator(".cleared-button");
  await expect(lock).toHaveAttribute("title", "This transaction is reconciled");
  let sent = false;
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/transactions")) sent = true;
  });
  await lock.click({ force: true });
  await page.waitForTimeout(500);
  expect(sent).toBe(false);
  expect((await rowsOf(request, w.plan, w.checking)).find((r) => r.id === w.refund)?.cleared).toBe(
    "reconciled",
  );

  // AC6: an amount change asks; Cancel keeps the editor open; Save writes and keeps the lock.
  await realClick(page, row(page, "ZZ Refund").locator("td[data-field=payee]"));
  await realClick(page, row(page, "ZZ Refund").locator("td[data-field=payee]"));
  const inflow = page.getByRole("textbox", { name: "Inflow", exact: true });
  await expect(inflow).toBeVisible();
  await inflow.fill("35.00");
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("dialog", {
    name: "Save Changes to Reconciled Transaction",
    exact: true,
  });
  await expect(
    confirm.getByText(
      "Saving your changes to this reconciled transaction may bring your reconciliation out of balance.",
    ),
  ).toBeVisible();
  await realClick(page, confirm.getByRole("button", { name: "Cancel", exact: true }));
  await expect(confirm).toHaveCount(0);
  await expect(inflow).toBeVisible();
  expect((await accountOf(request, w.plan, w.checking)).cleared_balance).toBe(655500);
  await inflow.press("Enter");
  await realClick(page, confirm.getByRole("button", { name: "Save", exact: true }));
  await expect
    .poll(async () => (await accountOf(request, w.plan, w.checking)).cleared_balance)
    .toBe(660500);
  await expect(amount(page, "cleared")).toHaveText("$660.50");
  await expect(row(page, "ZZ Refund").locator(".cleared-button.is-reconciled")).toBeVisible();

  // A memo-only change saves with no modal.
  // The saved row is still selected: one click opens it.
  await realClick(page, row(page, "ZZ Refund").locator("td[data-field=payee]"));
  await page.getByRole("textbox", { name: "Memo", exact: true }).fill("ZZ memo only");
  await page.keyboard.press("Enter");
  await expect(confirm).toHaveCount(0);
  await expect(row(page, "ZZ memo only")).toBeVisible();

  // AC5: the $5.00 adjustment.
  const rtaBefore = await readyToAssign(request, w.plan);
  await enterBalance(page, "655.50");
  const m2 = page.getByRole("dialog", { name: "Reconcile", exact: true });
  await expect(m2.getByText("−$5.00")).toBeVisible();
  await realClick(page, m2.getByRole("button", { name: "Next", exact: true }));
  await expect(bar(page).getByText(/\$5\.00 higher than your actual account\.$/)).toBeVisible();
  await realClick(
    page,
    bar(page).getByRole("button", { name: "Create Adjustment & Finish", exact: true }),
  );
  await expect(bar(page)).toHaveCount(0);
  const adj = row(page, "Reconciliation Balance Adjustment");
  await expect(adj).toBeVisible();
  await expect(adj).toContainText("Inflow: Ready to Assign");
  await expect(adj).toContainText("Entered automatically by Budget");
  await expect(adj.locator(".cleared-button.is-reconciled")).toBeVisible();
  await expect(amount(page, "cleared")).toHaveText("$655.50");
  await expect(amount(page, "working")).toHaveText("$495.50");
  const found = (await rowsOf(request, w.plan, w.checking)).find(
    (r) => r.payee_name === "Reconciliation Balance Adjustment",
  );
  expect(found).toMatchObject({ amount: -5000, cleared: "reconciled" });
  expect(await readyToAssign(request, w.plan)).toBe(rtaBefore - 5000);
});

test("lower than, Cancel writes nothing, Don’t Show Again, and the matching balance (cases 8-10)", async ({
  page,
  request,
}) => {
  const w = await seedWorked(request);
  await call(request, "PATCH", `/api/v1/budgets/${w.plan}/transactions/${w.transfer}`, {
    cleared: "cleared",
  });
  await goto(page, w.plan, w.checking);
  await enterBalance(page, "800.00");
  const modal = page.getByRole("dialog", { name: "Reconcile", exact: true });
  await expect(modal.getByText("$144.50", { exact: true })).toBeVisible();
  await realClick(page, modal.getByRole("button", { name: "Next", exact: true }));
  await expect(
    bar(page).getByText(
      "This account's cleared balance in Budget is $144.50 lower than your actual account.",
    ),
  ).toBeVisible();
  await realClick(page, bar(page).getByRole("button", { name: "Cancel", exact: true }));
  await expect(bar(page)).toHaveCount(0);
  expect((await accountOf(request, w.plan, w.checking)).last_reconciled_at).toBeNull();
  expect(await reconciledCount(request, w.plan, w.checking)).toBe(0);

  // Case 9: Don’t Show Again.
  await enterBalance(page, "600.00");
  await modal.getByLabel("Don’t Show Again").check();
  await realClick(page, modal.getByRole("button", { name: "Next", exact: true }));
  await expect(bar(page)).toBeVisible();
  await realClick(page, bar(page).getByRole("button", { name: "Cancel", exact: true }));
  await expect
    .poll(async () => (await call(request, "GET", `/api/v1/budgets/${w.plan}/ui-state`)).ui_state)
    .toMatchObject({ hide_reconcile_difference_dialog: true });
  await enterBalance(page, "600.00");
  await expect(bar(page)).toBeVisible();
  await expect(modal).toHaveCount(0);
  await realClick(page, bar(page).getByRole("button", { name: "Cancel", exact: true }));

  // Case 10: the exact cleared balance goes straight to "the same".
  await enterBalance(page, "655.50");
  await expect(modal).toHaveCount(0);
  await expect(bar(page).getByText(/is the same as your actual account\.$/)).toBeVisible();
  await expect(
    bar(page).getByRole("button", { name: "Finish Reconciliation", exact: true }),
  ).toBeVisible();
});

test("a closed account's Reconcile button is disabled, and shift+E opens nothing (case 16)", async ({
  page,
  request,
}) => {
  const w = await seedWorked(request);
  // Close Savings (the transfer's other side is uncleared, its balance is moved out by the close).
  await call(request, "POST", `/api/v1/budgets/${w.plan}/accounts/${w.savings}/close`);
  await goto(page, w.plan, w.savings);
  await expect(header(page)).toBeDisabled();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Shift+E");
  await expect(popover(page)).toHaveCount(0);
  // The server agrees: decision A, 422 account_closed.
  const res = await request.post(`/api/v1/budgets/${w.plan}/accounts/${w.savings}/reconcile`, {
    data: { statement_balance: 0 },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error.name).toBe("account_closed");
});
