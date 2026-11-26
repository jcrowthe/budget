import type { APIRequestContext, Page } from "@playwright/test";
import { DEFAULT_FORMATTER } from "../packages/schema/src/plan-formats";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { fakeBankAccount, fakeConnection, stubBankLink } from "./support/bank-link-stub";
import { stubPending } from "./support/pending-stub";
import { realClick } from "./support/real-click";
import { call, TODAY } from "./support/register-seed";
import { daysAgo } from "./support/view-settings";

// EXF-466: pending bank transactions in the register. No real pending row can be made in the browser (no Plaid):
// the stand-in in e2e/support/pending-stub.ts answers the pending list and Enter Now, which makes the real row, so
// the account's balances really move.

const fmt = DEFAULT_FORMATTER;
const section = (page: Page) => page.getByRole("button", { name: /^Pending Transactions/ });
const pendingRows = (page: Page) => page.locator(".register-table tr[data-pending]");
const realRows = (page: Page) => page.locator(".register-table tbody tr[data-tx]");
const uncleared = (page: Page) => page.locator('[data-balance="uncleared"] .acct-amount');
const cleared = (page: Page) => page.locator('[data-balance="cleared"] .acct-amount');
const FUTURE = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 20);
  return d.toISOString().slice(0, 10);
})();

async function seed(page: Page, request: APIRequestContext) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: testName("pending"),
    bank_environment: "sandbox",
  });
  const plan = budget.id as string;
  const account = (
    await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
      name: "ZZ-TEST Pending Checking",
      type: "checking",
      balance: 100000,
      date: daysAgo(30),
    })
  ).account.id as string;
  const other = (
    await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
      name: "ZZ-TEST Pending Other",
      type: "savings",
      balance: 0,
      date: daysAgo(30),
    })
  ).account.id as string;
  const add = (body: Record<string, unknown>) =>
    call(request, "POST", `/api/v1/budgets/${plan}/transactions`, { account_id: account, ...body });
  await add({ date: daysAgo(5), amount: -7000, payee_name: "ZZ-TEST Plain Row" });
  await call(request, "POST", `/api/v1/budgets/${plan}/scheduled-transactions`, {
    account_id: account,
    date_first: FUTURE,
    frequency: "monthly",
    amount: -3000,
    payee_name: "ZZ-TEST Scheduled Row",
  });
  const bank = fakeBankAccount({ name: "ZZ Checking" });
  await stubBankLink(page, request, {
    budgetId: plan,
    connections: [fakeConnection({ accounts: [bank] })],
    links: { [account]: bank.id },
    // the stand-in lays its own unapproved count over the account: the one unapproved row of the AC2 test
    unapproved: { [account]: 1 },
  });
  const stub = await stubPending(page, request, {
    budgetId: plan,
    accountId: account,
    items: [
      { payee: "ZZ-TEST Pending Cafe", amount: -12340, date: daysAgo(1) },
      { payee: "ZZ-TEST Pending Gas", amount: -5000, date: daysAgo(2) },
    ],
  });
  return { plan, account, other, stub, add };
}

const balanceOf = async (request: APIRequestContext, plan: string, account: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}/accounts/${account}`)).account as {
    uncleared_balance: number;
    cleared_balance: number;
  };

test("AC1: the Pending Transactions section sits above Scheduled and the rows, lists both items, and changes no balance", async ({
  page,
  request,
}) => {
  const s = await seed(page, request);
  const before = await balanceOf(request, s.plan, s.account);
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  await expect(section(page)).toBeVisible();
  await expect(section(page)).toHaveAttribute("aria-expanded", "true");
  await expect(pendingRows(page)).toHaveCount(2);
  await expect(pendingRows(page).first()).toContainText("ZZ-TEST Pending Cafe");
  await expect(pendingRows(page).nth(1)).toContainText("ZZ-TEST Pending Gas");
  const top = async (loc: ReturnType<Page["locator"]>) => (await loc.first().boundingBox())?.y ?? 0;
  const scheduled = page.getByRole("button", { name: /^Scheduled Transactions/ });
  await expect(scheduled).toBeVisible();
  expect(await top(section(page))).toBeLessThan(await top(scheduled));
  expect(await top(section(page))).toBeLessThan(await top(realRows(page)));
  // The header's balances are the server's own: pending is in none of them.
  await expect(uncleared(page)).toHaveText(fmt.money(before.uncleared_balance));
  await expect(cleared(page)).toHaveText(fmt.money(before.cleared_balance));
  expect(await realRows(page).filter({ hasText: "ZZ-TEST Pending" }).count()).toBe(0);
});

test("AC2: the header collapses and expands the section, kept across a reload; a search and the attention filter hide it", async ({
  page,
  request,
}) => {
  const s = await seed(page, request);
  // an unapproved row makes the attention banner
  await s.add({
    date: daysAgo(3),
    amount: -900,
    payee_name: "ZZ-TEST Needs Approval",
    approved: false,
  });
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  await realClick(page, section(page));
  await expect(section(page)).toHaveAttribute("aria-expanded", "false");
  await expect(pendingRows(page)).toHaveCount(0);
  await page.reload();
  await expect(section(page)).toHaveAttribute("aria-expanded", "false");
  await expect(pendingRows(page)).toHaveCount(0);
  await realClick(page, section(page));
  await expect(section(page)).toHaveAttribute("aria-expanded", "true");
  await expect(pendingRows(page)).toHaveCount(2);

  const box = page.getByRole("searchbox", { name: /Find the transactions/ });
  await box.fill("zz-test");
  await page.getByRole("option").filter({ hasText: "in any field" }).click();
  await expect(section(page)).toHaveCount(0);
  await page.getByRole("button", { name: "View All" }).click();
  await expect(section(page)).toBeVisible();

  const banner = page
    .getByRole("region", { name: "New transactions" })
    .getByRole("button", { name: "View", exact: true });
  await realClick(page, banner);
  await expect(section(page)).toHaveCount(0);
});

test("AC3: Enter Now from the circled i makes a real row with the clock, moves the uncleared balance by its amount; the clock toggles", async ({
  page,
  request,
}) => {
  const s = await seed(page, request);
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  await expect(pendingRows(page)).toHaveCount(2);
  const before = await balanceOf(request, s.plan, s.account);
  await expect(uncleared(page)).toHaveText(fmt.money(before.uncleared_balance));
  const cafe = pendingRows(page).filter({ hasText: "ZZ-TEST Pending Cafe" });
  await realClick(page, cafe.getByRole("button", { name: "This is a pending bank transaction" }));
  await realClick(page, page.getByRole("menuitem", { name: "Enter Now" }));
  await expect(pendingRows(page)).toHaveCount(1);
  expect(s.stub.enterPosts).toHaveLength(1);
  const row = realRows(page).filter({ hasText: "ZZ-TEST Pending Cafe" });
  await expect(row).toHaveCount(1);
  const clockOn = row.getByRole("button", {
    name: "Entered from a pending bank transaction: click to hide the clock",
  });
  await expect(clockOn).toBeVisible();
  await expect(uncleared(page)).toHaveText(fmt.money(before.uncleared_balance - 12340));
  const after = await balanceOf(request, s.plan, s.account);
  expect(after.uncleared_balance - before.uncleared_balance).toBe(-12340);
  // hide the clock, then show it again
  await realClick(page, clockOn);
  const clockOff = row.getByRole("button", {
    name: "Entered from a pending bank transaction: click to show the clock",
  });
  await expect(clockOff).toHaveCount(1);
  await row.hover();
  await expect(clockOff).toBeVisible();
  await realClick(page, clockOff);
  await expect(clockOn).toBeVisible();
  expect(s.stub.clockPatches.map((p) => p.body)).toEqual([{ status: null }, { status: "entered" }]);
});

test("All Accounts shows no Pending section", async ({ page, request }) => {
  const s = await seed(page, request);
  await page.goto(`/${s.plan}/accounts`);
  await expect(realRows(page).first()).toBeVisible();
  await expect(section(page)).toHaveCount(0);
  await expect(pendingRows(page)).toHaveCount(0);
});

test("editing a pending row enters it: one Enter Now request with the memo", async ({
  page,
  request,
}) => {
  const s = await seed(page, request);
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  const gas = pendingRows(page).filter({ hasText: "ZZ-TEST Pending Gas" });
  await gas.locator("td[data-field=date]").dblclick();
  await page.getByRole("textbox", { name: "Memo" }).fill("ZZ-TEST gas memo");
  await realClick(page, page.getByRole("button", { name: "Enter Now", exact: true }));
  await expect(pendingRows(page)).toHaveCount(1);
  expect(s.stub.enterPosts).toHaveLength(1);
  expect(s.stub.enterPosts[0]?.body).toMatchObject({ memo: "ZZ-TEST gas memo" });
  await expect(realRows(page).filter({ hasText: "ZZ-TEST Pending Gas" })).toHaveCount(1);
  void TODAY;
});

// The attention menus work from the keyboard (F1-F4 of the check of EXF-466).
const infoOf = (page: Page, payee: string) =>
  pendingRows(page)
    .filter({ hasText: payee })
    .getByRole("button", { name: "This is a pending bank transaction" });
const inRegister = (page: Page) =>
  page.evaluate(
    () =>
      !!document.activeElement?.closest(".register-table") &&
      document.activeElement !== document.body,
  );

test("keyboard: Enter on the info button opens the menu on Enter Now, Enter enters it, focus stays in the register", async ({
  page,
  request,
}) => {
  const s = await seed(page, request);
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  await expect(pendingRows(page)).toHaveCount(2);
  await infoOf(page, "ZZ-TEST Pending Cafe").focus();
  await page.keyboard.press("Enter");
  const enterNow = page.getByRole("menuitem", { name: "Enter Now" });
  await expect(enterNow).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(pendingRows(page)).toHaveCount(1);
  await expect(realRows(page).filter({ hasText: "ZZ-TEST Pending Cafe" })).toHaveCount(1);
  await expect.poll(() => inRegister(page)).toBe(true);
  expect(s.stub.enterPosts).toHaveLength(1);
});

test("keyboard: after Enter Now the focus is the entered row, which is selected; Shift+ArrowDown extends from it", async ({
  page,
  request,
}) => {
  const s = await seed(page, request);
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  await expect(pendingRows(page)).toHaveCount(2);
  await infoOf(page, "ZZ-TEST Pending Cafe").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Enter Now" })).toBeFocused();
  await page.keyboard.press("Enter");
  const entered = realRows(page).filter({ hasText: "ZZ-TEST Pending Cafe" });
  await expect(entered).toHaveCount(1);
  await expect(entered).toBeFocused();
  await expect(entered).toHaveClass(/is-checked/);
  // the next keystroke acts on that row: the selection continues from it
  const next = entered.locator("xpath=following-sibling::tr[@data-tx][1]");
  await expect(next).not.toHaveClass(/is-checked/);
  await page.keyboard.press("Shift+ArrowDown");
  await expect(next).toHaveClass(/is-checked/);
  await expect(entered).toHaveClass(/is-checked/);
});

test("keyboard: entering the last pending item leaves focus in the register", async ({
  page,
  request,
}) => {
  const s = await seed(page, request);
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  for (const payee of ["ZZ-TEST Pending Cafe", "ZZ-TEST Pending Gas"]) {
    await infoOf(page, payee).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Enter Now" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(realRows(page).filter({ hasText: payee })).toHaveCount(1);
    await expect.poll(() => inRegister(page)).toBe(true);
  }
  await expect(pendingRows(page)).toHaveCount(0);
});

test("keyboard: Escape returns focus to the trigger and Tab closes the menu", async ({
  page,
  request,
}) => {
  const s = await seed(page, request);
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  const info = infoOf(page, "ZZ-TEST Pending Cafe");
  await info.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Enter Now" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(info).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Enter Now" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(info).toHaveAttribute("aria-expanded", "false");
  expect(s.stub.enterPosts).toHaveLength(0);
});

test("the Pending and Scheduled headers match: 16px icon, same title position, an inset focus ring", async ({
  page,
  request,
}) => {
  const s = await seed(page, request);
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  const icon = page.locator(".pending-header-icon");
  await expect(icon).toHaveCSS("width", "16px");
  await expect(icon).toHaveCSS("height", "16px");
  const x = async (sel: string) => (await page.locator(sel).first().boundingBox())?.x ?? 0;
  expect(await x(".pending-title")).toBe(await x(".scheduled-title"));
  const ringOf = (sel: string) =>
    page.evaluate((selector) => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) return null;
      el.focus();
      // --actionPrimary as the browser resolves it to a colour
      const probe = document.createElement("span");
      probe.style.color = "var(--actionPrimary)";
      document.body.append(probe);
      const primary = getComputedStyle(probe).color;
      probe.remove();
      return {
        focused: el.matches(":focus-visible"),
        shadow: getComputedStyle(el).boxShadow,
        primary,
      };
    }, sel);
  const scheduledRing = await ringOf(".scheduled-header");
  const pendingRing = await ringOf(".pending-header");
  expect(scheduledRing?.focused).toBe(true);
  expect(scheduledRing?.primary).toMatch(/^rgb/);
  // e.g. "rgb(10, 132, 255) 0px 0px 0px 2px inset": the token's colour, 2px, inset
  expect(scheduledRing?.shadow).toContain(scheduledRing?.primary ?? "");
  expect(scheduledRing?.shadow).toContain("inset");
  expect(scheduledRing?.shadow).toContain("2px");
  expect(scheduledRing?.shadow).toBe(pendingRing?.shadow);
});
