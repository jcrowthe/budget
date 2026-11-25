import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openManagePayees, payees, seedPayees } from "./support/manage-payees-seed";
import { seedCategorization } from "./support/payee-categorization-seed";
import { realClick } from "./support/real-click";
import { call } from "./support/register-seed";
import { addRuleVia } from "./support/rename-rules-seed";

// EXF-512: Combine and Rename in Manage Payees.
type Dialog = ReturnType<Page["locator"]>;
const btn = (d: Dialog, name: string) => d.getByRole("button", { name, exact: true });
const pick = (d: Dialog, name: string) => btn(d, `Select ${name}`);
const tick = (d: Dialog, name: string) =>
  d.getByRole("checkbox", { name: `Check ${name}`, exact: true });
const nameBox = (d: Dialog) => d.getByRole("textbox", { name: "New Payee Name", exact: true });
const NOTE =
  "Combining these payees will also combine all their renaming rules and categorization rules.";

/** A: 3 Groceries rows; B: 2 newer Fun rows, the rule `Contains ZZB` and a schedule. */
async function seed(request: Parameters<typeof seedCategorization>[0]) {
  const s = await seedCategorization(request);
  for (const date of ["2026-11-01", "2026-11-02", "2026-11-03"]) {
    await s.tx("ZZ-TEST A", { date, category_id: s.groceries });
  }
  for (const date of ["2026-11-10", "2026-11-11"]) {
    await s.tx("ZZ-TEST B", { date, category_id: s.fun });
  }
  await call(request, "POST", `/api/v1/budgets/${s.plan}/scheduled-transactions`, {
    account_id: s.checking,
    date_first: "2099-01-15",
    frequency: "monthly",
    amount: -4000,
    payee_name: "ZZ-TEST B",
  });
  const a = await s.payeeId("ZZ-TEST A");
  const b = await s.payeeId("ZZ-TEST B");
  await addRuleVia(request, s.plan, b, "contains", "ZZB");
  return { ...s, a, b };
}

async function openTwo(page: Page, s: Awaited<ReturnType<typeof seed>>) {
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const d = await openManagePayees(page, s.name);
  await realClick(page, pick(d, "ZZ-TEST A"));
  await realClick(page, tick(d, "ZZ-TEST B"));
  return d;
}

test("1 two selected: the names and the Combine and Rename card, filled with the first name", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  const d = await openTwo(page, s);
  await expect(d.getByText("2 Payees Selected", { exact: true })).toBeVisible();
  await expect(d.locator(".mp-selected-name")).toHaveText(["ZZ-TEST A", "ZZ-TEST B"]);
  await expect(d.getByRole("heading", { name: "Combine and Rename", exact: true })).toBeVisible();
  await expect(d.getByText(NOTE, { exact: true })).toBeVisible();
  await expect(nameBox(d)).toHaveValue("ZZ-TEST A");
  await expect(btn(d, "Combine")).toBeEnabled();
});

test("2 Combine: one payee with the rows, the schedule, both rules and the first one's category", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  const d = await openTwo(page, s);
  await nameBox(d).fill("ZZ-TEST AB");
  await realClick(page, btn(d, "Combine"));
  await expect(d.getByText("Select a payee to edit.", { exact: true })).toBeVisible();
  await expect(pick(d, "ZZ-TEST AB")).toBeVisible();
  await expect(pick(d, "ZZ-TEST A")).toHaveCount(0);
  await expect(pick(d, "ZZ-TEST B")).toHaveCount(0);
  await realClick(page, pick(d, "ZZ-TEST AB"));
  await expect(btn(d, "Show 6 Transactions")).toBeVisible();
  const rules = d.locator(".mp-rules");
  await expect(rules.getByText("ZZB", { exact: false }).first()).toBeVisible();
  await expect(rules.getByText("ZZ-TEST A", { exact: false }).first()).toBeVisible();
  await expect(d.locator(".mp-categorization")).toContainText("Groceries");
  await expect(d.locator(".mp-categorization")).not.toContainText("Fun");
  await realClick(page, btn(d, "Done"));
  await expect(page.getByRole("row").filter({ hasText: "ZZ-TEST AB" })).toHaveCount(5);
  const list = await payees(request, s.plan);
  expect(list.filter((p) => p.name === "ZZ-TEST AB")).toHaveLength(1);
  expect(list.some((p) => p.name === "ZZ-TEST B")).toBe(false);
});

test("3 Undo brings both payees and the rule back; Redo combines again", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  const d = await openTwo(page, s);
  await nameBox(d).fill("ZZ-TEST AB");
  await realClick(page, btn(d, "Combine"));
  await expect(pick(d, "ZZ-TEST AB")).toBeVisible();
  await expect(btn(d, "Undo")).toBeEnabled();
  await realClick(page, btn(d, "Undo"));
  await expect(pick(d, "ZZ-TEST A")).toBeVisible();
  await expect(pick(d, "ZZ-TEST B")).toBeVisible();
  await expect(pick(d, "ZZ-TEST AB")).toHaveCount(0);
  const list = await payees(request, s.plan);
  expect(list.find((p) => p.name === "ZZ-TEST A")?.transaction_count).toBe(3);
  expect(list.find((p) => p.name === "ZZ-TEST B")).toMatchObject({
    transaction_count: 2,
    scheduled_count: 1,
  });
  const rules = await call(request, "GET", `/api/v1/budgets/${s.plan}/payees/${s.b}/rename-rules`);
  expect(rules.rules).toHaveLength(1);
  await expect(btn(d, "Redo")).toBeEnabled();
  await realClick(page, btn(d, "Redo"));
  await expect(pick(d, "ZZ-TEST AB")).toBeVisible();
  await expect(pick(d, "ZZ-TEST B")).toHaveCount(0);
});

test("4 a selection with a transfer payee has no Combine", async ({ page, request }) => {
  const s = await seedPayees(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const d = await openManagePayees(page, s.name);
  await realClick(page, btn(d, "Expand Transfer Payees"));
  await realClick(page, pick(d, "Transfer : ZZ Card"));
  await realClick(page, tick(d, "ZZ Cafe A"));
  await expect(d.getByText(/Only one payee group can be edited at a time/)).toBeVisible();
  await expect(btn(d, "Combine")).toHaveCount(0);
});

test("5 an empty name turns Combine off", async ({ page, request }) => {
  const s = await seed(request);
  const d = await openTwo(page, s);
  await nameBox(d).fill("");
  await expect(btn(d, "Combine")).toBeDisabled();
  await nameBox(d).fill("ZZ-TEST AB");
  await expect(btn(d, "Combine")).toBeEnabled();
});
