import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { api, newAccount, newPlan } from "./support/account-edit-seed";
import { fakeBankAccount, fakeConnection, stubBankLink } from "./support/bank-link-stub";
import { realClick } from "./support/real-click";

// EXF-774, acceptance case 10: built from the ticket (nothing linked is opened in the source).
const planSyncs = (reqs: { method: string; url: string }[]) =>
  reqs.filter(
    (r) => r.method === "POST" && /\/budgets\/[^/]+\/sync$/.test(new URL(r.url).pathname),
  );
const EARLIER = "10/31/2026"; // ten days before START, in the default plan's format (MM/DD/YYYY)
const EARLIER_ISO = "2026-10-31";
const row = (page: Page) =>
  page.locator(".register-table tbody tr").filter({ hasText: "Starting Balance" });

async function startingBalance(request: Parameters<typeof api>[0], plan: string, account: string) {
  const res = await api(request, "GET", `/api/v1/budgets/${plan}/accounts/${account}/transactions`);
  return (await res.json()).data.transactions[0] as { date: string; memo: string | null };
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
]) {
  test.describe(`${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

    test("one plan sync after a linked Starting Balance's date moves, none after a memo or on an unlinked account", async ({
      page,
      request,
    }) => {
      const plan = await newPlan(request);
      const linked = await newAccount(request, plan, "ZZ Linked", "checking", 5);
      const manual = await newAccount(request, plan, "ZZ Manual", "checking", 5);
      const bank = fakeBankAccount({ name: "ZZ Bank Checking" });
      const stub = await stubBankLink(page, request, {
        budgetId: plan,
        connections: [
          fakeConnection({ last_synced_at: new Date().toISOString(), accounts: [bank] }),
        ],
        links: { [linked]: bank.id },
      });
      const editDate = async (account: string, iso: string, display: string) => {
        await row(page).locator('td[data-field="date"]').dblclick();
        const date = page.getByRole("textbox", { name: "Date", exact: true });
        await date.fill(display);
        await realClick(page, page.getByRole("button", { name: "Save", exact: true }));
        await expect
          .poll(async () => (await startingBalance(request, plan, account)).date)
          .toBe(iso);
      };

      await page.goto(`/${plan}/accounts/${linked}`);
      await expect(row(page)).toHaveCount(1);
      await page.waitForTimeout(1000);
      const c = planSyncs(stub.requests).length;

      await editDate(linked, EARLIER_ISO, EARLIER);
      await expect.poll(() => planSyncs(stub.requests).length).toBe(c + 1);
      await expect(row(page).locator('td[data-field="date"]')).toHaveText(EARLIER);

      // A memo-only save moves nothing: the count stays.
      await row(page).locator('td[data-field="memo"]').dblclick();
      await page.getByRole("textbox", { name: "Memo", exact: true }).fill("ZZ note");
      await realClick(page, page.getByRole("button", { name: "Save", exact: true }));
      await expect
        .poll(async () => (await startingBalance(request, plan, linked)).memo)
        .toBe("ZZ note");
      await page.waitForTimeout(1000);
      expect(planSyncs(stub.requests)).toHaveLength(c + 1);

      // An account that is not linked: a date move sends none.
      await page.goto(`/${plan}/accounts/${manual}`);
      await expect(row(page)).toHaveCount(1);
      await page.waitForTimeout(1000);
      const m = planSyncs(stub.requests).length;
      await editDate(manual, EARLIER_ISO, EARLIER);
      await page.waitForTimeout(1000);
      expect(planSyncs(stub.requests)).toHaveLength(m);
    });
  });
}
