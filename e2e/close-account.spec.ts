import { expect, test } from "./fixtures";
import {
  accountTxs,
  api,
  dbutton,
  dialog,
  getAccount,
  newAccount,
  newPlan,
  openFromHeader,
  openFromSidebar,
  post,
  readyToAssign,
  sidebar,
  writes,
} from "./support/account-edit-seed";
import { realClick } from "./support/real-click";

const adjust = (
  request: import("@playwright/test").APIRequestContext,
  plan: string,
  id: string,
  balance: number,
) => post(request, `/api/v1/budgets/${plan}/accounts/${id}/adjust-balance`, { balance });
const group = (page: import("@playwright/test").Page, name: string) =>
  sidebar(page).locator(`[data-group=${name}]`);
const CLOSE_TIP =
  "Closing an account retains the transaction history for your plan. If you'd like to delete an account, start by closing the account first.";
const DELETE_TIP =
  "If you want to delete this account, first delete all of the transactions in it and transfers pointing to it. Be cautious, as this will potentially change your plan values.";

test("Delete Account removes the account and lands on All Accounts", async ({ page, request }) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ-TEST Chk", "checking", 0);
  await newAccount(request, plan, "ZZ-TEST Other", "savings", 5000);
  await page.goto(`/${plan}/accounts/${id}`);
  await openFromHeader(page);
  await expect(dbutton(page, "Close Account")).toHaveCount(0);
  await realClick(page, dbutton(page, "Delete Account"));
  await expect(page).toHaveURL(`/${plan}/accounts`);
  await expect(sidebar(page).getByText("ZZ-TEST Chk", { exact: true })).toHaveCount(0);
  await expect
    .poll(async () =>
      (await api(request, "GET", `/api/v1/budgets/${plan}/accounts/${id}`)).status(),
    )
    .toBe(404);
});

test("after an adjustment the button reads Close Account with its tooltip", async ({
  page,
  request,
}) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ-TEST Chk");
  await adjust(request, plan, id, 1000);
  await page.goto(`/${plan}/accounts/${id}`);
  await openFromHeader(page);
  await expect(dbutton(page, "Close Account")).toHaveAttribute("title", CLOSE_TIP);
  await expect(dbutton(page, "Delete Account")).toHaveCount(0);
  expect((await getAccount(request, plan, id)).can_delete).toBe(false);
});

test("closing at zero shows no second dialog", async ({ page, request }) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ-TEST Chk");
  await adjust(request, plan, id, 1000);
  await adjust(request, plan, id, 0);
  await page.goto(`/${plan}/accounts/${id}`);
  await openFromHeader(page);
  await realClick(page, dbutton(page, "Close Account"));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(group(page, "closed").getByText("ZZ-TEST Chk", { exact: true })).toBeVisible();
  expect(await accountTxs(request, plan, id)).toHaveLength(3);
});

test("closing an on-plan account with a balance, and Cancel changes nothing", async ({
  page,
  request,
}) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ-TEST Chk");
  await adjust(request, plan, id, 33330);
  const before = await readyToAssign(request, plan);
  await page.goto(`/${plan}/accounts/${id}`);
  const sent = writes(page);
  await openFromHeader(page);
  await realClick(page, dbutton(page, "Close Account"));
  const d = dialog(page, "Close Account");
  await expect(
    d.getByText("An adjustment transaction will be created for -$33.33.", { exact: false }),
  ).toBeVisible();
  await expect(
    d.getByText("The money in this account will be removed from your plan.", { exact: false }),
  ).toBeVisible();
  await realClick(page, d.getByRole("button", { name: "Cancel", exact: true }));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(sent).toHaveLength(0);
  await openFromHeader(page);
  await realClick(page, dbutton(page, "Close Account"));
  await realClick(
    page,
    dialog(page, "Close Account").getByRole("button", {
      name: "Adjust Balance & Close",
      exact: true,
    }),
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(group(page, "closed").getByText("ZZ-TEST Chk", { exact: true })).toBeVisible();
  await expect.poll(() => readyToAssign(request, plan)).toBe(before - 33330);
  const closed = (await accountTxs(request, plan, id)).find((t) => t.memo === "Closed Account");
  expect(closed?.amount).toBe(-33330);
  await expect(page.locator(".register-table tbody")).toContainText("Closed Account");
  await expect(page.locator('[data-balance="working"] .acct-amount')).toHaveText("$0.00");
});

test("closing an Asset shows no info box and leaves Ready to Assign", async ({ page, request }) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ-TEST Asset", "otherAsset", 0);
  await adjust(request, plan, id, 22220);
  const before = await readyToAssign(request, plan);
  await page.goto(`/${plan}/accounts/${id}`);
  await openFromHeader(page);
  await realClick(page, dbutton(page, "Close Account"));
  const d = dialog(page, "Close Account");
  await expect(d.getByText("-$22.22", { exact: false })).toBeVisible();
  await expect(
    d.getByText("The money in this account will be removed", { exact: false }),
  ).toHaveCount(0);
  await realClick(page, d.getByRole("button", { name: "Adjust Balance & Close", exact: true }));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await getAccount(request, plan, id)).closed).toBe(true);
  const closing = (await accountTxs(request, plan, id)).find((t) => t.memo === "Closed Account");
  expect(closing).toMatchObject({
    amount: -22220,
    inflow_to_ready_to_assign: false,
    category_id: null,
  });
  expect(await readyToAssign(request, plan)).toBe(before);
});

test("closing a starred account removes it from STARRED", async ({ page, request }) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ-TEST Chk", "checking", 500);
  await adjust(request, plan, id, 600);
  await api(request, "PATCH", `/api/v1/budgets/${plan}/accounts/${id}`, { starred: true });
  await page.goto(`/${plan}/accounts/${id}`);
  await expect(group(page, "starred")).toBeVisible();
  await openFromSidebar(page, "ZZ-TEST Chk");
  await realClick(page, dbutton(page, "Close Account"));
  await realClick(
    page,
    dialog(page, "Close Account").getByRole("button", {
      name: "Adjust Balance & Close",
      exact: true,
    }),
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(group(page, "starred")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Toggle Starred", exact: true })).toHaveCount(0);
  expect((await getAccount(request, plan, id)).starred).toBe(false);
});

test("a closed account's dialog, then Re-open", async ({ page, request }) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ-TEST Chk", "checking", 500);
  await post(request, `/api/v1/budgets/${plan}/accounts/${id}/close`);
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto(`/${plan}/accounts/${id}`);
  await openFromHeader(page);
  await expect(dialog(page).getByLabel("Working Balance")).toHaveCount(0);
  await expect(dialog(page).getByLabel("Today's Balance")).toHaveCount(0);
  await expect(dbutton(page, "Delete")).toBeDisabled();
  await expect(dbutton(page, "Delete")).toHaveAttribute("title", DELETE_TIP);
  await dialog(page).getByLabel("Account Nickname", { exact: true }).fill("ZZ-TEST Renamed");
  await realClick(page, dbutton(page, "Save"));
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "ZZ-TEST Renamed" })).toBeVisible();
  const n = (await accountTxs(request, plan, id)).length;
  await openFromHeader(page);
  await realClick(page, dbutton(page, "Re-open"));
  await expect(dialog(page)).toHaveCount(0);
  await expect(group(page, "cash").getByText("ZZ-TEST Renamed", { exact: true })).toBeVisible();
  await expect(group(page, "closed")).toHaveCount(0);
  expect(await accountTxs(request, plan, id)).toHaveLength(n);
  expect(await getAccount(request, plan, id)).toMatchObject({
    closed: false,
    starred: false,
    balance: 0,
  });
});
