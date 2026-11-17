import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import { fakeInstitution, stubApi, stubPlaidLink } from "./support/plaid-stub";

async function newPlan(request: APIRequestContext, bank_environment?: "sandbox" | "production") {
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: testName("bank"), bank_environment },
  });
  return (await res.json()).data.budget.id as string;
}
const openModal = async (page: Page) => {
  await page.getByRole("button", { name: "Add Account" }).click();
  return page.getByRole("dialog", { name: "Add Accounts" });
};

const CONNECTION = {
  data: {
    bank_connection: {
      id: "11111111-1111-4111-8111-111111111111",
      display_id: "0a1b2c",
      environment: "sandbox",
      institution_id: "ins_test_1",
      institution_name: "ZZ Test Bank",
      institution_logo: null,
      nickname: "ZZ Test Bank",
      status: "connected",
      provider: "Plaid",
      last_synced_at: null,
      last_reset_at: null,
      created_at: "2030-01-01T00:00:00Z",
      accounts: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          bank_connection_id: "11111111-1111-4111-8111-111111111111",
          name: "ZZ Checking",
          mask: "0000",
          type: "depository",
          subtype: "checking",
          current_balance: 110000,
          available_balance: null,
          balance_updated_at: null,
          linked_account_id: null,
        },
      ],
    },
  },
};

test("start screen", async ({ page, request }) => {
  await stubApi(page, { popular: Array.from({ length: 10 }, (_, i) => fakeInstitution(i)) });
  await page.goto(`/${await newPlan(request)}/budget`);
  const dialog = await openModal(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Back" })).toHaveCount(0);
  await expect(page.getByLabel("Search for your bank")).toBeFocused();
  await expect(dialog.getByText("Search by institution name or web address (URL)")).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Popular Options" })).toBeVisible();
  await expect(dialog.locator(".bank-tile")).toHaveCount(10);
  await expect(dialog.getByText("or", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add an Unlinked Account" })).toBeVisible();
});

test("the Manage Bank Connections variant has a Back arrow and no unlinked button", async ({
  page,
  request,
}) => {
  await stubApi(page, { popular: [fakeInstitution(1)] });
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  await page.getByRole("button", { name: "Bank Connections", exact: true }).click();
  await page.getByRole("button", { name: "Add a New Bank Connection" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Accounts" });
  await expect(dialog.getByRole("button", { name: "Back" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add an Unlinked Account" })).toHaveCount(0);
  await expect(dialog.getByText("or", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("dialog", { name: "Manage Bank Connections" })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page).not.toHaveURL(/add-accounts/);
});

test("typing lists at most 10 results; clearing brings back Popular Options", async ({
  page,
  request,
}) => {
  const requests = await stubApi(page, {
    popular: [fakeInstitution(1)],
    search: () => Array.from({ length: 12 }, (_, i) => fakeInstitution(i)),
  });
  await page.goto(`/${await newPlan(request)}/budget`);
  const dialog = await openModal(page);
  await page.getByLabel("Search for your bank").fill("plat");
  await expect(dialog.getByRole("heading", { name: "Results" })).toBeVisible();
  const rows = dialog.locator(".institution-row");
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText("ZZ Test Bank 0");
  await expect(rows.first()).toContainText("United States");
  await expect(rows.first()).toContainText("zz-test-bank-0.example");
  await expect(rows.first()).not.toContainText("www.");
  await expect(rows.first()).toHaveAttribute("title", "https://www.zz-test-bank-0.example/");
  await expect(dialog.getByRole("heading", { name: "Popular Options" })).toHaveCount(0);
  // The "or" divider and the unlinked button go with Popular Options (source behaviour).
  await expect(dialog.getByRole("button", { name: "Add an Unlinked Account" })).toHaveCount(0);
  expect(requests.some((r) => r.url.includes("query=plat"))).toBe(true);
  await page.getByLabel("Search for your bank").fill("");
  await expect(dialog.getByRole("heading", { name: "Popular Options" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add an Unlinked Account" })).toBeVisible();
});

test("no match: the sentence, and the link opens the unlinked flow", async ({ page, request }) => {
  await stubApi(page, { popular: [fakeInstitution(1)], search: () => [] });
  await page.goto(`/${await newPlan(request)}/budget`);
  const dialog = await openModal(page);
  await page.getByLabel("Search for your bank").fill("zzqxv");
  await expect(
    dialog.getByText(
      `We couldn't find a financial institution named "zzqxv" that supports Direct Import.`,
    ),
  ).toBeVisible();
  await expect(dialog.getByText("Don't worry, you can still")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add an Unlinked Account" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "continue setting up this account" }).click();
  await expect(page.getByRole("dialog", { name: "Add Unlinked Account" })).toBeVisible();
});

test("a search error shows under the field and typing again works", async ({ page, request }) => {
  let fail = true;
  await stubApi(page, {
    popular: [fakeInstitution(1)],
    search: () => (fail ? { status: 502 } : [fakeInstitution(7)]),
  });
  await page.goto(`/${await newPlan(request)}/budget`);
  const dialog = await openModal(page);
  const field = page.getByLabel("Search for your bank");
  await field.fill("plat");
  await expect(dialog.getByRole("alert")).toHaveText("Something went wrong. Try again.");
  fail = false;
  await field.fill("platy");
  await expect(dialog.locator(".institution-row")).toHaveCount(1);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("a production plan with no credentials says bank connections are not set up", async ({
  page,
  request,
}) => {
  await page.goto(`/${await newPlan(request)}/budget`);
  const dialog = await openModal(page);
  await expect(dialog.getByRole("alert")).toHaveText("Bank connections are not set up");
  await expect(dialog.getByRole("button", { name: "Add an Unlinked Account" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Popular Options" })).toHaveCount(0);
});

test("only a sandbox plan shows the Sandbox mark", async ({ page, request }) => {
  await stubApi(page, { popular: [fakeInstitution(1)] });
  await page.goto(`/${await newPlan(request, "sandbox")}/budget`);
  const dialog = await openModal(page);
  await expect(dialog.getByText("Sandbox", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.goto(`/${await newPlan(request)}/budget`);
  const prod = await openModal(page);
  await expect(prod.getByLabel("Search for your bank")).toBeVisible();
  await expect(prod.getByText("Sandbox", { exact: true })).toHaveCount(0);
});

test("link success shows the Add Accounts step; Next leads to the summary", async ({
  page,
  request,
}) => {
  const requests = await stubApi(page, {
    popular: [fakeInstitution(1)],
    create: CONNECTION,
  });
  await stubPlaidLink(page, {
    success: {
      public_token: "public-test-token",
      institution: { name: "ZZ Test Bank", institution_id: "ins_test_1" },
    },
  });
  const id = await newPlan(request, "sandbox");
  await page.goto(`/${id}/budget`);
  const dialog = await openModal(page);
  await dialog.getByRole("button", { name: "ZZ Test Bank 1" }).click();
  await expect(dialog.getByText("ZZ Checking – 0000")).toBeVisible();
  await expect(dialog.getByText("Checking | $110.00")).toBeVisible();
  const post = requests.find((r) => r.method === "POST" && !r.url.includes("link-token"));
  expect(post?.body).toMatchObject({
    budget_id: id,
    public_token: "public-test-token",
    institution_id: "ins_test_1",
  });
  await expect(dialog.getByRole("button", { name: "Next" })).toBeEnabled();
});

test("closing Link creates nothing, keeps the query and shows Plaid's message", async ({
  page,
  request,
}) => {
  const requests = await stubApi(page, {
    popular: [fakeInstitution(1)],
    search: () => [fakeInstitution(3)],
  });
  await stubPlaidLink(page, { exit: { display_message: "The credentials were not correct." } });
  await page.goto(`/${await newPlan(request, "sandbox")}/budget`);
  const dialog = await openModal(page);
  await page.getByLabel("Search for your bank").fill("plat");
  await dialog.locator(".institution-row").first().click();
  await expect(dialog.getByRole("alert")).toHaveText("The credentials were not correct.");
  await expect(page.getByLabel("Search for your bank")).toHaveValue("plat");
  await expect(dialog.locator(".institution-row")).toHaveCount(1);
  expect(requests.filter((r) => r.method === "POST" && !r.url.includes("link-token"))).toHaveLength(
    0,
  );
});

test("/plaid/oauth resumes Link with the received URL and shows the Add Accounts step", async ({
  page,
}) => {
  await stubApi(page, { create: CONNECTION });
  await stubPlaidLink(page, {
    success: {
      public_token: "public-test-token",
      institution: { name: "ZZ Test Bank", institution_id: "ins_test_1" },
    },
  });
  const planId = "33333333-3333-4333-8333-333333333333";
  await page.goto("/plaid/oauth?oauth_state_id=x");
  await page.evaluate((b) => {
    sessionStorage.setItem(
      "budget.plaidLink",
      JSON.stringify({ link_token: "link-test", budget_id: b, query: "" }),
    );
  }, planId);
  await page.goto("/plaid/oauth?oauth_state_id=x");
  const dialog = page.getByRole("dialog", { name: "Add Accounts" });
  await expect(dialog.getByText("ZZ Checking – 0000")).toBeVisible();
  await expect(dialog.getByText("Checking | $110.00")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Next" })).toBeVisible();
  const cfg = await page.evaluate(
    () =>
      (window as unknown as { __plaidConfig: { token: string; receivedRedirectUri: string } })
        .__plaidConfig,
  );
  expect(cfg.token).toBe("link-test");
  expect(cfg.receivedRedirectUri).toBe(page.url());
  expect(page.url()).toContain("oauth_state_id=x");
});

test("/plaid/oauth without saved state says it cannot resume", async ({ page }) => {
  await page.goto("/plaid/oauth");
  await expect(page.getByText("This bank connection could not be resumed.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Budget" })).toBeVisible();
});
