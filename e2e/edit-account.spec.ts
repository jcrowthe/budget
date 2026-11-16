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
  readyToAssign,
  sidebar,
  writes,
} from "./support/account-edit-seed";
import { realClick } from "./support/real-click";

const field = (page: import("@playwright/test").Page, name: string) =>
  dialog(page).getByLabel(name, { exact: true });

test("both pencils open Edit Account prefilled, at 1024x700 too", async ({ page, request }) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ-TEST Chk", "checking", 250000);
  await api(request, "PATCH", `/api/v1/budgets/${plan}/accounts/${id}`, { note: "n1" });
  for (const size of [
    { width: 1280, height: 800 },
    { width: 1024, height: 700 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(`/${plan}/accounts/${id}`);
    const url = page.url();
    await openFromHeader(page);
    await expect(field(page, "Account Nickname")).toBeFocused();
    await expect(field(page, "Account Nickname")).toHaveValue("ZZ-TEST Chk");
    await expect(field(page, "Account Notes")).toHaveValue("n1");
    await expect(field(page, "Working Balance")).toHaveValue("250.00");
    expect(page.url()).toBe(url);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await openFromSidebar(page, "ZZ-TEST Chk");
    await expect(field(page, "Account Notes")).toHaveValue("n1");
    expect(page.url()).toBe(url);
    await expect(dbutton(page, "Save")).toBeInViewport();
    await page.keyboard.press("Escape");
  }
});

test("labels by kind and the helper text", async ({ page, request }) => {
  const plan = await newPlan(request);
  const chk = await newAccount(request, plan, "ZZ-TEST Chk", "checking", 1000);
  const asset = await newAccount(request, plan, "ZZ-TEST Asset", "otherAsset", 5000);
  const liab = await newAccount(request, plan, "ZZ-TEST Liab", "otherLiability", 7000);
  const card = await newAccount(request, plan, "ZZ-TEST Card", "creditCard", 150000);
  const helper =
    "An adjustment transaction will be created automatically if you change this amount.";
  for (const [id, label, value] of [
    [chk, "Working Balance", "1.00"],
    [asset, "Today's Balance", "5.00"],
    [liab, "Today's Balance", "-7.00"],
    [card, "Working Balance", "-150.00"],
  ] as const) {
    await page.goto(`/${plan}/accounts/${id}`);
    await openFromHeader(page);
    await expect(field(page, label)).toHaveValue(value);
    await expect(dialog(page).getByText(helper, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("rename updates the header and the sidebar; empty and duplicate names are refused", async ({
  page,
  request,
}) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ-TEST Chk");
  await newAccount(request, plan, "ZZ-TEST Sav", "savings");
  await page.goto(`/${plan}/accounts/${id}`);
  const sent = writes(page);
  await openFromHeader(page);
  await field(page, "Account Nickname").fill("");
  await realClick(page, dbutton(page, "Save"));
  await expect(
    dialog(page).getByText("The account name is required.", { exact: true }),
  ).toBeVisible();
  expect(sent).toHaveLength(0);
  await field(page, "Account Nickname").fill("zz-test sav");
  await realClick(page, dbutton(page, "Save"));
  await expect(
    dialog(page).getByText("This account name already exists.", { exact: true }),
  ).toBeVisible();
  expect((await getAccount(request, plan, id)).name).toBe("ZZ-TEST Chk");
  await field(page, "Account Nickname").fill("D3 Checking Main");
  await realClick(page, dbutton(page, "Save"));
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "D3 Checking Main" })).toBeVisible();
  await expect(sidebar(page).getByText("D3 Checking Main", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await getAccount(request, plan, id)).name)
    .toBe("D3 Checking Main");
  const blank = await api(request, "PATCH", `/api/v1/budgets/${plan}/accounts/${id}`, {
    name: "  ",
  });
  expect(blank.status()).toBe(422);
});

test("notes are saved and shown again", async ({ page, request }) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ-TEST Chk");
  await page.goto(`/${plan}/accounts/${id}`);
  await openFromHeader(page);
  await field(page, "Account Notes").fill("line one\nline two");
  await realClick(page, dbutton(page, "Save"));
  await expect(dialog(page)).toHaveCount(0);
  await expect
    .poll(async () => (await getAccount(request, plan, id)).note)
    .toBe("line one\nline two");
  await openFromHeader(page);
  await expect(field(page, "Account Notes")).toHaveValue("line one\nline two");
  await field(page, "Account Notes").fill("");
  await realClick(page, dbutton(page, "Save"));
  await expect.poll(async () => (await getAccount(request, plan, id)).note).toBeNull();
});

test("a Checking balance change adds a Ready to Assign adjustment", async ({ page, request }) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ-TEST Chk");
  const before = await readyToAssign(request, plan);
  await page.goto(`/${plan}/accounts/${id}`);
  await openFromHeader(page);
  await field(page, "Working Balance").fill("312.50");
  await realClick(page, dbutton(page, "Save"));
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('[data-balance="working"] .acct-amount')).toHaveText("$312.50");
  await expect(sidebar(page).getByText("$312.50").first()).toBeVisible();
  await expect.poll(() => readyToAssign(request, plan)).toBe(before + 312500);
  const list = await accountTxs(request, plan, id);
  expect(list.find((t) => t.payee_name === "Manual Balance Adjustment")?.amount).toBe(312500);
  await expect(page.locator(".register-table tbody")).toContainText("Manual Balance Adjustment");
  await expect(page.locator(".register-table tbody")).toContainText("Inflow: Ready to Assign");
  // The system payee is never offered by the payee picker.
  await page.getByRole("button", { name: "Add Transaction", exact: true }).click();
  await page.getByRole("combobox", { name: "Payee", exact: true }).fill("Manual");
  await expect(page.getByRole("option", { name: "Manual Balance Adjustment" })).toHaveCount(0);
});

test("an Asset balance change takes no category and leaves Ready to Assign", async ({
  page,
  request,
}) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ-TEST Asset", "otherAsset", 1000000);
  const before = await readyToAssign(request, plan);
  await page.goto(`/${plan}/accounts/${id}`);
  await openFromHeader(page);
  await field(page, "Today's Balance").fill("11,000.00");
  await realClick(page, dbutton(page, "Save"));
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(async () => (await accountTxs(request, plan, id)).length).toBe(2);
  const adj = (await accountTxs(request, plan, id)).find(
    (t) => t.payee_name === "Manual Balance Adjustment",
  );
  expect(adj).toMatchObject({
    amount: 10000000,
    inflow_to_ready_to_assign: false,
    category_id: null,
  });
  expect(await readyToAssign(request, plan)).toBe(before);
});

test("Cancel, the X and Escape discard everything", async ({ page, request }) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ-TEST Chk", "checking", 1000);
  await page.goto(`/${plan}/accounts/${id}`);
  const sent = writes(page);
  for (const how of ["Cancel", "Close", "Escape"]) {
    await openFromHeader(page);
    await field(page, "Account Nickname").fill("ZZ-TEST Other");
    await field(page, "Account Notes").fill("x");
    await field(page, "Working Balance").fill("99");
    if (how === "Escape") await page.keyboard.press("Escape");
    else await realClick(page, dbutton(page, how));
    await expect(dialog(page)).toHaveCount(0);
  }
  expect(sent).toHaveLength(0);
  expect(await getAccount(request, plan, id)).toMatchObject({
    name: "ZZ-TEST Chk",
    note: null,
    balance: 1000,
  });
  expect(await accountTxs(request, plan, id)).toHaveLength(1);
});

test("an empty or unparseable balance is refused", async ({ page, request }) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ-TEST Chk", "checking", 1000);
  await page.goto(`/${plan}/accounts/${id}`);
  const sent = writes(page);
  await openFromHeader(page);
  for (const text of ["", "12.3.4"]) {
    await field(page, "Working Balance").fill(text);
    await realClick(page, dbutton(page, "Save"));
    await expect(dialog(page).getByText("Enter an amount", { exact: true })).toBeVisible();
  }
  expect(sent).toHaveLength(0);
  expect(await accountTxs(request, plan, id)).toHaveLength(1);
});
