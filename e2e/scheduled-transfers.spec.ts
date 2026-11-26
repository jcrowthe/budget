import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { realClick } from "./support/register-seed";
import { createSched, fixClock, listSched, mmddyyyy, schedStatus } from "./support/scheduled-seed";
import { realRowsOf, seedTwo } from "./support/scheduled-transfers-seed";

// EXF-501 part 1: a scheduled transaction can be a transfer. The browser's clock is fixed at 2026-11-15.
const DAY = "2026-11-15";
const FIRST = "2026-12-01";
const NEXT = "2027-01-01";
const MEMO = "ZZ-TEST move";

type Plan = Awaited<ReturnType<typeof seedTwo>>;

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const date = (page: Page) => page.getByRole("textbox", { name: "Date", exact: true });
const payee = (page: Page) => page.getByRole("combobox", { name: "Payee", exact: true });
const category = (page: Page) => page.getByRole("combobox", { name: "Category", exact: true });
const memo = (page: Page) => page.getByRole("textbox", { name: "Memo", exact: true });
const outflow = (page: Page) => page.getByRole("textbox", { name: "Outflow", exact: true });
const repeat = (page: Page) => page.getByRole("combobox", { name: "Repeat", exact: true });
const bar = (page: Page) => page.getByRole("toolbar", { name: "Selection actions" });
const schedRows = (page: Page) => page.locator("tr[data-scheduled]");
const schedRow = (page: Page, text: string) => schedRows(page).filter({ hasText: text });
const realRow = (page: Page, text: string) =>
  page.locator(".register-table tbody tr[data-tx]").filter({ hasText: text });

const open = async (page: Page, path: string) => {
  await fixClock(page, DAY);
  await page.goto(path);
  await expect(button(page, "Add Transaction")).toBeVisible();
};
const accountPage = (p: Plan, id: string) => `/${p.plan}/accounts/${id}`;

async function seededTransfer(request: Parameters<typeof seedTwo>[0]) {
  const p = await seedTwo(request);
  const made = await createSched(request, p.plan, DAY, {
    account_id: p.checking,
    transfer_account_id: p.savings,
    date_first: FIRST,
    frequency: "monthly",
    amount: -100000,
    memo: MEMO,
  });
  return { ...p, id: made.scheduled_transaction.id };
}

const select = async (page: Page, row: ReturnType<typeof schedRow>) => {
  await realClick(page, row.locator("td[data-field=date]"));
  await expect(
    row.getByRole("checkbox", { name: "Select transaction", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
};
const enterNow = (page: Page) =>
  realClick(page, bar(page).getByRole("button", { name: "Enter Now", exact: true }));
const del = async (page: Page) => {
  await realClick(page, bar(page).getByRole("button", { name: "More", exact: true }));
  await realClick(
    page,
    page
      .getByRole("menu", { name: "More actions" })
      .getByRole("menuitem", { name: "Delete", exact: true }),
  );
};

test("AC4: a transfer picked in the add row is scheduled in one account and mirrored in the other", async ({
  page,
  request,
}) => {
  const p = await seedTwo(request);
  await open(page, accountPage(p, p.checking));
  await realClick(page, button(page, "Add Transaction"));
  await expect(date(page)).toBeFocused();
  await date(page).fill(mmddyyyy(FIRST));
  await repeat(page).selectOption("monthly");
  await payee(page).fill("ZZ-TEST Sav");
  await expect(
    page.getByRole("option", { name: "To/From ZZ-TEST Savings", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(payee(page)).toHaveValue(/ZZ-TEST Savings/);
  await expect(category(page)).toBeDisabled();
  await expect(category(page)).toHaveAttribute("placeholder", "Category not needed");
  await memo(page).fill(MEMO);
  await outflow(page).fill("100.00");
  await memo(page).focus();
  await realClick(page, button(page, "Save"));

  const series = schedRow(page, "Transfer: ZZ-TEST Savings");
  await expect(series).toHaveCount(1);
  await expect(series).toContainText("Category not needed");
  await expect(series).toContainText("100.00");
  await expect(series).toContainText(mmddyyyy(FIRST));
  await expect(series.getByRole("img", { name: /Monthly/i })).toBeVisible();

  const [row] = await listSched(request, p.plan, p.savings);
  expect(row).toMatchObject({ mirror: true, amount: 100000, memo: MEMO });

  await page.goto(accountPage(p, p.savings));
  const mirror = schedRow(page, "Transfer: ZZ-TEST Checking");
  await expect(mirror).toHaveCount(1);
  await expect(mirror).toContainText("Category not needed");
  await expect(mirror).toContainText(MEMO);
  await expect(mirror).toContainText(mmddyyyy(FIRST));
  await expect(mirror.locator("td[data-field=inflow]")).toHaveText("$100.00");
  // The mirror is read-only: clicking it twice opens no editor.
  await realClick(page, mirror.locator("td[data-field=memo]"));
  await realClick(page, mirror.locator("td[data-field=memo]"));
  await expect(date(page)).toHaveCount(0);
  // Its jump button names where the series lives and goes there, with the series selected.
  await realClick(
    page,
    mirror.getByRole("button", { name: "Click to edit this schedule in ZZ-TEST Checking" }),
  );
  await expect(page).toHaveURL(new RegExp(`/accounts/${p.checking}$`));
  await expect(schedRow(page, "Transfer: ZZ-TEST Savings").getByRole("checkbox")).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

for (const side of ["Checking", "Savings"] as const) {
  test(`AC5: Enter Now from ${side} makes both real rows, linked, dated today, and advances`, async ({
    page,
    request,
  }) => {
    const p = await seededTransfer(request);
    const from = side === "Checking" ? p.checking : p.savings;
    await open(page, accountPage(p, from));
    const label = side === "Checking" ? "Transfer: ZZ-TEST Savings" : "Transfer: ZZ-TEST Checking";
    await select(page, schedRow(page, label));
    await enterNow(page);
    await expect.poll(async () => (await realRowsOf(request, p.plan, p.checking)).length).toBe(1);
    const a = (await realRowsOf(request, p.plan, p.checking)).find((t) => t.date === DAY);
    const b = (await realRowsOf(request, p.plan, p.savings)).find((t) => t.date === DAY);
    expect(a).toMatchObject({ amount: -100000, transfer_account_id: p.savings });
    expect(b).toMatchObject({ amount: 100000, transfer_account_id: p.checking });
    expect(a?.transfer_transaction_id).toBe(b?.id);
    expect(b?.transfer_transaction_id).toBe(a?.id);
    for (const s of [p.checking, p.savings]) {
      const [row] = await listSched(request, p.plan, s);
      expect(row?.date_next).toBe(NEXT);
    }
    // Both registers show the real row dated today and the schedule at its next date.
    await expect(realRow(page, mmddyyyy(DAY))).toHaveCount(1);
    await expect(schedRows(page).first()).toContainText(mmddyyyy(NEXT));
    await realClick(
      page,
      realRow(page, mmddyyyy(DAY)).getByRole("button", { name: /jump to the other side/ }),
    );
    await expect(page).toHaveURL(
      new RegExp(`/accounts/${side === "Checking" ? p.savings : p.checking}$`),
    );
    await expect(realRow(page, mmddyyyy(DAY))).toHaveCount(1);
    await expect(schedRows(page).first()).toContainText(mmddyyyy(NEXT));
  });
}

for (const side of ["Checking", "Savings"] as const) {
  test(`AC6: Delete from ${side} removes the scheduled transfer from both registers`, async ({
    page,
    request,
  }) => {
    const p = await seededTransfer(request);
    const from = side === "Checking" ? p.checking : p.savings;
    await open(page, accountPage(p, from));
    await select(page, schedRows(page).first());
    await del(page);
    await expect(schedRows(page)).toHaveCount(0);
    expect(await schedStatus(request, p.plan, p.id)).toBe(404);
    for (const id of [p.checking, p.savings]) {
      await page.goto(accountPage(p, id));
      await expect(button(page, "Add Transaction")).toBeVisible();
      await expect(schedRows(page)).toHaveCount(0);
    }
  });
}

test("All Accounts lists both rows; selecting both and Enter Now enters one pair", async ({
  page,
  request,
}) => {
  const p = await seededTransfer(request);
  await open(page, `/${p.plan}/accounts`);
  await expect(schedRows(page)).toHaveCount(2);
  await expect(page.locator(`tr[data-scheduled="${p.id}"]`)).toHaveCount(1);
  await expect(page.locator(`tr[data-scheduled="mirror:${p.id}"]`)).toHaveCount(1);
  await realClick(page, page.locator(`tr[data-scheduled="${p.id}"]`).getByRole("checkbox"));
  await realClick(page, page.locator(`tr[data-scheduled="mirror:${p.id}"]`).getByRole("checkbox"));
  await enterNow(page);
  await expect.poll(async () => (await realRowsOf(request, p.plan, p.checking)).length).toBe(1);
  expect(await realRowsOf(request, p.plan, p.savings)).toHaveLength(1);
  const entered = (await realRowsOf(request, p.plan, p.checking)).filter((t) => t.date === DAY);
  expect(entered).toHaveLength(1);
  expect((await listSched(request, p.plan, p.checking))[0]?.date_next).toBe(NEXT);
});
