import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { BANNER, seedApprove } from "./support/approve-seed";
import { patchPlan } from "./support/plan-formats-seed";
import { realClick } from "./support/real-click";
import { daysAgo } from "./support/view-settings";

// EXF-463 case 15 (Euro plan). Nothing was compared with the source: built from the ticket and the design doc's
// Acceptance section (docs/register-approve-design.md, case 15): state 1 of "Looking" with the plan's amounts and
// dates, and the split editor's "Amount remaining to assign" line, which is looked at, not changed.

const EURO = {
  currency_format: { iso_code: "EUR", example_format: "123.456,78", symbol_placement: "after" },
  date_format: { format: "DD.MM.YYYY" },
};
const dotted = (daysBack: number) => daysAgo(daysBack).split("-").reverse().join(".");
const parent = (page: Page, field: string) =>
  page.locator(`.entry-row:not(.split-line) [data-field="${field}"] input`);
const rowOf = (page: Page, payee: string) =>
  page.locator(".register-table tbody tr[data-tx]").filter({ hasText: payee });

for (const size of [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
]) {
  test(`Euro plan: unapproved rows, banner and the split remaining line at ${size.width}x${size.height}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(size);
    const s = await seedApprove(request);
    await patchPlan(request, s.plan, EURO);
    await page.goto(`/${s.plan}/accounts/${s.checking}`);

    await expect(page.getByRole("region", { name: "New transactions", exact: true })).toContainText(
      BANNER(3),
    );
    await expect(
      page.getByRole("button", { name: "This transaction needs approval", exact: true }),
    ).toHaveCount(3);

    // The plan's amounts (symbol after) and dates (DD.MM.YYYY) in the unapproved rows.
    const one = rowOf(page, "ZZ New One");
    await expect(one.locator("td[data-field=date]")).toHaveText(dotted(3));
    await expect(one.locator("td[data-field=outflow]")).toHaveText("3,00€");
    await expect(rowOf(page, "ZZ New Bare").locator("td[data-field=outflow]")).toHaveText("5,00€");
    await expect(rowOf(page, "ZZ Ok One").locator("td[data-field=date]")).toHaveText(dotted(9));

    // Decided in EXF-780 (docs/import-start-design.md): the remaining line is a computed amount in the plan's
    // separators and digits, without the currency symbol and without a sign (the source writes it with
    // includeSymbol:false). The three amounts are asserted in e2e/import-start-split.spec.ts.
    await page.getByRole("button", { name: "Add Transaction", exact: true }).click();
    await page.locator('.entry-row:not(.split-line) [data-field="outflow"] input').fill("100");
    await page.locator('.entry-row:not(.split-line) [data-field="category"] input').click();
    await expect(page.getByRole("option", { name: "ZZ Food", exact: true })).toBeVisible();
    await realClick(
      page,
      page.getByRole("button", { name: "Split (Multiple Categories)", exact: true }),
    );
    await expect(page.getByText("Amount remaining to assign:", { exact: true })).toBeVisible();
    await expect(page.locator('[data-field="remaining-outflow"]')).toHaveText("100,00");
    await expect(page.locator('[data-field="remaining-inflow"]')).toHaveText("0,00");
    for (const [typed, want] of [
      ["1,00", "1,00"],
      ["1.000,00", "1.000,00"],
      ["1.234,56", "1.234,56"],
    ]) {
      await parent(page, "outflow").fill(typed as string);
      await expect(page.locator('[data-field="remaining-outflow"]')).toHaveText(want as string);
    }
  });
}
