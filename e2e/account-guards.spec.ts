import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  accountTxs,
  dbutton,
  dialog,
  getAccount,
  newAccount,
  newPlan,
  openFromHeader,
  post,
} from "./support/account-edit-seed";
import { realClick } from "./support/real-click";
import { call } from "./support/register-seed";

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const rows = (page: Page) => page.locator(".register .entry-row");
const BASE = (plan: string) => `/api/v1/budgets/${plan}`;

async function closedAndOpen(request: import("@playwright/test").APIRequestContext) {
  const plan = await newPlan(request);
  const shut = await newAccount(request, plan, "ZZ-TEST Shut", "checking", 1000);
  const open = await newAccount(request, plan, "ZZ-TEST Open", "checking", 1000);
  await call(request, "POST", `${BASE(plan)}/accounts/${shut}/close`, {});
  await expect.poll(async () => (await getAccount(request, plan, shut)).closed).toBe(true);
  return { plan, shut, open };
}

test("a closed account's page: Add Transaction and Shift+N do nothing, also at 1024x700", async ({
  page,
  request,
}) => {
  const s = await closedAndOpen(request);
  for (const size of [
    { width: 1280, height: 800 },
    { width: 1024, height: 700 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(`/${s.plan}/accounts/${s.shut}`);
    await expect(button(page, "Add Transaction")).toBeDisabled();
    await expect(button(page, "File Import")).toBeDisabled();
    await realClick(page, page.getByRole("main").getByRole("heading").first());
    await page.keyboard.press("Shift+N");
    await expect(rows(page)).toHaveCount(0);
    const box = await button(page, "Add Transaction").boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(
      (box?.x ?? 0) + (box?.width ?? 0) / 2,
      (box?.y ?? 0) + (box?.height ?? 0) / 2,
    );
    await expect(rows(page)).toHaveCount(0);
  }
  // the open account still adds
  await page.goto(`/${s.plan}/accounts/${s.open}`);
  await expect(button(page, "Add Transaction")).toBeEnabled();
  await realClick(page, button(page, "Add Transaction"));
  await expect(rows(page)).toHaveCount(1);
});

test("All Accounts: the add row and the transfer choices offer no closed account", async ({
  page,
  request,
}) => {
  const s = await closedAndOpen(request);
  await newAccount(request, s.plan, "ZZ-TEST Third", "savings", 0);
  await page.goto(`/${s.plan}/accounts`);
  await realClick(page, page.getByRole("main").getByRole("heading").first());
  await page.keyboard.press("Shift+N");
  await expect(rows(page)).toHaveCount(1);
  const account = page.getByRole("combobox", { name: "Account", exact: true });
  await realClick(page, account);
  const list = page.getByRole("listbox", { name: "Accounts", exact: true });
  await expect(list.getByRole("option", { name: "ZZ-TEST Open", exact: true })).toBeVisible();
  await expect(list.getByRole("option", { name: "ZZ-TEST Shut", exact: true })).toHaveCount(0);
  await realClick(page, list.getByRole("option", { name: "ZZ-TEST Open", exact: true }));
  const payee = page.getByRole("combobox", { name: "Payee", exact: true });
  await payee.fill("ZZ-TEST");
  await expect(
    page.getByRole("option", { name: "To/From ZZ-TEST Third", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("option", { name: "To/From ZZ-TEST Shut", exact: true })).toHaveCount(
    0,
  );
  await payee.fill("ZZ-TEST Third");
  await expect(
    page.getByRole("option", { name: "To/From ZZ-TEST Third", exact: true }),
  ).toBeVisible();
});

test("an account with a split is adjusted in Edit Account and closed with Adjust Balance & Close", async ({
  page,
  request,
}) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ-TEST Split", "checking", 100000);
  const month = await call(request, "GET", `${BASE(plan)}/months/2026-11-01`);
  const [c1, c2, c3] = month.groups.flatMap((g: { categories: { id: string }[] }) => g.categories);
  await post(request, `${BASE(plan)}/transactions`, {
    account_id: id,
    date: "2026-11-10",
    amount: -10000,
    payee_name: "ZZ-TEST Parent",
    subtransactions: [
      { amount: -6000, category_id: c1.id },
      { amount: -2500, category_id: c2.id },
      { amount: -1500, category_id: c3.id },
    ],
  });
  await expect.poll(async () => (await getAccount(request, plan, id)).balance).toBe(90000);
  await page.goto(`/${plan}/accounts/${id}`);
  await openFromHeader(page);
  const working = dialog(page).getByLabel("Working Balance", { exact: true });
  await expect(working).toHaveValue("90.00");
  await working.fill("95.00");
  await realClick(page, dbutton(page, "Save"));
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(async () => (await getAccount(request, plan, id)).balance).toBe(95000);
  const adj = (await accountTxs(request, plan, id)).filter(
    (t) => t.payee_name === "Manual Balance Adjustment",
  );
  expect(adj.map((t) => t.amount)).toEqual([5000]);

  await openFromHeader(page);
  await expect(dialog(page).getByLabel("Working Balance", { exact: true })).toHaveValue("95.00");
  await realClick(page, dbutton(page, "Close Account"));
  const d = dialog(page, "Close Account");
  await expect(
    d.getByText("An adjustment transaction will be created for -$95.00.", { exact: false }),
  ).toBeVisible();
  await realClick(page, d.getByRole("button", { name: "Adjust Balance & Close", exact: true }));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await getAccount(request, plan, id)).closed).toBe(true);
  const after = await getAccount(request, plan, id);
  expect(after.balance).toBe(0);
  const closing = (await accountTxs(request, plan, id)).find((t) => t.memo === "Closed Account");
  expect(closing?.amount).toBe(-95000);
});

test("All Accounts with only closed accounts: Add Transaction is disabled and Shift+N opens no row", async ({
  page,
  request,
}) => {
  const plan = await newPlan(request);
  const only = await newAccount(request, plan, "ZZ-TEST Only", "checking", 0);
  await call(request, "POST", `${BASE(plan)}/accounts/${only}/close`, {});
  await expect.poll(async () => (await getAccount(request, plan, only)).closed).toBe(true);
  await page.goto(`/${plan}/accounts`);
  // Source: Add Transaction and File Import are disabled when no account is open (measured on a plan of closed accounts).
  await expect(button(page, "Add Transaction")).toBeDisabled();
  await expect(button(page, "File Import")).toBeDisabled();
  await realClick(page, page.getByRole("main").getByRole("heading").first());
  await page.keyboard.press("Shift+N");
  await expect(rows(page)).toHaveCount(0);
});

test("All Accounts: editing a closed account's row shows its name and offers no closed account", async ({
  page,
  request,
}) => {
  const s = await closedAndOpen(request);
  await page.goto(`/${s.plan}/accounts`);
  const row = page
    .locator(".register-table tbody tr")
    .filter({ hasText: "Closed Account" })
    .first();
  await row.getByText("Closed Account", { exact: true }).dblclick();
  const account = page.getByRole("combobox", { name: "Account", exact: true });
  await expect(account).toHaveValue("ZZ-TEST Shut");
  await realClick(page, account);
  const list = page.getByRole("listbox", { name: "Accounts", exact: true });
  await expect(list.getByRole("option", { name: "ZZ-TEST Open", exact: true })).toBeVisible();
  await expect(list.getByRole("option", { name: "ZZ-TEST Shut", exact: true })).toHaveCount(0);
});
