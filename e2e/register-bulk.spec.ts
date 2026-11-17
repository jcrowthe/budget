import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { accountBalance, accountRows, rewriteList, seedBulk } from "./support/bulk-seed";
import { call, realClick, TODAY } from "./support/register-seed";
import { mmddyyyy } from "./support/scheduled-seed";
import { setViewSettings } from "./support/view-settings";

const rowOf = (page: Page, payee: string) =>
  page.locator(".register-table tbody tr[data-tx]").filter({ hasText: payee });
const box = (page: Page, payee: string) =>
  rowOf(page, payee).getByRole("checkbox", { name: "Select transaction", exact: true });
const bar = (page: Page) => page.getByRole("toolbar", { name: "Selection actions" });
const barButton = (page: Page, name: string) =>
  bar(page).getByRole("button", { name, exact: true });
const balance = (page: Page, key: string) => page.locator(`[data-balance=${key}] .acct-amount`);
const tick = async (page: Page, ...payees: string[]) => {
  for (const p of payees) await realClick(page, box(page, p));
};
const openMore = async (page: Page) => {
  await realClick(page, barButton(page, "More"));
  await expect(page.getByRole("menu", { name: "More actions" })).toBeVisible();
};
const moreItem = (page: Page, name: string) =>
  page.getByRole("menu", { name: "More actions" }).getByRole("menuitem", { name, exact: true });

test("two ticked rows: the bar, its place and the Selected Total (EXF-520 AC1)", async ({
  page,
  request,
}) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await tick(page, "ZZ Pay");
  await expect(barButton(page, "1 Transaction")).toBeVisible();
  await expect(page.locator("[data-balance=selected]")).toHaveCount(0);
  await tick(page, "ZZ Fee");
  await expect(barButton(page, "2 Transactions")).toBeVisible();
  await expect(page.locator("[data-balance=selected] .acct-amount")).toHaveText("$245.50");
  await expect(page.locator("[data-balance=selected] .acct-label")).toHaveText(
    "Selected Total (2)",
  );
  // The bar: background rgb(56,60,163), radius 12px, 48px above the window's bottom, centred over the register
  // (source: All Accounts register, dark, 1600x813, notes 3a).
  const inner = page.locator(".register-action-bar-inner");
  await expect(inner).toHaveCSS("background-color", "rgb(56, 60, 163)");
  await expect(inner).toHaveCSS("border-radius", "12px");
  const b = await inner.boundingBox();
  const reg = await page.locator(".register").boundingBox();
  const vh = page.viewportSize()?.height ?? 0;
  expect(Math.round(vh - ((b?.y ?? 0) + (b?.height ?? 0)))).toBe(48);
  expect(
    Math.abs((b?.x ?? 0) + (b?.width ?? 0) / 2 - ((reg?.x ?? 0) + (reg?.width ?? 0) / 2)),
  ).toBeLessThan(2);
  // The total sits at the right end of the strip, after Working Balance.
  const total = await page.locator("[data-balance=selected]").boundingBox();
  const working = await page.locator("[data-balance=working]").boundingBox();
  expect((total?.x ?? 0) > (working?.x ?? 0) + (working?.width ?? 0)).toBe(true);
});

test("selecting: a row click, the header box, ctrl+A, Escape and leaving (EXF-520)", async ({
  page,
  request,
}) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await realClick(page, rowOf(page, "ZZ Rent").locator("td[data-field=date]"));
  await expect(rowOf(page, "ZZ Rent")).toHaveClass(/is-checked/);
  await expect(page.locator("tr.is-checked")).toHaveCount(1);
  const header = page.getByRole("checkbox", { name: "Select all transactions", exact: true });
  await expect(header).toHaveAttribute("aria-checked", "mixed");
  await tick(page, "ZZ Gas");
  await expect(page.locator("tr.is-checked")).toHaveCount(2);
  // A click on one of several selected rows selects only that row.
  await realClick(page, rowOf(page, "ZZ Rent").locator("td[data-field=date]"));
  await expect(page.locator("tr.is-checked")).toHaveCount(1);
  await page.keyboard.press("Control+a");
  await expect(header).toHaveAttribute("aria-checked", "true");
  await expect(barButton(page, "5 Transactions")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bar(page)).toHaveCount(0);
  await expect(header).toHaveAttribute("aria-checked", "false");
  await realClick(page, header);
  await expect(barButton(page, "5 Transactions")).toBeVisible();
  await realClick(page, header);
  await expect(bar(page)).toHaveCount(0);
  // Leaving for another account and coming back shows nothing selected.
  await tick(page, "ZZ Pay");
  await realClick(
    page,
    page.getByRole("navigation", { name: "Sidebar" }).getByRole("link", { name: /ZZ Savings/ }),
  );
  await expect(page.getByRole("heading", { name: "ZZ Savings" })).toBeVisible();
  await realClick(
    page,
    page.getByRole("navigation", { name: "Sidebar" }).getByRole("link", { name: /ZZ Checking/ }),
  );
  await expect(rowOf(page, "ZZ Pay")).toBeVisible();
  await expect(page.locator("tr.is-checked")).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
});

test("C clears two uncleared rows and C again unclears them (EXF-520 AC2)", async ({
  page,
  request,
}) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(balance(page, "cleared")).toHaveText("$901.00");
  await expect(balance(page, "uncleared")).toHaveText("−$160.00");
  await tick(page, "ZZ Rent", "ZZ Gas");
  await expect(barButton(page, "Clear")).toBeVisible();
  await page.keyboard.press("c");
  await expect(balance(page, "cleared")).toHaveText("$741.00");
  await expect(balance(page, "uncleared")).toHaveText("$0.00");
  await expect(balance(page, "working")).toHaveText("$741.00");
  // Now every selected row is cleared: the Clear button goes and More offers "Mark as Uncleared".
  await expect(barButton(page, "Clear")).toHaveCount(0);
  await openMore(page);
  await expect(moreItem(page, "Mark as Uncleared")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  await expect(balance(page, "cleared")).toHaveText("$901.00");
  await expect(balance(page, "uncleared")).toHaveText("−$160.00");
});

test("Memo sets both memos (EXF-520 AC3)", async ({ page, request }) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await tick(page, "ZZ Rent", "ZZ Gas");
  await openMore(page);
  await realClick(page, moreItem(page, "Memo..."));
  const dialog = page.getByRole("dialog", { name: "Edit Memo (2 Transactions)" });
  await expect(dialog).toBeVisible();
  const update = dialog.getByRole("button", { name: "Update 2 Transactions", exact: true });
  await expect(update).toBeDisabled();
  const input = dialog.getByLabel("Memo");
  await expect(input).toHaveAttribute("placeholder", "Enter a memo for selected transactions");
  // A Cancel keeps the memos.
  await realClick(page, dialog.getByRole("button", { name: "Cancel", exact: true }));
  await expect(dialog).toHaveCount(0);
  await openMore(page);
  await realClick(page, moreItem(page, "Memo..."));
  await input.fill("x");
  await expect(update).toBeEnabled();
  await realClick(page, update);
  await expect
    .poll(async () =>
      (await accountRows(request, s.plan, s.checking))
        .filter((t) => t.id === s.rent || t.id === s.gas)
        .map((t) => t.memo),
    )
    .toEqual(["x", "x"]);
  await page.reload();
  await expect(rowOf(page, "ZZ Rent").locator("td[data-field=memo]")).toHaveText("x");
  await expect(rowOf(page, "ZZ Gas").locator("td[data-field=memo]")).toHaveText("x");
});

test("shift+D copies a cleared row and selects the copy (EXF-520 AC4)", async ({
  page,
  request,
}) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await tick(page, "ZZ Pay");
  await page.keyboard.press("Shift+D");
  await expect(rowOf(page, "ZZ Pay")).toHaveCount(2);
  const copies = (await accountRows(request, s.plan, s.checking)).filter(
    (t) => t.payee_name === "ZZ Pay",
  );
  expect(copies).toHaveLength(2);
  expect(copies.every((t) => t.cleared === "cleared" && t.amount === 250000)).toBe(true);
  const copy = copies.find((t) => t.id !== s.pay);
  await expect(page.locator("tr.is-checked")).toHaveCount(1);
  await expect(page.locator(`tr[data-tx="${copy?.id}"]`)).toHaveClass(/is-checked/);
  await expect(barButton(page, "1 Transaction")).toBeVisible();
});

test("Move to Account moves a row and both balances follow (EXF-520 AC5)", async ({
  page,
  request,
}) => {
  const s = await seedBulk(request);
  const checking0 = await accountBalance(request, s.plan, s.checking);
  const savings0 = await accountBalance(request, s.plan, s.savings);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await tick(page, "ZZ Fee");
  await openMore(page);
  await realClick(page, moreItem(page, "Move to Account"));
  const sub = page.getByRole("menu", { name: "Move to Account", exact: true });
  await expect(sub.getByRole("menuitem")).toHaveText(["ZZ Savings", "ZZ Asset"]);
  await realClick(page, sub.getByRole("menuitem", { name: "ZZ Savings", exact: true }));
  await expect(rowOf(page, "ZZ Fee")).toHaveCount(0);
  await expect.poll(() => accountBalance(request, s.plan, s.checking)).toBe(checking0 + 4500);
  await expect.poll(() => accountBalance(request, s.plan, s.savings)).toBe(savings0 - 4500);
  const moved = (await accountRows(request, s.plan, s.savings)).find((t) => t.id === s.fee);
  expect(moved?.cleared).toBe("cleared");
});

test("a tracking account row cannot take a category: the refusal is readable (Lead AC11)", async ({
  page,
  request,
}) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await tick(page, "ZZ Fee");
  await openMore(page);
  await realClick(page, moreItem(page, "Move to Account"));
  await realClick(
    page,
    page
      .getByRole("menu", { name: "Move to Account", exact: true })
      .getByRole("menuitem", { name: "ZZ Asset", exact: true }),
  );
  // EXF-637: the alert names the row (payee, date, amount), never its id.
  const alert = page.getByRole("alert").filter({ hasText: "tracking account" });
  await expect(alert).toHaveText(
    `ZZ Fee on ${mmddyyyy(TODAY)} (−$4.50): ZZ Asset is a tracking account, so its transactions can't have a category. Remove the category first.`,
  );
  expect(await alert.textContent()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  await expect(rowOf(page, "ZZ Fee")).toHaveCount(1);
  expect((await accountRows(request, s.plan, s.checking)).some((t) => t.id === s.fee)).toBe(true);
});

test("Export downloads the CSV, and Don't show again skips the dialog (EXF-520 AC6, EXF-522 AC5)", async ({
  page,
  request,
}) => {
  const s = await seedBulk(request);
  await call(request, "PATCH", `/api/v1/budgets/${s.plan}/transactions/${s.pay}`, {
    flag_color: "red",
  });
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await tick(page, "ZZ Pay", "ZZ Fee");
  await openMore(page);
  await realClick(page, moreItem(page, "Export 2 Transactions"));
  const dialog = page.getByRole("dialog", { name: "Export Transactions" });
  await expect(dialog).toContainText(
    "Your data is just that—yours! All the requested data will be exported in CSV format so it's easy to open in other applications.",
  );
  await realClick(page, dialog.getByRole("checkbox", { name: "Don't show again" }));
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    realClick(page, dialog.getByRole("button", { name: "Export", exact: true })),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^Selected Transactions for ZZ-TEST bulk .+ as of \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.csv$/,
  );
  const lines = readFileSync(await download.path(), "utf8")
    .replace(/^﻿/, "")
    .split("\n");
  expect(lines[0]).toBe(
    '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
  );
  expect(lines.filter((l) => l.includes('"ZZ Pay"'))[0]).toContain('"Red"');
  expect(lines.filter((l) => l.includes('"ZZ Fee"'))[0]).toContain('"$4.50"');
  // The next export has no dialog.
  await openMore(page);
  const [second] = await Promise.all([
    page.waitForEvent("download"),
    realClick(page, moreItem(page, "Export 2 Transactions")),
  ]);
  expect(second.suggestedFilename()).toMatch(/^Selected Transactions for /);
  await expect(page.getByRole("dialog", { name: "Export Transactions" })).toHaveCount(0);
});

test("Delete removes ordinary rows at once, by the key and by the menu (EXF-520 AC7)", async ({
  page,
  request,
}) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await tick(page, "ZZ Fee");
  await page.keyboard.press("Delete");
  await expect(rowOf(page, "ZZ Fee")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await tick(page, "ZZ Gas");
  await openMore(page);
  await realClick(page, moreItem(page, "Delete"));
  await expect(rowOf(page, "ZZ Gas")).toHaveCount(0);
  await expect(bar(page)).toHaveCount(0);
  await expect
    .poll(async () => (await accountRows(request, s.plan, s.checking)).map((t) => t.id))
    .not.toEqual(expect.arrayContaining([s.fee]));
  const left = (await accountRows(request, s.plan, s.checking)).map((t) => t.id);
  expect(left).not.toContain(s.gas);
  expect(left).toContain(s.pay);
});

test("a reconciled row asks first; Delete sends confirm_reconciled (EXF-520 AC7)", async ({
  page,
  request,
}) => {
  const s = await seedBulk(request);
  // Reconciled rows are hidden by default (EXF-529): this case shows them first.
  await setViewSettings(request, s.plan, s.checking, { show_reconciled: true });
  await rewriteList(page, (t) => (t.id === s.pay ? { cleared: "reconciled" } : null));
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await tick(page, "ZZ Pay");
  await page.keyboard.press("Delete");
  const dialog = page.getByRole("dialog", { name: "Delete Reconciled Transaction?" });
  await expect(dialog).toContainText(
    "Deleting a reconciled transaction will bring the reconciliation out of balance.",
  );
  await realClick(page, dialog.getByRole("button", { name: "Cancel", exact: true }));
  await expect(dialog).toHaveCount(0);
  await expect(rowOf(page, "ZZ Pay")).toHaveCount(1);
  await page.keyboard.press("Delete");
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith("/transactions/bulk")),
    realClick(page, dialog.getByRole("button", { name: "Delete", exact: true })),
  ]);
  expect(req.postDataJSON()).toEqual({ op: "delete", ids: [s.pay], confirm_reconciled: true });
  await expect
    .poll(async () => (await accountRows(request, s.plan, s.checking)).some((t) => t.id === s.pay))
    .toBe(false);
});

test("deleting one side of a transfer from the bar removes both sides (Lead AC9)", async ({
  page,
  request,
}) => {
  const s = await seedBulk(request);
  const t = await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.checking,
    date: new Date().toISOString().slice(0, 10),
    amount: -30000,
    transfer_account_id: s.savings,
  });
  const other = t.transaction.transfer_transaction_id as string;
  const savings0 = await accountBalance(request, s.plan, s.savings);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const row = page.locator(`tr[data-tx="${t.transaction.id}"]`);
  await expect(row).toBeVisible();
  await realClick(page, row.getByRole("checkbox", { name: "Select transaction", exact: true }));
  await page.keyboard.press("Delete");
  await expect(row).toHaveCount(0);
  await expect
    .poll(async () => (await accountRows(request, s.plan, s.savings)).some((x) => x.id === other))
    .toBe(false);
  expect(await accountBalance(request, s.plan, s.savings)).toBe(savings0 - 30000);
});

test("Approve and Reject show only for unapproved imports (Lead AC12)", async ({
  page,
  request,
}) => {
  const s = await seedBulk(request);
  await rewriteList(page, (t) =>
    t.id === s.rent ? { approved: false, import_id: "zz-imp-1", source: "plaid" } : null,
  );
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await tick(page, "ZZ Pay");
  await expect(barButton(page, "Approve")).toHaveCount(0);
  await expect(barButton(page, "Reject")).toHaveCount(0);
  await tick(page, "ZZ Rent");
  await expect(barButton(page, "Approve")).toBeVisible();
  // An approved row is selected too: Reject is not offered.
  await expect(barButton(page, "Reject")).toHaveCount(0);
  await realClick(page, box(page, "ZZ Pay"));
  await expect(barButton(page, "Reject")).toBeVisible();
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith("/transactions/approve")),
    realClick(page, barButton(page, "Approve")),
  ]);
  expect(req.postDataJSON()).toEqual({ ids: [s.rent] });
});

test("at 1024x700 the last row stays reachable under the bar (Lead AC13)", async ({
  page,
  request,
}) => {
  const s = await seedBulk(request);
  for (let i = 0; i < 25; i++)
    await s.add(`ZZ Row ${String(i).padStart(2, "0")}`, -1000, "cleared");
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const rows = page.locator(".register-table tbody tr[data-tx]");
  await expect(rows).toHaveCount(30);
  await realClick(page, box(page, "ZZ Pay"));
  await expect(bar(page)).toBeVisible();
  await page.locator(".main").evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const last = rows.last();
  await realClick(page, last.getByRole("checkbox", { name: "Select transaction", exact: true }));
  await expect(barButton(page, "2 Transactions")).toBeVisible();
  await realClick(page, last.getByRole("button", { name: "Flag", exact: true }));
  await expect(page.getByRole("menu", { name: "Flags" })).toBeVisible();
});

test("the More menu for one row and for several (Lead)", async ({ page, request }) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await tick(page, "ZZ Pay");
  await openMore(page);
  const items = page.getByRole("menu", { name: "More actions" }).getByRole("menuitem");
  await expect(items).toHaveText([
    "Mark as UnclearedC",
    "MatchM",
    "UnmatchshiftU",
    "DuplicateshiftD",
    "Make RepeatingshiftT",
    "Memo...",
    // EXF-636 (departure from EXF-520): All Accounts lists Move to Account too.
    "Move to Account",
    "Export 1 Transaction",
    "Deletedelete",
  ]);
  for (const [name, ticket] of [
    ["Match", "EXF-464"],
    ["Unmatch", "EXF-464"],
    ["Make Repeating", "EXF-503"],
  ] as const) {
    await expect(moreItem(page, name)).toHaveAttribute("aria-disabled", "true");
    await expect(moreItem(page, name)).toHaveAttribute("data-ticket", ticket);
  }
  await page.keyboard.press("Escape");
  await tick(page, "ZZ Fee");
  await openMore(page);
  await expect(moreItem(page, "Make Repeating")).toHaveCount(0);
  await expect(moreItem(page, "Export 2 Transactions")).toBeVisible();
  // EXF-636 (departure from EXF-520): All Accounts offers Move to Account too.
  await expect(moreItem(page, "Move to Account")).toHaveCount(1);
});
