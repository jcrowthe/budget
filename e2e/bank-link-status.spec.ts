import { expect, test } from "./fixtures";
import { newAccount, newPlan } from "./support/account-edit-seed";
import { fakeBankAccount, fakeConnection, stubBankLink } from "./support/bank-link-stub";

const sidebar = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Sidebar" });
const HOUR_AGO = () => new Date(Date.now() - 3_600_000).toISOString();

test("12 sidebar icons, the unapproved dot and the header's status", async ({ page, request }) => {
  const plan = await newPlan(request);
  const ok = await newAccount(request, plan, "ZZ Fine", "checking", 0);
  const slow = await newAccount(request, plan, "ZZ Slow", "checking", 0);
  const lost = await newAccount(request, plan, "ZZ Lost", "savings", 0);
  const plain = await newAccount(request, plan, "ZZ Plain", "checking", 0);
  const bank = (name: string) => fakeBankAccount({ name });
  const [a, b, c] = [bank("ZZ A"), bank("ZZ B"), bank("ZZ C")];
  const connections = [
    fakeConnection({
      nickname: "ZZ One",
      status: "connected",
      last_synced_at: HOUR_AGO(),
      accounts: [a],
    }),
    fakeConnection({
      nickname: "ZZ Two",
      status: "delayed",
      last_synced_at: HOUR_AGO(),
      accounts: [b],
    }),
    fakeConnection({
      nickname: "ZZ Three",
      status: "login_required",
      last_synced_at: HOUR_AGO(),
      accounts: [c],
    }),
  ];
  const stub = await stubBankLink(page, request, {
    budgetId: plan,
    connections,
    links: { [ok]: a.id, [slow]: b.id, [lost]: c.id },
    unapproved: { [slow]: 2 },
  });
  await page.goto(`/${plan}/accounts/${ok}`);
  const row = (name: string) => sidebar(page).locator(".nav-account-row").filter({ hasText: name });
  await expect(row("ZZ Fine").locator(".nav-link-status")).toHaveAttribute(
    "aria-label",
    "Connected",
  );
  await expect(row("ZZ Slow").locator(".nav-link-status")).toHaveAttribute(
    "aria-label",
    "Imports Delayed",
  );
  await expect(row("ZZ Lost").locator(".nav-link-status")).toHaveAttribute(
    "aria-label",
    "Connection Repair Needed",
  );
  await expect(row("ZZ Plain").locator(".nav-link-status")).toHaveCount(0);
  await expect(sidebar(page).locator(".nav-unapproved-dot")).toHaveCount(1);
  await expect(row("ZZ Slow").locator(".nav-unapproved-dot")).toHaveAttribute(
    "title",
    "Unapproved transactions",
  );

  const info = page.getByRole("main").locator(".acct-info");
  for (const [id, type, label] of [
    [ok, "Checking", "Connected"],
    [slow, "Checking", "Imports Delayed"],
    [lost, "Savings", "Connection Repair Needed"],
  ] as const) {
    await page.goto(`/${plan}/accounts/${id}`);
    const items = info.locator(".acct-info-item");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveText(type);
    await expect(items.nth(1)).toHaveText(label);
    await expect(items.nth(1).locator("svg")).toHaveCount(1);
    await expect(items.nth(2)).toHaveText("Not Yet Reconciled");
  }
  await page.goto(`/${plan}/accounts/${plain}`);
  await expect(info.locator(".acct-info-item")).toHaveCount(2);
  // All three were synced an hour ago: opening the plan sent no sync.
  expect(stub.requests.filter((r) => r.method === "POST" && r.url.endsWith("/sync"))).toHaveLength(
    0,
  );
});
