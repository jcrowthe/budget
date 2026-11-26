import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { call, realClick, seed, txs } from "./support/register-seed";
import { createSched, fixClock, listSched, type Sched } from "./support/scheduled-seed";

// EXF-657: Categorize, Flag, Memo and Move to Account work on scheduled rows; Duplicate and Export stay
// disabled with their reason. EXF-679: the Move to Account submenu opens on hover, ArrowRight and Enter and
// closes on Escape and on leaving. The browser's clock is fixed at 2026-11-15.
const DAY = "2026-11-15";
const LATER = "Not available for scheduled transactions yet";
const CAT = "ZZ-TEST Group: ZZ-TEST Groceries";

const bar = (page: Page) => page.getByRole("toolbar", { name: "Selection actions" });
const barButton = (page: Page, name: string) =>
  bar(page).getByRole("button", { name, exact: true });
const schedRow = (page: Page, text: string) =>
  page.locator("tr[data-scheduled]").filter({ hasText: text });
const tickSched = (page: Page, text: string) =>
  realClick(
    page,
    schedRow(page, text).getByRole("checkbox", { name: "Select transaction", exact: true }),
  );
const moreMenu = (page: Page) => page.getByRole("menu", { name: "More actions" });
const moreItem = (page: Page, name: string) =>
  moreMenu(page).getByRole("menuitem", { name, exact: true });
const subMenu = (page: Page) => page.getByRole("menu", { name: "Move to Account", exact: true });
const openMore = async (page: Page) => {
  await realClick(page, barButton(page, "More"));
  await expect(moreMenu(page)).toBeVisible();
};

async function world(request: APIRequestContext) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: testName("sched-bulk"),
  });
  const plan = budget.id as string;
  const open = async (name: string, type: string) =>
    (
      await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
        name,
        type,
        balance: 1000000,
        date: DAY,
      })
    ).account.id as string;
  const checking = await open("ZZ-TEST Checking", "checking");
  const savings = await open("ZZ-TEST Savings", "savings");
  const third = await open("ZZ-TEST Third", "savings");
  const group = (
    await call(request, "POST", `/api/v1/budgets/${plan}/category_groups`, {
      name: "ZZ-TEST Group",
    })
  ).category_group.id as string;
  const cat = async (name: string) =>
    (await call(request, "POST", `/api/v1/budgets/${plan}/categories`, { group_id: group, name }))
      .category.id as string;
  const groceries = await cat("ZZ-TEST Groceries");
  const fun = await cat("ZZ-TEST Fun");
  const plain = async (n: string, account = checking, extra: Record<string, unknown> = {}) =>
    (
      await createSched(request, plan, DAY, {
        account_id: account,
        date_first: "2026-11-25",
        frequency: "monthly",
        amount: -1000,
        payee_name: `ZZ-TEST Plain ${n}`,
        ...extra,
      })
    ).scheduled_transaction;
  return { plan, checking, savings, third, groceries, fun, plain };
}

async function openAccount(page: Page, plan: string, account: string) {
  await fixClock(page, DAY);
  await page.goto(`/${plan}/accounts/${account}`);
  await expect(page.getByRole("button", { name: "Add Transaction", exact: true })).toBeVisible();
}

test("Categorize, Flag, Memo and Move to Account change selected scheduled rows and persist (EXF-657)", async ({
  page,
  request,
}) => {
  const w = await world(request);
  const one = await w.plain("One");
  const two = await w.plain("Two");
  await openAccount(page, w.plan, w.checking);
  await tickSched(page, "ZZ-TEST Plain One");
  await tickSched(page, "ZZ-TEST Plain Two");
  await expect(barButton(page, "2 Transactions")).toBeVisible();

  await realClick(page, barButton(page, "Categorize"));
  await realClick(
    page,
    page.getByRole("menu", { name: "Categories" }).getByRole("menuitem", { name: "ZZ-TEST Group" }),
  );
  await realClick(
    page,
    page
      .getByRole("menu", { name: "ZZ-TEST Group" })
      .getByRole("menuitem", { name: "ZZ-TEST Groceries", exact: true }),
  );
  for (const n of ["One", "Two"]) {
    await expect(
      schedRow(page, `ZZ-TEST Plain ${n}`).locator("td[data-field=category]"),
    ).toHaveText(CAT);
  }

  await realClick(page, barButton(page, "Flag"));
  await realClick(
    page,
    page.getByRole("menu", { name: "Flags" }).getByRole("menuitem", { name: "Red", exact: true }),
  );
  for (const n of ["One", "Two"]) {
    await expect(
      schedRow(page, `ZZ-TEST Plain ${n}`).locator("td.cell-flag svg.flag-red"),
    ).toBeVisible();
  }

  await openMore(page);
  await realClick(page, moreItem(page, "Memo..."));
  await page.getByRole("textbox", { name: "Memo", exact: true }).fill("ZZ-TEST bulk memo");
  await realClick(page, page.getByRole("button", { name: /^Update/ }));
  for (const n of ["One", "Two"]) {
    await expect(schedRow(page, `ZZ-TEST Plain ${n}`).locator("td[data-field=memo]")).toHaveText(
      "ZZ-TEST bulk memo",
    );
  }

  await openMore(page);
  await page.mouse.move(...(await centre(moreItem(page, "Move to Account"))));
  await realClick(
    page,
    subMenu(page).getByRole("menuitem", { name: "ZZ-TEST Savings", exact: true }),
  );
  await expect(page.locator("tr[data-scheduled]")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: "Add Transaction", exact: true })).toBeVisible();
  await expect(page.locator("tr[data-scheduled]")).toHaveCount(0);
  await openAccount(page, w.plan, w.savings);
  for (const n of ["One", "Two"]) {
    const r = schedRow(page, `ZZ-TEST Plain ${n}`);
    await expect(r).toBeVisible();
    await expect(r.locator("td[data-field=category]")).toHaveText(CAT);
    await expect(r.locator("td.cell-flag svg.flag-red")).toBeVisible();
    await expect(r.locator("td[data-field=memo]")).toHaveText("ZZ-TEST bulk memo");
  }
  const api = await listSched(request, w.plan);
  for (const id of [one.id, two.id]) {
    const s = api.find((x) => x.id === id) as Sched & { flag_color: string; account_id: string };
    expect(s.account_id).toBe(w.savings);
    expect(s.category_id).toBe(w.groceries);
    expect(s.flag_color).toBe("red");
    expect(s.memo).toBe("ZZ-TEST bulk memo");
  }
});

test("Categorize skips a split with its reason, and is disabled when nothing takes a category (EXF-657)", async ({
  page,
  request,
}) => {
  const w = await world(request);
  await w.plain("Solo");
  const split = (
    await createSched(request, w.plan, DAY, {
      account_id: w.checking,
      date_first: "2026-11-26",
      frequency: "monthly",
      amount: -40000,
      payee_name: "ZZ-TEST Split",
      subtransactions: [
        { amount: -30000, category_id: w.groceries },
        { amount: -10000, category_id: w.fun },
      ],
    })
  ).scheduled_transaction;
  await openAccount(page, w.plan, w.checking);
  await tickSched(page, "ZZ-TEST Split");
  await expect(barButton(page, "Categorize")).toBeDisabled();
  await expect(barButton(page, "Categorize")).toHaveAttribute(
    "title",
    "None of the selected scheduled transactions takes a category",
  );
  await tickSched(page, "ZZ-TEST Plain Solo");
  await realClick(page, barButton(page, "Categorize"));
  await realClick(
    page,
    page.getByRole("menu", { name: "Categories" }).getByRole("menuitem", { name: "ZZ-TEST Group" }),
  );
  await realClick(
    page,
    page
      .getByRole("menu", { name: "ZZ-TEST Group" })
      .getByRole("menuitem", { name: "ZZ-TEST Fun", exact: true }),
  );
  await expect(schedRow(page, "ZZ-TEST Plain Solo").locator("td[data-field=category]")).toHaveText(
    "ZZ-TEST Group: ZZ-TEST Fun",
  );
  const alert = bar(page).locator("xpath=..").getByRole("alert");
  await expect(alert).toContainText("ZZ-TEST Split");
  await expect(alert).toContainText("A split's category is in its lines");
  const after = await listSched(request, w.plan);
  expect(after.find((s) => s.id === split.id)?.category_id).toBeNull();
});

test("Move skips a mirror row with the series' account, and moves the plain row (EXF-657)", async ({
  page,
  request,
}) => {
  const w = await world(request);
  const plain = await w.plain("Plain", w.savings);
  const transfer = (
    await createSched(request, w.plan, DAY, {
      account_id: w.checking,
      transfer_account_id: w.savings,
      date_first: "2026-11-27",
      frequency: "monthly",
      amount: -2000,
    })
  ).scheduled_transaction;
  await openAccount(page, w.plan, w.savings);
  const mirror = page.locator(`tr[data-scheduled="mirror:${transfer.id}"]`);
  await realClick(page, mirror.getByRole("checkbox", { name: "Select transaction", exact: true }));
  await tickSched(page, "ZZ-TEST Plain Plain");
  await openMore(page);
  await page.mouse.move(...(await centre(moreItem(page, "Move to Account"))));
  await realClick(
    page,
    subMenu(page).getByRole("menuitem", { name: "ZZ-TEST Third", exact: true }),
  );
  await expect(schedRow(page, "ZZ-TEST Plain Plain")).toHaveCount(0);
  await expect(
    page.getByRole("alert").filter({ hasText: "Scheduled in ZZ-TEST Checking: move it there" }),
  ).toBeVisible();
  await expect(mirror).toBeVisible();
  const api = await listSched(request, w.plan);
  expect(api.find((s) => s.id === transfer.id && !("mirror" in s && s.mirror))?.account_id).toBe(
    w.checking,
  );
  expect(api.find((s) => s.id === plain.id)?.account_id).toBe(w.third);
});

test("Duplicate and Export stay disabled for scheduled rows, with their reason (EXF-657)", async ({
  page,
  request,
}) => {
  const w = await world(request);
  await w.plain("One");
  await w.plain("Two");
  await openAccount(page, w.plan, w.checking);
  await tickSched(page, "ZZ-TEST Plain One");
  await tickSched(page, "ZZ-TEST Plain Two");
  await openMore(page);
  for (const name of ["Duplicate", "Export 2 Transactions"]) {
    const item = moreItem(page, name);
    await expect(item).toHaveAttribute("aria-disabled", "true");
    await expect(item).toHaveAttribute("title", LATER);
    await item.click({ force: true });
    await expect(moreMenu(page)).toBeVisible();
  }
  expect(await listSched(request, w.plan)).toHaveLength(2);
});

const centre = async (l: Locator): Promise<[number, number]> => {
  const b = await l.boundingBox();
  if (!b) throw new Error("no box");
  return [b.x + b.width / 2, b.y + b.height / 2];
};

/** The submenu opens on hover, ArrowRight and Enter, and closes on leaving and on Escape (EXF-679). */
async function submenuBehaviour(page: Page, snapshot: () => Promise<unknown>) {
  const before = await snapshot();
  const move = moreItem(page, "Move to Account");
  // Hover opens it; moving into it keeps it open.
  await openMore(page);
  await page.mouse.move(...(await centre(move)));
  await expect(subMenu(page)).toBeVisible();
  await expect(move).toHaveAttribute("aria-expanded", "true");
  const first = subMenu(page).getByRole("menuitem").first();
  await page.mouse.move(...(await centre(first)), { steps: 5 });
  await expect(subMenu(page)).toBeVisible();
  // Another More item closes the submenu only.
  await page.mouse.move(...(await centre(moreItem(page, "Memo..."))), { steps: 5 });
  await expect(subMenu(page)).toHaveCount(0);
  await expect(moreMenu(page)).toBeVisible();
  // Hover again, then leave both: it closes within a second.
  await page.mouse.move(...(await centre(move)));
  await expect(subMenu(page)).toBeVisible();
  await page.mouse.move(5, 5, { steps: 8 });
  await expect(subMenu(page)).toHaveCount(0, { timeout: 1000 });
  await expect(moreMenu(page)).toBeVisible();
  // Keyboard: ArrowRight, then Enter, each closed by Escape (the first Escape keeps More open).
  for (const key of ["ArrowRight", "Enter"]) {
    await move.focus();
    await page.keyboard.press(key);
    await expect(subMenu(page)).toBeVisible();
    await expect(subMenu(page).getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(subMenu(page)).toHaveCount(0);
    await expect(moreMenu(page)).toBeVisible();
    await expect(move).toBeFocused();
  }
  await page.keyboard.press("Escape");
  await expect(moreMenu(page)).toHaveCount(0);
  // Opening and closing wrote nothing.
  expect(await snapshot()).toEqual(before);
}

test("the Move to Account submenu opens on hover, ArrowRight and Enter, and closes on leaving and Escape: scheduled rows (EXF-679)", async ({
  page,
  request,
}) => {
  const w = await world(request);
  await w.plain("One");
  await openAccount(page, w.plan, w.checking);
  await tickSched(page, "ZZ-TEST Plain One");
  await submenuBehaviour(page, async () => JSON.stringify(await listSched(request, w.plan)));
  // The same on All Accounts.
  await fixClock(page, DAY);
  await page.goto(`/${w.plan}/accounts`);
  await tickSched(page, "ZZ-TEST Plain One");
  await submenuBehaviour(page, async () => JSON.stringify(await listSched(request, w.plan)));
});

test("the Move to Account submenu opens on hover, ArrowRight and Enter, and closes on leaving and Escape: real rows (EXF-679)", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.checking,
    date: "2026-11-10",
    amount: -5000,
    payee_name: "ZZ-TEST Real",
  });
  const rows = async () => JSON.stringify(await txs(request, s.plan, s.checking));
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const row = page.locator(".register-table tbody tr[data-tx]").filter({ hasText: "ZZ-TEST Real" });
  await realClick(page, row.getByRole("checkbox"));
  await submenuBehaviour(page, rows);
});
