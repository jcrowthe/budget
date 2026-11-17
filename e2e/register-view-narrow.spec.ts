import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { call, realClick } from "./support/register-seed";
import { daysAgo, setViewSettings } from "./support/view-settings";

// EXF-529, acceptance 11. At 1024x700 the View button stays in the toolbar, as in the source (the source's right
// group stays inline at that width); the source's popover lies inside its window. Nothing in the clone was
// compared at this width beyond that.

test.use({ viewport: { width: 1024, height: 700 } });

const LONG_PAYEE = "ZZ A very long payee name that cannot fit in its column at this width at all";

async function seedNarrow(request: Parameters<typeof call>[0]) {
  const { budget } = await call(request, "POST", "/api/v1/budgets", {
    name: `ZZ-TEST narrow ${Math.random().toString(36).slice(2, 8)}`,
  });
  const plan = budget.id as string;
  const account = (
    await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
      name: "ZZ Narrow",
      type: "checking",
      balance: 0,
      date: daysAgo(3),
    })
  ).account.id as string;
  const add = (payee: string, amount: number, day: number, extra: Record<string, unknown> = {}) =>
    call(request, "POST", `/api/v1/budgets/${plan}/transactions`, {
      account_id: account,
      date: daysAgo(day),
      amount,
      payee_name: payee,
      memo: "ZZ a memo long enough to be cut off in its narrow column",
      cleared: "cleared",
      ...extra,
    });
  // Balances: 0.00 (start), -99,999.99, 0.00: the widest amount in each of the three columns.
  await add(LONG_PAYEE, -99999990, 2);
  await add("ZZ Pay", 99999990, 1, { inflow_to_ready_to_assign: true });
  return { plan, account };
}

const box = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) throw new Error("not visible");
  return b;
};
const insideViewport = async (page: Page, l: Locator) => {
  const b = await box(l);
  const v = page.viewportSize() as { width: number; height: number };
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(v.width);
  expect(b.y + b.height).toBeLessThanOrEqual(v.height);
};
const viewButton = (page: Page) =>
  page.getByRole("toolbar", { name: "Register toolbar" }).getByRole("button", {
    name: "View",
    exact: true,
  });
const dialog = (page: Page) => page.getByRole("dialog", { name: "View Options", exact: true });

test("View is inline and clickable, the popover is inside the window, BALANCE cuts no amount (case 11)", async ({
  page,
  request,
}) => {
  const s = await seedNarrow(request);
  await setViewSettings(request, s.plan, s.account, { show_running_balance: true });
  await page.goto(`/${s.plan}/accounts/${s.account}`);
  await expect(page.locator(".register-table[aria-busy=false]")).toBeVisible();
  const toolbar = page.getByRole("toolbar", { name: "Register toolbar" });
  await expect(viewButton(page)).toBeVisible();
  const tb = await box(toolbar);
  const vb = await box(viewButton(page));
  expect(vb.x).toBeGreaterThanOrEqual(tb.x);
  expect(vb.x + vb.width).toBeLessThanOrEqual(tb.x + tb.width);
  const hit = await viewButton(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && el.contains(top);
  });
  expect(hit).toBe(true);

  await realClick(page, viewButton(page));
  await expect(dialog(page)).toBeVisible();
  await insideViewport(page, dialog(page));
  await page.keyboard.press("Escape");

  // The BALANCE column: -$99,999.99 after the first row, and no amount cell is cut.
  await expect(page.getByRole("columnheader", { name: "BALANCE", exact: true })).toBeVisible();
  const balances = page.locator(".register-table tbody td.cell-balance");
  await expect(balances).toHaveText(["$0.00", "−$99,999.99", "$0.00"]);
  const cut = await page
    .locator(".register-table td.num, .register-table th.num")
    .evaluateAll((els) =>
      els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent),
    );
  expect(cut).toEqual([]);
  // Payee and memo are cut with an ellipsis and keep their text in a tooltip.
  const payee = page
    .locator(".register-table tbody tr[data-tx]")
    .filter({ hasText: "A very long payee" })
    .locator("td[data-field=payee]");
  expect(await payee.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await payee.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");
  await expect(payee).toHaveAttribute("title", LONG_PAYEE);
  const memo = page.locator(".register-table tbody td[data-field=memo]").first();
  await expect(memo).toHaveAttribute("title", /^ZZ a memo long enough/);
  expect(await memo.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");
  // No row is wider than the table.
  const table = await box(page.locator(".register-table"));
  const scroll = await box(page.locator(".register-scroll"));
  expect(table.width).toBeLessThanOrEqual(scroll.width + 0.5);
  await page.screenshot({ path: ".screenshots/register-view-balance-1024.png" });
});

test("the popover of an account and of All Accounts is inside the window at 1024x700 (cases 1, 7)", async ({
  page,
  request,
}) => {
  const s = await seedNarrow(request);
  for (const [path, running] of [
    [`/${s.plan}/accounts/${s.account}`, 1],
    [`/${s.plan}/accounts`, 0],
  ] as const) {
    await page.goto(path);
    await expect(page.locator(".register-table[aria-busy=false]")).toBeVisible();
    await realClick(page, viewButton(page));
    await expect(dialog(page)).toBeVisible();
    await insideViewport(page, dialog(page));
    await expect(dialog(page).getByRole("checkbox", { name: "Show Running Balance" })).toHaveCount(
      running,
    );
    for (const b of ["Cancel", "Apply"]) {
      await insideViewport(page, dialog(page).getByRole("button", { name: b, exact: true }));
    }
    expect(await dialog(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 0.5)).toBe(true);
    await page.screenshot({ path: `.screenshots/register-view-popover-1024-${running}.png` });
    await page.keyboard.press("Escape");
  }
});
