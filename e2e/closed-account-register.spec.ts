import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { accountRows, seedBulk } from "./support/bulk-seed";
import { call, realClick } from "./support/register-seed";

const rowOf = (page: Page, payee: string) =>
  page.locator(".register-table tbody tr[data-tx]").filter({ hasText: payee });
const bar = (page: Page) => page.getByRole("toolbar", { name: "Selection actions" });
const moreItem = (page: Page, name: string) =>
  page.getByRole("menu", { name: "More actions" }).getByRole("menuitem", { name, exact: true });
const outflow = (page: Page) => page.getByRole("textbox", { name: "Outflow", exact: true });
const CONFIRM = "Warning: Closed Account";

async function closedRegister(request: Parameters<typeof seedBulk>[0], page: Page) {
  const s = await seedBulk(request);
  await call(request, "POST", `/api/v1/budgets/${s.plan}/accounts/${s.checking}/close`);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Rent")).toBeVisible();
  return s;
}

test("a closed account's Add Transaction and File Import are disabled, Add with its tooltip", async ({
  page,
  request,
}) => {
  await closedRegister(request, page);
  const toolbar = page.getByRole("toolbar", { name: "Register toolbar" });
  const add = toolbar.getByRole("button", { name: "Add Transaction" });
  await expect(add).toBeDisabled();
  await expect(add).toHaveAttribute("title", "Re-open this account to add a transaction.");
  await expect(toolbar.getByRole("button", { name: "File Import" })).toBeDisabled();
});

test("a closed account's bulk More menu disables Match and Unmatch only", async ({
  page,
  request,
}) => {
  await closedRegister(request, page);
  await realClick(
    page,
    rowOf(page, "ZZ Rent").getByRole("checkbox", { name: "Select transaction" }),
  );
  await realClick(page, bar(page).getByRole("button", { name: "More", exact: true }));
  await expect(moreItem(page, "Match")).toHaveAttribute("aria-disabled", "true");
  await expect(moreItem(page, "Unmatch")).toHaveAttribute("aria-disabled", "true");
  await expect(moreItem(page, "Duplicate")).not.toHaveAttribute("aria-disabled", "true");
  await expect(moreItem(page, "Delete")).not.toHaveAttribute("aria-disabled", "true");
});

test("saving an edit in a closed account asks first: Cancel keeps the row, Save saves", async ({
  page,
  request,
}) => {
  const s = await closedRegister(request, page);
  const dialog = page.getByRole("dialog", { name: CONFIRM });
  const amountOf = async () =>
    (await accountRows(request, s.plan, s.checking)).find((t) => t.id === s.rent)?.amount;
  await rowOf(page, "ZZ Rent").locator('td[data-field="outflow"]').dblclick();
  await outflow(page).fill("120");
  await outflow(page).press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(
    "Editing transactions from closed accounts can result in unexpected changes to your plan.",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // The row is still in edit mode with the typed value, and nothing was saved.
  await expect(page.locator(".entry-body")).toHaveCount(1);
  await expect(outflow(page)).toHaveValue("120");
  expect(await amountOf()).toBe(-100000);
  await outflow(page).press("Enter");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".entry-body")).toHaveCount(0);
  await expect(rowOf(page, "ZZ Rent")).toContainText("$120.00");
  await expect.poll(amountOf).toBe(-120000);
});

test("a closed account's rows can still be deleted", async ({ page, request }) => {
  const s = await closedRegister(request, page);
  await realClick(
    page,
    rowOf(page, "ZZ Gas").getByRole("checkbox", { name: "Select transaction" }),
  );
  await page.keyboard.press("Delete");
  await expect(rowOf(page, "ZZ Gas")).toHaveCount(0);
  await expect
    .poll(async () => (await accountRows(request, s.plan, s.checking)).map((t) => t.id))
    .not.toContain(s.gas);
});
