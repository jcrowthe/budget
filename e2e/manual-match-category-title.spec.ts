import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { testName } from "./support/auth";
import { call, realClick, TODAY } from "./support/register-seed";

// EXF-816: in an open register row the Category field carries a tooltip with its whole text. Not compared with
// the source (it has no title there): the 1024 px rule decides.

test.use({ viewport: { width: 1024, height: 700 } });

const GROUP = "ZZ Group With A Long Name For Narrow Width";
const LONG = "ZZ Category With A Long Name Too Long To Fit";
const rows = (page: Page) => page.locator(".register-table tbody tr");
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const option = (page: Page, name: string) => page.getByRole("option", { name, exact: true });
const parentCategory = (page: Page) =>
  page.locator('.entry-row:not(.split-line) [data-field="category"] input');
const parentOutflow = (page: Page) =>
  page.locator('.entry-row:not(.split-line) [data-field="outflow"] input');
const read = (el: Locator) =>
  el.evaluate((e: HTMLInputElement) => ({
    value: e.value,
    title: e.getAttribute("title"),
    scrollWidth: e.scrollWidth,
    clientWidth: e.clientWidth,
    textOverflow: getComputedStyle(e).textOverflow,
  }));

test("the open row's Category field has a title with its whole text", async ({ page, request }) => {
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name: testName("match-cat") });
  const plan = budget.id as string;
  const checking = (
    await call(request, "POST", `/api/v1/budgets/${plan}/accounts`, {
      name: "ZZ Checking",
      type: "checking",
      balance: 100000,
      date: TODAY,
    })
  ).account.id as string;
  const g = (
    await call(request, "POST", `/api/v1/budgets/${plan}/category_groups`, { name: GROUP })
  ).category_group.id;
  await call(request, "POST", `/api/v1/budgets/${plan}/categories`, { group_id: g, name: LONG });

  await page.goto(`/${plan}/accounts/${checking}`);
  await expect(rows(page)).toHaveCount(1);
  await button(page, "Add Transaction").click();
  await parentOutflow(page).fill("100");

  const pickLong = async (field: Locator) => {
    await field.click();
    await option(page, LONG).click();
  };

  // 1. the long category
  await pickLong(parentCategory(page));
  const one = await read(parentCategory(page));
  expect(one.value).toBe(`${GROUP}: ${LONG}`);
  expect(one.title).toBe(one.value);
  expect(one.scrollWidth).toBeGreaterThan(one.clientWidth);
  expect(one.textOverflow).toBe("ellipsis");

  // 2. Inflow: Ready to Assign
  await parentCategory(page).click();
  await option(page, "Ready to Assign").click();
  const two = await read(parentCategory(page));
  expect(two.value).toBe("Inflow: Ready to Assign");
  expect(two.title).toBe(two.value);

  // 3. the split text
  await parentCategory(page).click();
  await expect(option(page, LONG)).toBeVisible();
  await realClick(page, button(page, "Split (Multiple Categories)"));
  const three = await read(parentCategory(page));
  expect(three.value).toBe("Split (Multiple Categories)...");
  expect(three.title).toBe(three.value);

  // 4. a split line's field
  const line = page.locator('[data-line="0"][data-field="category"] input');
  await pickLong(line);
  const four = await read(line);
  expect(four.value).toContain(LONG);
  expect(four.title).toBe(four.value);
  expect(four.scrollWidth).toBeGreaterThan(four.clientWidth);
  expect(four.textOverflow).toBe("ellipsis");
});
