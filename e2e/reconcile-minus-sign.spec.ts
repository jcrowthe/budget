import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { seedReconcileCard } from "./support/reconcile-seed";
import { openReport } from "./support/reflect";
import { realClick } from "./support/register-seed";

// EXF-664: every negative amount on a screen is written with U+2212 before the dollar sign, in the text and in
// every title and aria-label. Reflect's percentages ("-0.3%") are not amounts and are not read.

/** Every amount token of the page's visible text and of its `title` / `aria-label` values. */
async function amountTokens(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const texts: string[] = [document.body.innerText];
    for (const el of document.querySelectorAll("[title],[aria-label]")) {
      texts.push(el.getAttribute("title") ?? "", el.getAttribute("aria-label") ?? "");
    }
    const out: string[] = [];
    for (const t of texts) out.push(...(t.match(/[-−]?\$[\d,]+(?:\.\d{2})?/g) ?? []));
    return out;
  });
}

async function expectMinusSigns(page: Page, label: string) {
  const tokens = await amountTokens(page);
  const hyphens = tokens.filter((t) => t.startsWith("-"));
  expect(hyphens, `${label}: amounts written with a hyphen`).toEqual([]);
  expect(
    tokens.filter((t) => t.startsWith("−")).length,
    `${label}: no negative amount was found, the check would prove nothing`,
  ).toBeGreaterThan(0);
}

test("negative amounts use the minus sign on the Plan page, the register, the reconcile bar and Net Worth (EXF-664)", async ({
  page,
  request,
}) => {
  const s = await seedReconcileCard(request, false);

  await page.goto(`/${s.plan}/budget/202611`);
  await expect(page.getByText("Ready to Assign").first()).toBeVisible();
  await expectMinusSigns(page, "Plan page");

  await page.goto(`/${s.plan}/accounts/${s.visa}`);
  await expect(page.getByRole("button", { name: "Add Transaction", exact: true })).toBeVisible();
  await expectMinusSigns(page, "register header");
  const rows = page.locator(".register-table tbody tr[data-tx]");
  await realClick(page, rows.nth(0).getByRole("checkbox", { name: "Select transaction" }));
  await realClick(page, rows.nth(1).getByRole("checkbox", { name: "Select transaction" }));
  await expect(page.locator("[data-balance=selected] .acct-amount")).toHaveText(/^−\$/);
  await expectMinusSigns(page, "register with two rows selected");

  await realClick(
    page,
    page.getByRole("main").getByRole("button", { name: "Reconcile", exact: true }),
  );
  await realClick(page, page.getByRole("button", { name: "No", exact: true }));
  await page.keyboard.type("0");
  await page.keyboard.press("Enter");
  const modal = page.getByRole("dialog", { name: "Reconcile", exact: true });
  await expect(modal.getByText("$335.00", { exact: true })).toBeVisible();
  await expectMinusSigns(page, "Difference step");
  await realClick(page, modal.getByRole("button", { name: "Next", exact: true }));
  await expect(page.getByRole("region", { name: "Reconciliation", exact: true })).toBeVisible();
  await expectMinusSigns(page, "reconcile bar");

  await openReport(page, s.plan, "net-worth");
  await expect(page.getByTestId("nw-debts")).toHaveText(/^−\$/);
  await expectMinusSigns(page, "Net Worth");
});
