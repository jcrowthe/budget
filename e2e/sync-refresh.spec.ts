import { expect, test } from "./fixtures";
import { dialogNamed, openDetail, posts } from "./support/manage-connections-seed";
import { stubPlaidLink } from "./support/plaid-stub";
import { realClick } from "./support/real-click";
import { refreshState, syncs } from "./support/sync-refresh-state";

const OK = {
  success: {
    public_token: "public-test-token",
    institution: { name: "ZZ Bank", institution_id: "ins_test_1" },
  },
};

test("15 a bank account the bank now lists shows in the connection's detail with the unlinked actions", async ({
  page,
  request,
}) => {
  const s = await refreshState(page, request);
  await expect.poll(() => syncs(s).length).toBe(1);
  const detail = await openDetail(page, "ZZ Bank");
  const row = detail.getByRole("button", { name: "ZZ Rewards – 4321", exact: true });
  await expect(row).toBeVisible();
  // The new account is the last bank-account row of the detail.
  await expect(detail.getByRole("button", { name: / – \d{4}$/ }).last()).toHaveAccessibleName(
    "ZZ Rewards – 4321",
  );
  await expect(row).not.toContainText("Linked to");
  await realClick(page, row);
  const options = dialogNamed(page, "ZZ Rewards – 4321");
  await expect(
    options.getByRole("button", { name: "Link to an Existing Account", exact: true }),
  ).toBeVisible();
  await expect(
    options.getByRole("button", { name: "Add as a new Account", exact: true }),
  ).toBeVisible();
});

test("16 Relink offers the bank account the bank now lists", async ({ page, request }) => {
  const s = await refreshState(page, request, {}, true);
  await expect.poll(() => syncs(s).length).toBe(1);
  await page.goto(`/${s.plan}/accounts/${s.linked}`);
  const strip = page.locator(".acct-connection-strip");
  await realClick(page, strip.getByRole("button", { name: "Relink", exact: true }));
  const dialog = dialogNamed(page, "Link Account");
  await expect(dialog).toBeVisible();
  await realClick(page, dialog.getByRole("button", { name: /ZZ Rewards/ }));
  await expect
    .poll(() => posts(s.stub.requests, "POST", /\/accounts\/[^/]+\/link$/).length)
    .toBe(1);
  expect(posts(s.stub.requests, "POST", /\/accounts\/[^/]+\/link$/)[0]?.body).toMatchObject({
    bank_account_id: s.rewards.id,
  });
  await expect(strip).toHaveCount(0);
});

test("17 after Repair the new bank account shows in the open detail", async ({ page, request }) => {
  await stubPlaidLink(page, OK);
  const s = await refreshState(page, request, { status: "login_required" });
  const detail = await openDetail(page, "ZZ Bank");
  await expect(detail.getByRole("button", { name: "ZZ Rewards – 4321", exact: true })).toHaveCount(
    0,
  );
  await realClick(page, detail.getByRole("button", { name: "Repair", exact: true }));
  await expect.poll(() => posts(s.stub.requests, "POST", /\/reset$/).length).toBe(1);
  await expect
    .poll(() => posts(s.stub.requests, "POST", /\/bank-connections\/[^/]+\/sync$/).length)
    .toBe(1);
  await expect(
    dialogNamed(page, "ZZ Bank").getByRole("button", { name: "ZZ Rewards – 4321", exact: true }),
  ).toBeVisible();
});
