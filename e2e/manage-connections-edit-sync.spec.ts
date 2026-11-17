import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { dbutton, dialog, newAccount, newPlan, openFromSidebar } from "./support/account-edit-seed";
import { fakeBankAccount, fakeConnection, stubBankLink } from "./support/bank-link-stub";
import { realClick } from "./support/real-click";

async function linked(page: Page, request: Parameters<typeof newPlan>[0]) {
  const budget = await newPlan(request);
  const id = await newAccount(request, budget, "ZZ Linked", "checking", 5000);
  const bank = fakeBankAccount({ name: "ZZ Checking", mask: "0000" });
  await stubBankLink(page, request, {
    budgetId: budget,
    connections: [
      fakeConnection({
        nickname: "ZZ Bank",
        last_synced_at: new Date(Date.now() - 3_600_000).toISOString(),
        accounts: [bank],
      }),
    ],
    links: { [id]: bank.id },
    afterSync: { delayMs: 600, result: { added: 3 } },
  });
  await page.goto(`/${budget}/accounts/${id}`);
  await expect(
    page.getByRole("navigation", { name: "Sidebar" }).getByRole("link", { name: /ZZ Linked/ }),
  ).toBeVisible();
  await openFromSidebar(page, "ZZ Linked");
}

test.describe("EXF-773 at 1024×700", () => {
  test.use({ viewport: { width: 1024, height: 700 } });

  test("1 Sync Now and Unlink Account are whole on opening; Unlink stays still; the result is in view", async ({
    page,
    request,
  }) => {
    await linked(page, request);
    const body = dialog(page).locator(".form-body");
    const inside = async (name: string) => {
      const b = await body.boundingBox();
      const x = await dbutton(page, name).boundingBox();
      expect(b && x).toBeTruthy();
      // Wholly inside the body's visible box.
      expect(x?.y).toBeGreaterThanOrEqual((b?.y ?? 0) - 0.5);
      expect((x?.y ?? 0) + (x?.height ?? 0)).toBeLessThanOrEqual(
        (b?.y ?? 0) + (b?.height ?? 0) + 0.5,
      );
    };
    expect(await body.evaluate((e) => e.scrollTop)).toBe(0);
    await inside("Sync Now");
    await inside("Unlink Account");
    const before = await dbutton(page, "Unlink Account").boundingBox();
    await realClick(page, dbutton(page, "Sync Now"));
    await expect(dbutton(page, "Syncing…")).toBeVisible();
    const during = await dbutton(page, "Unlink Account").boundingBox();
    expect(during?.x).toBe(before?.x);
    const status = dialog(page).getByRole("status");
    await expect(status).toBeVisible();
    const b = await body.boundingBox();
    const s = await status.boundingBox();
    expect(s?.y).toBeGreaterThanOrEqual((b?.y ?? 0) - 0.5);
    expect((s?.y ?? 0) + (s?.height ?? 0)).toBeLessThanOrEqual(
      (b?.y ?? 0) + (b?.height ?? 0) + 0.5,
    );
  });
});

test.describe("EXF-773 at 1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("2 the dialog's height is unchanged", async ({ page, request }) => {
    await linked(page, request);
    const h = (await dialog(page).boundingBox())?.height;
    // Measured on 9ecd379 (before EXF-773) at 1440×900 in this spec's own fixture: the Edit Account dialog.
    expect(h).toBe(MEASURED_HEIGHT);
  });
});
const MEASURED_HEIGHT = 675.34375;
