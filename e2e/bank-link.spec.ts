import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import {
  type FakeConnection,
  fakeBankAccount,
  fakeConnection,
  stubBankLink,
} from "./support/bank-link-stub";
import { stubPlaidLink } from "./support/plaid-stub";
import { realClick } from "./support/real-click";

async function newPlan(request: APIRequestContext, env: "sandbox" | "production" = "sandbox") {
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: testName("bank-link"), bank_environment: env },
  });
  return (await res.json()).data.budget.id as string;
}
async function addAccount(request: APIRequestContext, id: string, name: string, type: string) {
  const res = await request.post(`/api/v1/budgets/${id}/accounts`, {
    headers: await authHeaders(),
    data: { name, type, balance: 0 },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).data.account.id as string;
}

/** The fixture bank: three accounts to add and one already linked in the plan. */
function bank() {
  const checking = fakeBankAccount({ name: "ZZ Checking", mask: "0000" });
  const savings = fakeBankAccount({
    name: "ZZ Savings",
    mask: null,
    subtype: "savings",
    current_balance: 300000,
    plan_type: "savings",
  });
  const card = fakeBankAccount({
    name: "ZZ Card",
    mask: "4444",
    type: "credit",
    subtype: "credit card",
    current_balance: 420250,
    plan_type: "creditCard",
  });
  const old = fakeBankAccount({ name: "ZZ Old", mask: "9999", current_balance: 10000 });
  const connection: FakeConnection = fakeConnection({
    nickname: "ZZ Bank",
    accounts: [checking, savings, card, old],
  });
  return { checking, savings, card, old, connection };
}

const PUBLIC = {
  public_token: "public-test-token",
  institution: { name: "ZZ Bank", institution_id: "ins_test_1" },
};
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Sidebar" });

/** A sandbox plan with ZZ Linked (linked to ZZ Old); the stand-in connects to the fixture bank. */
async function setup(
  page: Page,
  request: APIRequestContext,
  over: {
    fromBank?: Parameters<typeof stubBankLink>[2]["fromBank"];
    /** The first sync brings this many unapproved rows to ZZ Checking. */
    checkingUnapproved?: number;
  } = {},
) {
  const b = bank();
  const budgetId = await newPlan(request);
  const linkedId = await addAccount(request, budgetId, "ZZ Linked", "checking");
  const stub = await stubBankLink(page, request, {
    budgetId,
    connections: [],
    newConnection: b.connection,
    links: { [linkedId]: b.old.id },
    orphanSyncedAt: new Date(Date.now() - 3_600_000).toISOString(), // ZZ Old's connection is not listed until the bank connects
    ...(over.fromBank ? { fromBank: over.fromBank } : {}),
    ...(over.checkingUnapproved
      ? { afterSync: { unapproved: { [b.checking.id]: over.checkingUnapproved } } }
      : {}),
  });
  await stubPlaidLink(page, { success: PUBLIC });
  await page.goto(`/${budgetId}/budget`);
  return { b, budgetId, stub };
}
async function openStep(page: Page) {
  await page.getByRole("button", { name: "Add Account" }).click();
  const dialog = page.locator(".account-modal"); // its title (and so its name) changes per screen
  await dialog.getByRole("button", { name: "ZZ Test Bank 1" }).click();
  await expect(dialog.getByText("ZZ Checking – 0000", { exact: true })).toBeVisible();
  return dialog;
}
const fromBankPosts = (reqs: { method: string; url: string }[]) =>
  reqs.filter((r) => r.method === "POST" && r.url.endsWith("/accounts/from-bank"));
const planSyncs = (reqs: { method: string; url: string }[]) =>
  reqs.filter((r) => r.method === "POST" && /\/budgets\/[^/]+\/sync$/.test(r.url));

test("1 list: rows, ticks, the linked row and the Sandbox pill", async ({ page, request }) => {
  await setup(page, request);
  const dialog = await openStep(page);
  await expect(dialog.getByText("Checking | $1,250.50", { exact: true })).toBeVisible();
  await expect(dialog.getByText("ZZ Savings", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/^Credit Card \| .\$420\.25$/)).toBeVisible();
  await expect(dialog.getByText("ZZ Card – 4444", { exact: true })).toBeVisible();
  for (const n of ["ZZ Checking – 0000", "ZZ Savings", "ZZ Card – 4444"]) {
    await expect(dialog.getByRole("checkbox", { name: n, exact: true })).toBeChecked();
  }
  const old = dialog.getByRole("checkbox", { name: "ZZ Old – 9999", exact: true });
  await expect(old).toBeDisabled();
  await expect(old).not.toBeChecked();
  await expect(dialog.getByText("Linked", { exact: true })).toHaveAttribute(
    "title",
    'Already linked to "ZZ Linked" in this plan',
  );
  await expect(dialog.getByText("Sandbox", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText(
      "Accounts you leave unchecked can be linked later from an account's Edit Account.",
    ),
  ).toBeVisible();
});

test("2 Add 2 Accounts: one request, dialog closes, sidebar shows the accounts, one sync", async ({
  page,
  request,
}) => {
  const { b, stub } = await setup(page, request, {
    checkingUnapproved: 2,
  });
  const dialog = await openStep(page);
  await realClick(page, dialog.getByRole("checkbox", { name: "ZZ Savings", exact: true }));
  await realClick(page, dialog.getByRole("button", { name: "Next", exact: true }));
  await expect(
    dialog.getByText("These accounts will be added to your plan", { exact: false }),
  ).toBeVisible();
  await expect(dialog.locator(".bank-link-row")).toHaveCount(2);
  await realClick(page, dialog.getByRole("button", { name: "Add 2 Accounts", exact: true }));
  await expect(page.getByRole("dialog", { name: "Add Accounts" })).toHaveCount(0);
  await expect.poll(() => fromBankPosts(stub.requests).length).toBe(1);
  const body = fromBankPosts(stub.requests)[0]?.body as Record<string, unknown>;
  expect(body.bank_account_ids).toEqual([b.checking.id, b.card.id]);
  expect(body.overrides).toBeUndefined();
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  expect(body.today).toBe(today);
  await expect(sidebar(page).getByRole("link", { name: /ZZ Checking/ })).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name: /ZZ Card/ })).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name: /ZZ Savings/ })).toHaveCount(0);
  await expect.poll(() => planSyncs(stub.requests).length).toBe(1);
  // Each new account shows the linked mark; the sync brought unapproved rows to ZZ Checking only.
  await expect(sidebar(page).locator(".nav-link-status")).toHaveCount(3); // ZZ Linked, ZZ Checking, ZZ Card
  await expect(sidebar(page).locator(".nav-unapproved-dot")).toHaveCount(1);
  await page.waitForTimeout(800);
  expect(planSyncs(stub.requests)).toHaveLength(1);
});

test("3 Starting Balance of a new linked account", async ({ page, request }) => {
  const { budgetId } = await setup(page, request);
  const dialog = await openStep(page);
  await realClick(page, dialog.getByRole("button", { name: "Next", exact: true }));
  await realClick(page, dialog.getByRole("button", { name: "Add 3 Accounts", exact: true }));
  await expect(page.getByRole("dialog", { name: "Add Accounts" })).toHaveCount(0);
  const link = sidebar(page).getByRole("link", { name: /ZZ Checking/ });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/${budgetId}/accounts/`));
  const rows = page.getByRole("row").filter({ hasText: "Starting Balance" });
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("$1,250.50");
});

test("4 Edit: the sentence, no Cash, the override is sent", async ({ page, request }) => {
  const { b, stub } = await setup(page, request);
  const dialog = await openStep(page);
  await realClick(page, dialog.getByRole("button", { name: "Edit ZZ Savings", exact: true }));
  await expect(dialog.getByRole("heading", { name: "Account Details" })).toBeVisible();
  await expect(
    dialog.getByText("The type of account cannot be changed once created."),
  ).toBeVisible();
  await expect(dialog.getByRole("option", { name: "Cash", exact: true })).toHaveCount(0);
  await dialog.getByLabel("Account Nickname").fill("ZZ Rainy");
  await dialog.getByLabel("Account Type").selectOption({ label: "Checking" });
  await realClick(page, dialog.getByRole("button", { name: "Save", exact: true }));
  await expect(dialog.getByText("Checking | $300.00", { exact: true })).toBeVisible();
  await expect(dialog.getByText("ZZ Rainy", { exact: true })).toBeVisible();
  await realClick(page, dialog.getByRole("button", { name: "Next", exact: true }));
  await realClick(page, dialog.getByRole("button", { name: "Add 3 Accounts", exact: true }));
  await expect.poll(() => fromBankPosts(stub.requests).length).toBe(1);
  const body = fromBankPosts(stub.requests)[0]?.body as Record<string, unknown>;
  expect(body.overrides).toEqual({ [b.savings.id]: { name: "ZZ Rainy", type: "checking" } });
  await expect(sidebar(page).getByRole("link", { name: /ZZ Rainy/ })).toBeVisible();
});

test("5 a refusal keeps the summary with its message", async ({ page, request }) => {
  const { stub } = await setup(page, request, {
    fromBank: {
      status: 409,
      name: "name_taken",
      detail: "This account name already exists: ZZ Card",
    },
  });
  const dialog = await openStep(page);
  await realClick(page, dialog.getByRole("button", { name: "Next", exact: true }));
  await realClick(page, dialog.getByRole("button", { name: "Add 3 Accounts", exact: true }));
  await expect(dialog.getByRole("alert")).toHaveText("This account name already exists: ZZ Card");
  await expect(dialog.getByRole("button", { name: "Add 3 Accounts", exact: true })).toBeEnabled();
  await expect(sidebar(page).getByRole("link", { name: /ZZ Checking/ })).toHaveCount(0);
  expect(planSyncs(stub.requests)).toHaveLength(0);
});

test("Back and Escape step back; nothing ticked disables Next", async ({ page, request }) => {
  await setup(page, request);
  const dialog = await openStep(page);
  for (const n of ["ZZ Checking – 0000", "ZZ Savings", "ZZ Card – 4444"]) {
    await dialog.getByRole("checkbox", { name: n, exact: true }).uncheck();
  }
  await expect(dialog.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "ZZ Savings", exact: true }).check();
  await realClick(page, dialog.getByRole("button", { name: "Next", exact: true }));
  await expect(dialog.getByRole("button", { name: "Add 1 Account", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("button", { name: "Next", exact: true })).toBeVisible();
  await realClick(page, dialog.getByRole("button", { name: "Next", exact: true }));
  await realClick(page, dialog.getByRole("button", { name: "Back" }));
  await expect(dialog.getByRole("button", { name: "Next", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add Accounts" })).toHaveCount(0);
});

test("6 /plaid/oauth: the same step; Add 1 Account goes to the plan", async ({ page, request }) => {
  const b = bank();
  const budgetId = await newPlan(request);
  const stub = await stubBankLink(page, request, {
    budgetId,
    connections: [],
    newConnection: b.connection,
  });
  await stubPlaidLink(page, { success: PUBLIC });
  await page.goto("/plaid/oauth?oauth_state_id=x");
  await page.evaluate((id) => {
    sessionStorage.setItem(
      "budget.plaidLink",
      JSON.stringify({ link_token: "link-test", budget_id: id, query: "" }),
    );
  }, budgetId);
  await page.goto("/plaid/oauth?oauth_state_id=x");
  const dialog = page.getByRole("dialog", { name: "Add Accounts" });
  await expect(dialog.getByText("ZZ Checking – 0000", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Sandbox", { exact: true })).toBeVisible();
  for (const n of ["ZZ Savings", "ZZ Card – 4444", "ZZ Old – 9999"]) {
    const box = dialog.getByRole("checkbox", { name: n, exact: true });
    if (await box.isEnabled()) await box.uncheck();
  }
  await realClick(page, dialog.getByRole("button", { name: "Next", exact: true }));
  await realClick(page, dialog.getByRole("button", { name: "Add 1 Account", exact: true }));
  await expect(page).toHaveURL(new RegExp(`/${budgetId}/budget`));
  await expect(sidebar(page).getByRole("link", { name: /ZZ Checking/ })).toBeVisible();
  expect(fromBankPosts(stub.requests)).toHaveLength(1);
});
