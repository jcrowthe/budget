import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { stubBankLink } from "./support/bank-link-stub";
import {
  addAccount,
  dialogNamed,
  newPlan,
  oneAccountBank,
  posts,
  setup,
  sidebar,
  zzBank,
} from "./support/manage-connections-seed";
import { stubPlaidLink } from "./support/plaid-stub";
import { realClick } from "./support/real-click";

const OK = {
  success: {
    public_token: "public-test-token",
    institution: { name: "ZZ Bank", institution_id: "ins_test_1" },
  },
};
const CLOSED = { exit: { display_message: null } };
const REPAIR = "Repair your bank connection to continue importing transactions.";
const BROKEN = "This bank connection cannot be repaired. Remove it and connect the bank again.";
const DELAY = "Imports have been delayed for over 3 days. Try Reset in Bank Connections.";
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const idx = (reqs: { method: string; url: string }[], method: string, tail: RegExp) =>
  reqs.findIndex((r) => r.method === method && tail.test(new URL(r.url).pathname));

const strip = (page: import("@playwright/test").Page) => page.locator(".acct-connection-strip");
const stripText = (page: import("@playwright/test").Page) => page.locator(".acct-connection-text");

async function openLinked(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  zz: Parameters<typeof setup>[3] extends infer O
    ? O extends { zz?: infer Z }
      ? Z
      : never
    : never,
) {
  const s = await setup(page, request, (z) => [z.connection], { zz });
  await page.goto(`/${s.budgetId}/accounts/${s.linkedId}`);
  await expect(page.getByRole("heading", { name: "ZZ Linked", exact: true })).toBeVisible();
  return s;
}

test("1 a connection that needs a sign-in: its label and the strip with Repair", async ({
  page,
  request,
}) => {
  await openLinked(page, request, { status: "login_required", last_synced_at: hoursAgo(1) });
  await expect(stripText(page)).toHaveText(REPAIR);
  await expect(strip(page).getByRole("button", { name: "Repair", exact: true })).toBeEnabled();
  await expect(page.locator(".acct-link-status")).toHaveText("Connection Repair Needed");
});

test("2 Repair: token, reset, one sync, then no strip and Connected", async ({ page, request }) => {
  await stubPlaidLink(page, OK);
  const s = await openLinked(page, request, {
    status: "login_required",
    last_synced_at: hoursAgo(1),
  });
  await realClick(page, strip(page).getByRole("button", { name: "Repair", exact: true }));
  await expect
    .poll(() => posts(s.stub.requests, "POST", /\/bank-connections\/[^/]+\/sync$/).length)
    .toBe(1);
  const reqs = s.stub.requests;
  const tokenAt = idx(reqs, "POST", /\/link-token$/);
  const resetAt = idx(reqs, "POST", /\/reset$/);
  const syncAt = idx(reqs, "POST", /\/sync$/);
  expect(tokenAt).toBeGreaterThan(-1);
  expect(tokenAt).toBeLessThan(resetAt);
  expect(resetAt).toBeLessThan(syncAt);
  await expect(strip(page)).toHaveCount(0);
  await expect(page.locator(".acct-link-status")).toHaveText("Connected");
  expect(posts(reqs, "POST", /\/sync$/)).toHaveLength(1);
});

test("3 a closed sign-in is a notice: no alert, no reset, the strip stays", async ({
  page,
  request,
}) => {
  await stubPlaidLink(page, CLOSED);
  const s = await openLinked(page, request, {
    status: "login_required",
    last_synced_at: hoursAgo(1),
  });
  await realClick(page, strip(page).getByRole("button", { name: "Repair", exact: true }));
  await expect(page.getByRole("status")).toHaveText(
    "The bank sign-in was closed. Nothing was changed.",
  );
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  expect(posts(s.stub.requests, "POST", /\/reset$/)).toHaveLength(0);
  await expect(strip(page)).toBeVisible();
});

test("4 Repair is disabled for 24 hours after a reset, with the modal's reason", async ({
  page,
  request,
}) => {
  await openLinked(page, request, {
    status: "login_required",
    last_synced_at: hoursAgo(1),
    last_reset_at: hoursAgo(1),
  });
  const button = strip(page).getByRole("button", { name: "Repair", exact: true });
  await expect(button).toBeDisabled();
  await expect(strip(page).locator(".acct-connection-action")).toHaveAttribute(
    "title",
    /^Reset is available again on /,
  );
});

test("5 broken: the sentence and a way to the connection's Remove, no Repair", async ({
  page,
  request,
}) => {
  await openLinked(page, request, { status: "broken", last_synced_at: hoursAgo(1) });
  await expect(strip(page)).toContainText(BROKEN);
  await expect(strip(page).getByRole("button", { name: "Repair", exact: true })).toHaveCount(0);
  await realClick(
    page,
    strip(page).getByRole("button", { name: "Open Bank Connections", exact: true }),
  );
  const detail = dialogNamed(page, "ZZ Bank");
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("button", { name: "Remove", exact: true }).first()).toBeVisible();
});

test("6a delayed for two days: no strip", async ({ page, request }) => {
  await openLinked(page, request, { status: "delayed", last_synced_at: hoursAgo(48) });
  await expect(page.locator(".acct-link-status")).toHaveText("Imports Delayed");
  await expect(strip(page)).toHaveCount(0);
});

test("6b delayed for four days: the line, no button", async ({ page, request }) => {
  await openLinked(page, request, { status: "delayed", last_synced_at: hoursAgo(96) });
  await expect(stripText(page)).toHaveText(DELAY);
  await expect(strip(page).getByRole("button")).toHaveCount(0);
});

test("6c never synced: counted from the connection's creation", async ({ page, request }) => {
  await openLinked(page, request, {
    status: "delayed",
    last_synced_at: null,
    created_at: hoursAgo(96),
  });
  await expect(stripText(page)).toHaveText(DELAY);
});

test("6d never synced and made just now: no strip", async ({ page, request }) => {
  await openLinked(page, request, {
    status: "delayed",
    last_synced_at: null,
    created_at: hoursAgo(1),
  });
  await expect(page.locator(".acct-link-status")).toHaveText("Imports Delayed");
  await expect(strip(page)).toHaveCount(0);
});

test("7 no strip for a connected, an unlinked or a closed account, nor on All Accounts", async ({
  page,
  request,
}) => {
  const z = zzBank({ status: "login_required", last_synced_at: hoursAgo(1) });
  const plan = await newPlan(request);
  const linked = await addAccount(request, plan, "ZZ Linked", "checking");
  const plain = await addAccount(request, plan, "ZZ Plain", "checking");
  const shut = await addAccount(request, plan, "ZZ Shut", "savings");
  await request.post(`/api/v1/budgets/${plan}/accounts/${shut}/close`, {
    headers: await authHeaders(),
    data: {},
  });
  await stubBankLink(page, request, {
    budgetId: plan,
    connections: [z.connection, oneAccountBank("ZZ Fine", "connected", "9f8e7d")],
    links: { [linked]: z.checking.id, [shut]: z.savings.id },
  });
  await page.goto(`/${plan}/accounts/${linked}`);
  await expect(stripText(page)).toHaveText(REPAIR);
  await page.goto(`/${plan}/accounts/${plain}`);
  await expect(page.getByRole("heading", { name: "ZZ Plain", exact: true })).toBeVisible();
  await expect(strip(page)).toHaveCount(0);
  await page.goto(`/${plan}/accounts/${shut}`);
  await expect(page.getByRole("heading", { name: "ZZ Shut", exact: true })).toBeVisible();
  await expect(strip(page)).toHaveCount(0);
  await page.goto(`/${plan}/accounts`);
  await expect(page.getByRole("heading", { name: "All Accounts", exact: true })).toBeVisible();
  await expect(strip(page)).toHaveCount(0);
  await expect(sidebar(page)).toBeVisible();
});
