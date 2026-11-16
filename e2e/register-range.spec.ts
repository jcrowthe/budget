import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { CLOCK, fixCardClock, seedCard } from "./support/card-seed";
import { call, realClick } from "./support/register-seed";
import { createSched } from "./support/scheduled-seed";

// EXF-635 (ranges), EXF-636 (Move on All Accounts). The source's All Accounts register ticks rows 2-5 for
// "tick row 2, shift+click row 5's box" (compared, case 22); the Move submenu and the keys are not compared.

const SIZES = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1024x700", width: 1024, height: 700 },
] as const;

const tableRows = (page: Page) => page.locator(".register-table tbody tr[data-tx]");
const rowOf = (page: Page, payee: string) => tableRows(page).filter({ hasText: payee });
const box = (page: Page, payee: string) =>
  rowOf(page, payee).getByRole("checkbox", { name: "Select transaction", exact: true });
const schedRow = (page: Page, payee: string) =>
  page.locator("tr[data-scheduled]").filter({ hasText: payee });
const schedBox = (page: Page, payee: string) =>
  schedRow(page, payee).getByRole("checkbox", { name: "Select transaction", exact: true });
const dateCell = (page: Page, payee: string) => rowOf(page, payee).locator("td[data-field=date]");
const bar = (page: Page) => page.getByRole("toolbar", { name: "Selection actions" });
const countButton = (page: Page, text: string) =>
  bar(page).getByRole("button", { name: text, exact: true });
const ticked = (page: Page) =>
  page.locator("tr[data-tx].is-checked, tr[data-scheduled].is-checked");

/** Shift held while the real mouse clicks. */
async function shiftClick(page: Page, target: import("@playwright/test").Locator) {
  await page.keyboard.down("Shift");
  try {
    await realClick(page, target);
  } finally {
    await page.keyboard.up("Shift");
  }
}
const tickedPayees = (page: Page) =>
  page.locator("tr[data-tx].is-checked td[data-field=payee]").allTextContents();

// Display order, newest first: A -40.00, B -30.00, C -30.00, D -20.00, E -17.34, F -10.00.
const ROWS = [
  ["ZZ A", -40000, "2026-03-10"],
  ["ZZ B", -30000, "2026-03-09"],
  ["ZZ C", -30000, "2026-03-08"],
  ["ZZ D", -20000, "2026-03-07"],
  ["ZZ E", -17340, "2026-03-06"],
  ["ZZ F", -10000, "2026-03-05"],
] as const;

async function seedRows(request: Parameters<typeof call>[0]) {
  const s = await seedCard(request);
  for (const [payee_name, amount, date] of ROWS) {
    await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
      account_id: s.checking,
      date,
      amount,
      payee_name,
    });
  }
  return s;
}

async function openAccount(page: Page, plan: string, account?: string) {
  await fixCardClock(page);
  await page.goto(account ? `/${plan}/accounts/${account}` : `/${plan}/accounts`);
  await expect(page.getByRole("button", { name: "Add Transaction", exact: true })).toBeVisible();
}

for (const size of SIZES) {
  test.describe(`at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("a range follows the display order, a plain click starts over, boxes extend (635 AC1)", async ({
      page,
      request,
    }) => {
      const s = await seedRows(request);
      await openAccount(page, s.plan, s.checking);
      await expect(rowOf(page, "ZZ A")).toBeVisible();
      await realClick(page, dateCell(page, "ZZ F"));
      await shiftClick(page, dateCell(page, "ZZ A"));
      await expect(ticked(page)).toHaveCount(6);
      await expect(countButton(page, "6 Transactions")).toBeVisible();
      await expect(page.locator("[data-balance=selected] .acct-amount")).toHaveText("-$147.34");
      await expect(page.locator("[data-balance=selected] .acct-label")).toHaveText(
        "Selected Total (6)",
      );
      // The shift+click did not open an entry row.
      await expect(page.locator(".entry-body")).toHaveCount(0);

      await realClick(page, dateCell(page, "ZZ C"));
      await expect(ticked(page)).toHaveCount(1);
      await expect(rowOf(page, "ZZ C")).toHaveClass(/is-checked/);

      await page.keyboard.press("Escape");
      await expect(bar(page)).toHaveCount(0);
      await realClick(page, box(page, "ZZ B"));
      await shiftClick(page, box(page, "ZZ E"));
      await expect(ticked(page)).toHaveCount(4);
      await expect(countButton(page, "4 Transactions")).toBeVisible();
      expect((await tickedPayees(page)).sort()).toEqual(["ZZ B", "ZZ C", "ZZ D", "ZZ E"]);

      // A plain box click toggles one row.
      await realClick(page, box(page, "ZZ A"));
      await expect(ticked(page)).toHaveCount(5);
      await realClick(page, box(page, "ZZ A"));
      await expect(ticked(page)).toHaveCount(4);
    });

    test("All Accounts: rows of two accounts; the Scheduled section is its own list (635 AC2)", async ({
      page,
      request,
    }) => {
      const s = await seedCard(request);
      const accounts = [s.checking, s.savings];
      for (let i = 1; i <= 6; i++) {
        await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
          account_id: accounts[i % 2],
          date: `2026-12-0${7 - i}`,
          amount: -1000 * i,
          payee_name: `ZZ Z${i}`,
        });
      }
      for (const [i, d] of ["20", "21", "22"].entries()) {
        await createSched(request, s.plan, CLOCK, {
          account_id: s.checking,
          date_first: `2026-11-${d}`,
          frequency: "never",
          amount: -5000,
          payee_name: `ZZ Plan ${i + 1}`,
        });
      }
      await openAccount(page, s.plan);
      await expect(rowOf(page, "ZZ Z1")).toBeVisible();
      await expect(schedRow(page, "ZZ Plan 1")).toBeVisible();
      // Display order, newest first: Z6 (12-01) is last of the six; Z1 is dated 12-06.
      await realClick(page, box(page, "ZZ Z1"));
      await shiftClick(page, box(page, "ZZ Z4"));
      await expect(ticked(page)).toHaveCount(4);
      expect((await tickedPayees(page)).sort()).toEqual(["ZZ Z1", "ZZ Z2", "ZZ Z3", "ZZ Z4"]);
      await page.keyboard.press("Escape");

      // A scheduled row, then a real row's box with shift: only the real row.
      await realClick(page, schedBox(page, "ZZ Plan 1"));
      await expect(schedRow(page, "ZZ Plan 1")).toHaveClass(/is-checked/);
      await shiftClick(page, box(page, "ZZ Z5"));
      await expect(ticked(page)).toHaveCount(1);
      await expect(rowOf(page, "ZZ Z5")).toHaveClass(/is-checked/);
      await page.keyboard.press("Escape");

      // Two scheduled rows: both, and the one between them.
      await realClick(page, schedBox(page, "ZZ Plan 1"));
      await shiftClick(page, schedBox(page, "ZZ Plan 3"));
      await expect(page.locator("tr[data-scheduled].is-checked")).toHaveCount(3);
      await expect(page.locator("tr[data-tx].is-checked")).toHaveCount(0);
    });
  });
}

test("Shift+arrows grow and shrink the range from the anchor; an open entry row blocks them (635 keys)", async ({
  page,
  request,
}) => {
  const s = await seedRows(request);
  await openAccount(page, s.plan, s.checking);
  await realClick(page, dateCell(page, "ZZ C"));
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(countButton(page, "3 Transactions")).toBeVisible();
  expect((await tickedPayees(page)).sort()).toEqual(["ZZ C", "ZZ D", "ZZ E"]);
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowUp");
  await expect(countButton(page, "2 Transactions")).toBeVisible();
  expect((await tickedPayees(page)).sort()).toEqual(["ZZ B", "ZZ C"]);

  await realClick(page, page.getByRole("button", { name: "Add Transaction", exact: true }));
  await expect(page.locator(".entry-body")).toHaveCount(1);
  await page.keyboard.press("Shift+ArrowDown");
  await expect(ticked(page)).toHaveCount(2);
});

for (const size of SIZES) {
  test(`Move to Account on All Accounts, for rows of different accounts, at ${size.name} (636)`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    const s = await seedCard(request);
    const add = (account: string, payee_name: string, amount: number) =>
      call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
        account_id: account,
        date: "2026-12-01",
        amount,
        payee_name,
      });
    await add(s.checking, "ZZ From Checking", -12000);
    await add(s.savings, "ZZ From Savings", -8000);
    await openAccount(page, s.plan);
    await realClick(page, box(page, "ZZ From Checking"));
    await realClick(page, box(page, "ZZ From Savings"));
    await realClick(page, bar(page).getByRole("button", { name: "More", exact: true }));
    await realClick(
      page,
      page
        .getByRole("menu", { name: "More actions" })
        .getByRole("menuitem", { name: "Move to Account", exact: true }),
    );
    const sub = page.getByRole("menu", { name: "Move to Account", exact: true });
    await expect(sub).toBeVisible();
    // Sidebar order: cash, credit, tracking.
    await expect(sub.getByRole("menuitem")).toHaveText([
      "ZZ-TEST Checking",
      "ZZ-TEST Savings",
      "ZZ-TEST Visa",
      "ZZ-TEST Asset",
    ]);
    const vp = page.viewportSize();
    const r = await sub.boundingBox();
    expect((r?.x ?? -1) >= 0 && (r?.y ?? -1) >= 0).toBe(true);
    expect((r?.x ?? 0) + (r?.width ?? 0) <= (vp?.width ?? 0)).toBe(true);
    expect((r?.y ?? 0) + (r?.height ?? 0) <= (vp?.height ?? 0)).toBe(true);
    await realClick(page, sub.getByRole("menuitem", { name: "ZZ-TEST Visa", exact: true }));
    const visaRows = async () =>
      (await call(request, "GET", `/api/v1/budgets/${s.plan}/accounts/${s.visa}/transactions`))
        .transactions as { payee_name: string | null }[];
    await expect
      .poll(
        async () => (await visaRows()).filter((t) => t.payee_name?.startsWith("ZZ From")).length,
      )
      .toBe(2);
    const bal = async (id: string) =>
      (await call(request, "GET", `/api/v1/budgets/${s.plan}/accounts/${id}`)).account
        .balance as number;
    expect(await bal(s.checking)).toBe(1000000);
    expect(await bal(s.savings)).toBe(500000);
    expect(await bal(s.visa)).toBe(-335000 - 20000);
  });
}

test("with rows of one account selected, that account is absent from the submenu (636)", async ({
  page,
  request,
}) => {
  const s = await seedCard(request);
  await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.checking,
    date: "2026-12-01",
    amount: -12000,
    payee_name: "ZZ Only Checking",
  });
  await openAccount(page, s.plan);
  await realClick(page, box(page, "ZZ Only Checking"));
  await realClick(page, bar(page).getByRole("button", { name: "More", exact: true }));
  await realClick(
    page,
    page
      .getByRole("menu", { name: "More actions" })
      .getByRole("menuitem", { name: "Move to Account", exact: true }),
  );
  const sub = page.getByRole("menu", { name: "Move to Account", exact: true });
  await expect(sub.getByRole("menuitem")).toHaveText([
    "ZZ-TEST Savings",
    "ZZ-TEST Visa",
    "ZZ-TEST Asset",
  ]);
});
