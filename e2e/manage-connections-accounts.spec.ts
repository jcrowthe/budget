import { expect, test } from "./fixtures";
import {
  addAccount,
  dialogNamed,
  openDetail,
  posts,
  setup,
  sidebar,
} from "./support/manage-connections-seed";
import { realClick } from "./support/real-click";

const planSyncs = (reqs: { method: string; url: string }[]) =>
  reqs.filter((r) => r.method === "POST" && /\/budgets\/[^/]+\/sync$/.test(r.url));

/** ZZ Linked is linked to ZZ Checking (the stand-in); also ZZ Spare, a cash ZZ Wallet and a closed ZZ Shut. */
async function withAccounts(
  page: Parameters<typeof setup>[0],
  request: Parameters<typeof setup>[1],
) {
  const s = await setup(page, request, (z) => [z.connection]);
  await addAccount(request, s.budgetId, "ZZ Spare", "checking", { balance: 50000 });
  await addAccount(request, s.budgetId, "ZZ Wallet", "cash");
  const shut = await addAccount(request, s.budgetId, "ZZ Shut", "checking");
  const { authHeaders } = await import("./support/auth");
  const res = await request.post(`/api/v1/budgets/${s.budgetId}/accounts/${shut}/close`, {
    headers: await authHeaders(),
    data: {},
  });
  expect(res.status()).toBeLessThan(300);
  await page.reload();
  await expect(sidebar(page).getByRole("link", { name: /ZZ Spare/ })).toBeVisible();
  return s;
}

test("8 Link to an Existing Account: only open, unlinked, non-Cash accounts; one link, one sync", async ({
  page,
  request,
}) => {
  const { stub } = await withAccounts(page, request);
  const detail = await openDetail(page, "ZZ Bank");
  await realClick(page, detail.getByRole("button", { name: "ZZ Savings – 1111", exact: true }));
  const options = dialogNamed(page, "ZZ Savings – 1111");
  await realClick(page, options.getByRole("button", { name: "Link to an Existing Account" }));
  const choose = dialogNamed(page, "Link to an Existing Account");
  await expect(choose.getByRole("button", { name: "ZZ Spare", exact: true })).toContainText(
    "Checking | $50.00",
  );
  await expect(choose.getByRole("button", { name: "ZZ Linked", exact: true })).toHaveCount(0);
  await expect(choose.getByRole("button", { name: "ZZ Wallet", exact: true })).toHaveCount(0);
  await expect(choose.getByRole("button", { name: "ZZ Shut", exact: true })).toHaveCount(0);
  const syncsBefore = planSyncs(stub.requests).length;
  await realClick(page, choose.getByRole("button", { name: "ZZ Spare", exact: true }));
  await expect.poll(() => posts(stub.requests, "POST", /\/accounts\/[^/]+\/link$/).length).toBe(1);
  const link = posts(stub.requests, "POST", /\/accounts\/[^/]+\/link$/)[0];
  expect(link?.body).toMatchObject({
    bank_account_id: expect.any(String),
    today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  });
  await expect.poll(() => planSyncs(stub.requests).length).toBe(syncsBefore + 1);
  const back = dialogNamed(page, "ZZ Bank");
  await expect(back.getByRole("button", { name: "ZZ Savings – 1111", exact: true })).toContainText(
    "Linked to ZZ Spare",
  );
  await expect(sidebar(page).getByRole("link", { name: /ZZ Spare/ })).toBeVisible();
});

test("9 Add as a new Account: Account Details, one from-bank with the override and one sync", async ({
  page,
  request,
}) => {
  const { stub, z } = await withAccounts(page, request);
  const detail = await openDetail(page, "ZZ Bank");
  await realClick(page, detail.getByRole("button", { name: "ZZ Savings – 1111", exact: true }));
  await realClick(
    page,
    dialogNamed(page, "ZZ Savings – 1111").getByRole("button", { name: "Add as a new Account" }),
  );
  const form = dialogNamed(page, "Account Details");
  await form.getByLabel("Account Nickname").fill("ZZ Rainy");
  const syncsBefore = planSyncs(stub.requests).length;
  await realClick(page, form.getByRole("button", { name: "Add Account", exact: true }));
  await expect.poll(() => posts(stub.requests, "POST", /\/accounts\/from-bank$/).length).toBe(1);
  const body = posts(stub.requests, "POST", /\/accounts\/from-bank$/)[0]?.body as {
    bank_account_ids: string[];
    overrides: Record<string, { name: string }>;
  };
  expect(body.bank_account_ids).toEqual([z.savings.id]);
  expect(body.overrides[z.savings.id]?.name).toBe("ZZ Rainy");
  await expect(sidebar(page).getByRole("link", { name: /ZZ Rainy/ })).toBeVisible();
  await expect.poll(() => planSyncs(stub.requests).length).toBe(syncsBefore + 1);
  await expect(dialogNamed(page, "ZZ Bank")).toBeVisible();
});

test("10 Unlink: the sentence, the confirmation, one DELETE, Not linked in this plan", async ({
  page,
  request,
}) => {
  const { stub } = await setup(page, request, (z) => [z.connection]);
  const detail = await openDetail(page, "ZZ Bank");
  await realClick(page, detail.getByRole("button", { name: "ZZ Checking – 0000", exact: true }));
  const options = dialogNamed(page, "ZZ Checking – 0000");
  await expect(
    options.getByText('Linked to "ZZ Linked" in this plan.', { exact: true }),
  ).toBeVisible();
  await realClick(page, options.getByRole("button", { name: "Unlink", exact: true }));
  const confirm = dialogNamed(page, "Unlink Account");
  await realClick(page, confirm.getByRole("button", { name: "Unlink Account" }));
  await expect
    .poll(() => posts(stub.requests, "DELETE", /\/accounts\/[^/]+\/link$/).length)
    .toBe(1);
  const back = dialogNamed(page, "ZZ Bank");
  await expect(back.getByRole("heading", { name: "Not linked in this plan" })).toBeVisible();
});
