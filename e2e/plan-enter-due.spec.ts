import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { seed, txs } from "./support/register-seed";
import { createSched, enterDueApi, fixClock, listSched } from "./support/scheduled-seed";

// EXF-658: due schedules are entered when the Plan page opens, so its numbers are right on first view.
// Dates are pinned: the schedule is made on 2026-11-15 and is due on 2026-11-16, the browser's fixed day.

const CREATED = "2026-11-15";
const DUE = "2026-11-16";
const name = "ZZ-TEST Plan Due";

const catRow = (page: Page, n: string) =>
  page.locator(".category-row", { has: page.getByText(n, { exact: true }) });

test("opening the Plan page enters what is due, and an account opened next adds nothing (658)", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await createSched(request, s.plan, CREATED, {
    account_id: s.checking,
    date_first: DUE,
    frequency: "weekly",
    amount: -30000,
    payee_name: name,
    category_id: s.category,
  });
  const mine = async () =>
    (await txs(request, s.plan, s.checking)).filter((t) => t.payee_name === name);
  expect(await mine()).toHaveLength(0);

  await fixClock(page, DUE);
  await page.goto(`/${s.plan}/budget/202611`);
  const food = catRow(page, "D4 Groceries");
  await expect(food).toBeVisible();
  await expect(food.locator(".cell-activity")).toHaveText("−$30.00");
  await expect(food.locator(".available-pill")).toContainText("$170.00");
  await expect(
    page.getByRole("navigation", { name: "Sidebar" }).getByRole("link", { name: /ZZ Checking/ }),
  ).toContainText("$2,470.00");
  expect(await mine()).toHaveLength(1);

  // Then the account page: still one transaction.
  await page
    .getByRole("navigation", { name: "Sidebar" })
    .getByRole("link", { name: /ZZ Checking/ })
    .click();
  await expect(
    page.locator(".register-table tbody tr[data-tx]").filter({ hasText: name }),
  ).toHaveCount(1);
  expect(await mine()).toHaveLength(1);
  expect((await enterDueApi(request, s.plan, DUE)).entered).toEqual([]);
  expect((await listSched(request, s.plan))[0]?.date_next).toBe("2026-11-23");
});
