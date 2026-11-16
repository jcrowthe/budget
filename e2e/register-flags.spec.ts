import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { accountRows, seedBulk } from "./support/bulk-seed";
import { call, realClick } from "./support/register-seed";

const rowOf = (page: Page, payee: string) =>
  page.locator(".register-table tbody tr[data-tx]").filter({ hasText: payee });
const flagCell = (page: Page, payee: string) => rowOf(page, payee).locator("td.cell-flag button");
const menu = (page: Page) => page.getByRole("menu", { name: "Flags" });
const flagOf = async (
  request: Parameters<typeof accountRows>[0],
  plan: string,
  acct: string,
  id: string,
) => (await accountRows(request, plan, acct)).find((t) => t.id === id)?.flag_color;

test("an unflagged row's flag menu lists Red to Purple with keys, a disabled Edit Flags and no Clear (EXF-522 AC1)", async ({
  page,
  request,
}) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await realClick(page, flagCell(page, "ZZ Rent"));
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("menuitem")).toHaveText([
    "Red",
    "Orange",
    "Yellow",
    "Green",
    "Blue",
    "Purple",
    "Edit Flags",
  ]);
  await expect(menu(page).locator("kbd")).toHaveText(["1", "2", "3", "4", "5", "6"]);
  await expect(menu(page).getByRole("menuitem", { name: "Clear", exact: true })).toHaveCount(0);
  const edit = menu(page).getByRole("menuitem", { name: "Edit Flags", exact: true });
  await expect(edit).toHaveAttribute("aria-disabled", "true");
  await expect(edit).toHaveAttribute("data-ticket", "EXF-480");
  // The menu is 238px wide, with 24px pills (source: All Accounts flag menu, dark, 1600x813, notes 8b).
  expect((await menu(page).locator(".bulk-popover-body").boundingBox())?.width).toBe(238);
  expect(
    (await menu(page).getByRole("menuitem", { name: "Red", exact: true }).boundingBox())?.height,
  ).toBe(24);
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
});

test("picking Red shows a red flag titled Red, and the menu then lists Clear 0 (EXF-522 AC2, AC4)", async ({
  page,
  request,
}) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await realClick(page, flagCell(page, "ZZ Rent"));
  await realClick(page, menu(page).getByRole("menuitem", { name: "Red", exact: true }));
  const red = rowOf(page, "ZZ Rent").getByRole("button", { name: "Red", exact: true });
  await expect(red).toHaveAttribute("title", "Red");
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.rent)).toBe("red");
  // The flag survives a reload and the REST read returns it.
  await page.reload();
  await expect(
    rowOf(page, "ZZ Rent").getByRole("button", { name: "Red", exact: true }),
  ).toBeVisible();
  const got = await call(request, "GET", `/api/v1/budgets/${s.plan}/transactions/${s.rent}`);
  expect(got.transaction.flag_color).toBe("red");
  await realClick(page, flagCell(page, "ZZ Rent"));
  await expect(menu(page).getByRole("menuitem").first()).toHaveText("Clear");
  await expect(menu(page).locator("kbd").first()).toHaveText("0");
  await page.keyboard.press("0");
  await expect(
    rowOf(page, "ZZ Rent").getByRole("button", { name: "Flag", exact: true }),
  ).toBeVisible();
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.rent)).toBeNull();
});

test("shift+F then 5 makes a selected row blue, shift+F then 0 clears it; the bar's Flag opens the same menu (EXF-522 AC3)", async ({
  page,
  request,
}) => {
  const s = await seedBulk(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  await realClick(
    page,
    rowOf(page, "ZZ Gas").getByRole("checkbox", { name: "Select transaction", exact: true }),
  );
  await page.keyboard.press("Shift+F");
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("5");
  await expect(
    rowOf(page, "ZZ Gas").getByRole("button", { name: "Blue", exact: true }),
  ).toBeVisible();
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.gas)).toBe("blue");
  await page.keyboard.press("Shift+F");
  await expect(menu(page).getByRole("menuitem").first()).toHaveText("Clear");
  await expect(menu(page).locator("kbd").first()).toHaveText("0");
  await page.keyboard.press("0");
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.gas)).toBeNull();
  await realClick(
    page,
    page
      .getByRole("toolbar", { name: "Selection actions" })
      .getByRole("button", { name: "Flag", exact: true }),
  );
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("menuitem")).toHaveCount(7);
  await realClick(page, menu(page).getByRole("menuitem", { name: "Green", exact: true }));
  await expect.poll(() => flagOf(request, s.plan, s.checking, s.gas)).toBe("green");
});

test("a flag sets through the bulk REST op and the plan list returns it (EXF-522 AC4)", async ({
  request,
}) => {
  const s = await seedBulk(request);
  const res = await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions/bulk`, {
    op: "flag",
    ids: [s.pay, s.fee],
    value: "purple",
  });
  expect(res.changed).toEqual([s.pay, s.fee]);
  const listed = await call(request, "GET", `/api/v1/budgets/${s.plan}/transactions`);
  const colors = listed.transactions
    .filter((t: { id: string }) => t.id === s.pay || t.id === s.fee)
    .map((t: { flag_color: string }) => t.flag_color);
  expect(colors).toEqual(["purple", "purple"]);
});
