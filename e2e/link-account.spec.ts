import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { newAccount, newPlan, openFromHeader } from "./support/account-edit-seed";
import { authHeaders } from "./support/auth";
import { fakeBankAccount, fakeConnection, stubBankLink } from "./support/bank-link-stub";
import { stubPlaidLink } from "./support/plaid-stub";
import { realClick } from "./support/real-click";

type Reqs = { method: string; url: string; body: unknown }[];
const linkPosts = (r: Reqs) => r.filter((x) => x.method === "POST" && x.url.endsWith("/link"));
const linkDeletes = (r: Reqs) => r.filter((x) => x.method === "DELETE" && x.url.endsWith("/link"));
const planSyncs = (r: Reqs) =>
  r.filter((x) => x.method === "POST" && /\/budgets\/[^/]+\/sync$/.test(x.url));
const connSyncs = (r: Reqs) =>
  r.filter((x) => x.method === "POST" && /\/bank-connections\/[^/]+\/sync/.test(x.url));
const edit = (page: Page) => page.getByRole("dialog", { name: "Edit Account" });
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Sidebar" });

function twoBankAccounts() {
  const checking = fakeBankAccount({ name: "ZZ Checking", mask: "0000" });
  const savings = fakeBankAccount({
    name: "ZZ Savings",
    mask: null,
    subtype: "savings",
    current_balance: 300000,
    plan_type: "savings",
  });
  return { checking, savings, connection: fakeConnection({ accounts: [checking, savings] }) };
}

async function addCash(request: APIRequestContext, plan: string, name: string) {
  const res = await request.post(`/api/v1/budgets/${plan}/accounts`, {
    headers: await authHeaders(),
    data: { name, type: "cash", balance: 0 },
  });
  return (await res.json()).data.account.id as string;
}

test("7 Link Account: choose a bank account, linked section, check mark, one sync", async ({
  page,
  request,
}) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ Mine", "checking", 0);
  const b = twoBankAccounts();
  const stub = await stubBankLink(page, request, { budgetId: plan, connections: [b.connection] });
  await page.goto(`/${plan}/accounts/${id}`);
  await openFromHeader(page);
  await expect(
    edit(page).getByText("Not linked. Link this account", { exact: false }),
  ).toBeVisible();
  await realClick(page, edit(page).getByRole("button", { name: "Link Account", exact: true }));
  const link = page.getByRole("dialog", { name: "Link Account" });
  await expect(link.getByText('Choose the bank account to link to "ZZ Mine".')).toBeVisible();
  await expect(link.getByRole("heading", { name: "ZZ Bank" })).toBeVisible();
  await expect(link.getByRole("button", { name: /ZZ Savings/ })).toBeVisible();
  await expect(link.getByRole("button", { name: "Add a New Bank Connection" })).toBeVisible();
  await realClick(page, link.getByRole("button", { name: /ZZ Checking – 0000/ }));
  await expect.poll(() => linkPosts(stub.requests).length).toBe(1);
  const body = linkPosts(stub.requests)[0]?.body as Record<string, string>;
  expect(body.bank_account_id).toBe(b.checking.id);
  expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(link).toHaveCount(0);
  await expect(
    edit(page).getByRole("button", { name: "Unlink Account", exact: true }),
  ).toBeVisible();
  await expect(edit(page).getByRole("button", { name: "Sync Now", exact: true })).toBeVisible();
  await expect(edit(page).getByText("Connected", { exact: true })).toBeVisible();
  await expect(sidebar(page).locator(".nav-link-status")).toHaveCount(1);
  await expect.poll(() => planSyncs(stub.requests).length).toBe(1);
});

test("8 nothing to choose: the empty sentence; a new connection lists its accounts", async ({
  page,
  request,
}) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ Mine", "checking", 0);
  const b = twoBankAccounts();
  await stubBankLink(page, request, {
    budgetId: plan,
    connections: [],
    newConnection: b.connection,
  });
  await stubPlaidLink(page, {
    success: {
      public_token: "public-test-token",
      institution: { name: "ZZ Bank", institution_id: "ins_test_1" },
    },
  });
  await page.goto(`/${plan}/accounts/${id}`);
  await openFromHeader(page);
  await realClick(page, edit(page).getByRole("button", { name: "Link Account", exact: true }));
  const link = page.getByRole("dialog", { name: "Link Account" });
  await expect(
    link.getByText(
      "There are no bank accounts to link. Add a new bank connection to link this account.",
    ),
  ).toBeVisible();
  await expect(link.getByRole("button")).toHaveCount(3); // Back, Close, Add a New Bank Connection
  await realClick(page, link.getByRole("button", { name: "Add a New Bank Connection" }));
  await expect(link.getByLabel("Search for your bank")).toBeVisible();
  await link.getByRole("button", { name: "ZZ Test Bank 1" }).click();
  await expect(link.getByRole("button", { name: /ZZ Checking – 0000/ })).toBeVisible();
  await expect(link.getByRole("button", { name: /ZZ Savings/ })).toBeVisible();
  await expect(link.getByLabel("Search for your bank")).toHaveCount(0);
});

test("9 linked dialog: type locked, Sync Now, Unlink keeps the transactions", async ({
  page,
  request,
}) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ Mine", "checking", 5000);
  const b = twoBankAccounts();
  const stub = await stubBankLink(page, request, {
    budgetId: plan,
    connections: [b.connection],
    links: { [id]: b.checking.id },
    afterSync: { result: { added: 3, matched: 1 }, delayMs: 700 },
  });
  b.connection.last_synced_at = new Date(Date.now() - 3_600_000).toISOString(); // synced 1 h ago: no sync on open
  await page.goto(`/${plan}/accounts/${id}`);
  await expect(sidebar(page).locator(".nav-link-status")).toHaveCount(1);
  await openFromHeader(page);
  const type = edit(page).getByLabel("Account Type");
  await expect(type).toBeDisabled();
  await expect(type).toHaveAttribute("title", "The type of a linked account cannot be changed.");
  await expect(edit(page).getByText("ZZ Bank · ZZ Checking – 0000")).toBeVisible();
  const sync = edit(page).getByRole("button", { name: "Sync Now", exact: true });
  await realClick(page, sync);
  await expect(edit(page).getByRole("button", { name: "Syncing…" })).toBeDisabled();
  await expect(edit(page).getByRole("status")).toHaveText("Synced: 3 new, 1 matched.");
  expect(connSyncs(stub.requests)).toHaveLength(1);
  await expect(edit(page).getByText(/^Last synced /)).toBeVisible();

  await realClick(page, edit(page).getByRole("button", { name: "Unlink Account", exact: true }));
  const confirm = page.getByRole("dialog", { name: "Unlink Account" });
  await expect(
    confirm.getByText(
      'Unlink "ZZ Mine" from its bank account? Its transactions stay in your plan, and no new transactions will be imported. You can link it again later.',
    ),
  ).toBeVisible();
  await realClick(page, confirm.getByRole("button", { name: "Unlink Account", exact: true }));
  await expect.poll(() => linkDeletes(stub.requests).length).toBe(1);
  await expect(confirm).toHaveCount(0);
  await expect(edit(page).getByRole("button", { name: "Link Account", exact: true })).toBeVisible();
  await expect(sidebar(page).locator(".nav-link-status")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("row").filter({ hasText: "Starting Balance" })).toHaveCount(1);
});

test("9 a failed Sync Now shows its detail", async ({ page, request }) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ Mine", "checking", 0);
  const b = twoBankAccounts();
  await stubBankLink(page, request, {
    budgetId: plan,
    connections: [b.connection],
    links: { [id]: b.checking.id },
    afterSync: { status: 502, detail: "The bank did not answer." },
  });
  await page.goto(`/${plan}/accounts/${id}`);
  await openFromHeader(page);
  await realClick(page, edit(page).getByRole("button", { name: "Sync Now", exact: true }));
  await expect(edit(page).getByRole("status")).toHaveText("The bank did not answer.");
});

test("9 Escape steps back from Unlink and Link, then closes", async ({ page, request }) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ Mine", "checking", 0);
  const b = twoBankAccounts();
  await stubBankLink(page, request, { budgetId: plan, connections: [b.connection] });
  await page.goto(`/${plan}/accounts/${id}`);
  await openFromHeader(page);
  await realClick(page, edit(page).getByRole("button", { name: "Link Account", exact: true }));
  await expect(page.getByRole("dialog", { name: "Link Account" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(edit(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(edit(page)).toHaveCount(0);
});

test("10 no Link Account for Cash or a closed account", async ({ page, request }) => {
  const plan = await newPlan(request);
  const cash = await addCash(request, plan, "ZZ Cash");
  const closed = await newAccount(request, plan, "ZZ Closed", "checking", 0);
  await request.post(`/api/v1/budgets/${plan}/accounts/${closed}/close`, {
    headers: await authHeaders(),
    data: {},
  });
  await stubBankLink(page, request, { budgetId: plan, connections: [] });
  for (const id of [cash, closed]) {
    await page.goto(`/${plan}/accounts/${id}`);
    await openFromHeader(page);
    await expect(edit(page).getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(edit(page).getByRole("button", { name: "Link Account" })).toHaveCount(0);
    await expect(edit(page).getByText("Bank Connection")).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
});

test("11 a 409 on link shows its message", async ({ page, request }) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ Mine", "checking", 0);
  const b = twoBankAccounts();
  await stubBankLink(page, request, {
    budgetId: plan,
    connections: [b.connection],
    link: {
      status: 409,
      name: "bank_account_already_linked",
      detail: "This bank account is already linked in this plan.",
    },
  });
  await page.goto(`/${plan}/accounts/${id}`);
  await openFromHeader(page);
  await realClick(page, edit(page).getByRole("button", { name: "Link Account", exact: true }));
  const link = page.getByRole("dialog", { name: "Link Account" });
  await realClick(page, link.getByRole("button", { name: /ZZ Checking/ }));
  await expect(link.getByRole("alert")).toHaveText(
    "This bank account is already linked in this plan.",
  );
  await expect(sidebar(page).locator(".nav-link-status")).toHaveCount(0);
});

test("/plaid/oauth with a saved link_account_id lists the bank accounts for that account", async ({
  page,
  request,
}) => {
  const plan = await newPlan(request);
  const id = await newAccount(request, plan, "ZZ Mine", "checking", 0);
  const b = twoBankAccounts();
  const stub = await stubBankLink(page, request, {
    budgetId: plan,
    connections: [],
    newConnection: b.connection,
  });
  await stubPlaidLink(page, {
    success: {
      public_token: "public-test-token",
      institution: { name: "ZZ Bank", institution_id: "ins_test_1" },
    },
  });
  await page.goto("/plaid/oauth?oauth_state_id=x");
  await page.evaluate(
    ([budget, account]) => {
      sessionStorage.setItem(
        "budget.plaidLink",
        JSON.stringify({
          link_token: "link-test",
          budget_id: budget,
          query: "",
          link_account_id: account,
        }),
      );
    },
    [plan, id],
  );
  await page.goto("/plaid/oauth?oauth_state_id=x");
  const link = page.getByRole("dialog", { name: "Link Account" });
  await expect(link.getByText('Choose the bank account to link to "ZZ Mine".')).toBeVisible();
  await realClick(page, link.getByRole("button", { name: /ZZ Savings/ }));
  await expect(page).toHaveURL(new RegExp(`/${plan}/accounts/${id}`));
  expect(linkPosts(stub.requests)).toHaveLength(1);
});
