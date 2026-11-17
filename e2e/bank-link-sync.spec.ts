import { expect, test } from "./fixtures";
import { newAccount, newPlan } from "./support/account-edit-seed";
import { fakeBankAccount, fakeConnection, stubBankLink } from "./support/bank-link-stub";

const planSyncs = (reqs: { method: string; url: string }[]) =>
  reqs.filter((r) => r.method === "POST" && /\/budgets\/[^/]+\/sync$/.test(r.url));

async function plan(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  linked: null | { last_synced_at: string | null },
  failing = false,
) {
  const budget = await newPlan(request);
  const id = await newAccount(request, budget, "ZZ Mine", "checking", 0);
  const bank = fakeBankAccount({ name: "ZZ Bank Checking" });
  const stub = await stubBankLink(page, request, {
    budgetId: budget,
    connections: linked
      ? [fakeConnection({ last_synced_at: linked.last_synced_at, accounts: [bank] })]
      : [],
    links: linked ? { [id]: bank.id } : {},
    // A failing sync leaves the account never synced, so a reload finds it due again.
    ...(failing ? { afterSync: { status: 500, detail: "The bank did not answer." } } : {}),
  });
  return { budget, id, stub };
}

test("13 never synced: one sync per page load, however the app navigates", async ({
  page,
  request,
}) => {
  const { budget, id, stub } = await plan(page, request, { last_synced_at: null }, true);
  await page.goto(`/${budget}/budget`);
  await expect.poll(() => planSyncs(stub.requests).length).toBe(1);
  await page.getByRole("link", { name: /ZZ Mine/ }).click();
  await expect(page).toHaveURL(new RegExp(`/accounts/${id}`));
  await page.getByRole("link", { name: "Plan", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${budget}/budget`));
  await page.waitForTimeout(1000);
  expect(planSyncs(stub.requests)).toHaveLength(1);
  await page.reload();
  await expect.poll(() => planSyncs(stub.requests).length).toBe(2);
});

test("13 synced seven hours ago is due; one hour ago is not", async ({ page, request }) => {
  const old = await plan(page, request, {
    last_synced_at: new Date(Date.now() - 7 * 3_600_000).toISOString(),
  });
  await page.goto(`/${old.budget}/budget`);
  await expect.poll(() => planSyncs(old.stub.requests).length).toBe(1);

  const fresh = await plan(page, request, {
    last_synced_at: new Date(Date.now() - 3_600_000).toISOString(),
  });
  await page.goto(`/${fresh.budget}/budget`);
  await expect(page.getByRole("link", { name: /ZZ Mine/ })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(planSyncs(fresh.stub.requests)).toHaveLength(0);
});

test("13 no linked account: no sync", async ({ page, request }) => {
  const { budget, stub } = await plan(page, request, null);
  await page.goto(`/${budget}/budget`);
  await expect(page.getByRole("link", { name: /ZZ Mine/ })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(planSyncs(stub.requests)).toHaveLength(0);
});
