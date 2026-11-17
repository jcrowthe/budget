import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { seedApprove } from "./support/approve-seed";
import { patchPlan } from "./support/plan-formats-seed";
import { realClick } from "./support/real-click";

// EXF-780 (case 11). Decided (docs/import-start-design.md): the "Amount remaining to assign" line is a computed
// amount in the plan's separators and digits, without the currency symbol and without a sign (`fmt.input(|r|)`),
// as the source's own code writes it (`currencyService.format(x)` with includeSymbol:false, read from the source's
// loaded static bundle by the Architect). Never a typed echo.

const PLANS = [
  {
    name: "default",
    format: {},
    cases: [
      ["1.00", "1.00"],
      ["1,000.00", "1,000.00"],
      ["1,234.56", "1,234.56"],
    ],
  },
  {
    name: "euro",
    format: {
      currency_format: { iso_code: "EUR", example_format: "123.456,78", symbol_placement: "after" },
      date_format: { format: "DD.MM.YYYY" },
    },
    // typed in the plan's own form, then what the line reads
    cases: [
      ["1,00", "1,00"],
      ["1.000,00", "1.000,00"],
      ["1.234,56", "1.234,56"],
    ],
  },
  {
    name: "yen",
    format: { currency_format: { iso_code: "JPY", example_format: "123,456" } },
    // 1234.56 typed rounds to the plan's unit
    cases: [
      ["1", "1"],
      ["1000", "1,000"],
      ["1234.56", "1,235"],
    ],
  },
] as const;

const parent = (page: Page, field: string) =>
  page.locator(`.entry-row:not(.split-line) [data-field="${field}"] input`);

for (const size of [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
]) {
  for (const p of PLANS) {
    test(`the remaining line in the ${p.name} plan at ${size.width}x${size.height}`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize(size);
      const s = await seedApprove(request);
      if (Object.keys(p.format).length > 0) await patchPlan(request, s.plan, p.format);
      await page.goto(`/${s.plan}/accounts/${s.checking}`);
      await realClick(page, page.getByRole("button", { name: "Add Transaction", exact: true }));
      const readings: string[] = [];
      for (const [typed, want] of p.cases) {
        await parent(page, "outflow").fill(typed);
        if (!(await page.getByText("Amount remaining to assign:", { exact: true }).isVisible())) {
          await parent(page, "category").click();
          await expect(page.getByRole("option", { name: "ZZ Food", exact: true })).toBeVisible();
          await realClick(
            page,
            page.getByRole("button", { name: "Split (Multiple Categories)", exact: true }),
          );
          await expect(
            page.getByText("Amount remaining to assign:", { exact: true }),
          ).toBeVisible();
        }
        const out = page.locator('[data-field="remaining-outflow"]');
        // The editor opens with the typed amount unassigned: the line reads the whole of it.
        await expect(out).toHaveText(want);
        readings.push(`${typed} -> ${await out.textContent()}`);
        await expect(page.locator('[data-field="remaining-inflow"]')).toHaveText(
          p.name === "yen" ? "0" : p.name === "euro" ? "0,00" : "0.00",
        );
        // No symbol, no sign, and never a mixed form.
        await expect(out).not.toHaveText(/[€¥$-]/);
        if (p.name === "euro") await expect(out).not.toHaveText(/\d,\d{3},\d{2}$/);
        if (p.name === "yen") await expect(out).not.toHaveText(/[.,]\d{1,2}$/);
      }
      test.info().annotations.push({ type: "readings", description: readings.join("; ") });
      // The line is not cut without an ellipsis and a tooltip.
      const label = page.locator(".split-remaining-label");
      await expect(label).toHaveAttribute("title", "Amount remaining to assign");
      expect(await label.evaluate((e) => getComputedStyle(e).textOverflow)).toBe("ellipsis");
    });
  }
}
