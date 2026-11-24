import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openManagePayees, payees, seedPayees } from "./support/manage-payees-seed";
import { realClick } from "./support/real-click";

// EXF-510 AC10 / EXF-882 item 3: the dialog's Undo and Redo (seed names are "ZZ Cafe A" / "ZZ Cafe B").
type Seed = Awaited<ReturnType<typeof seedPayees>>;
type Dialog = ReturnType<Page["locator"]>;
const open = async (page: Page, s: Seed) => {
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  return openManagePayees(page, s.name);
};
const btn = (d: Dialog, name: string) => d.getByRole("button", { name, exact: true });
const pick = (d: Dialog, name: string) => btn(d, `Select ${name}`);
const nameField = (d: Dialog) => d.getByRole("textbox", { name: "Payee Name", exact: true });
const rename = async (d: Dialog, to: string) => {
  await nameField(d).fill(to);
  await nameField(d).press("Enter");
};
const hiddenOf = async (request: Parameters<typeof payees>[0], s: Seed, name: string) =>
  (await payees(request, s.plan)).find((p) => p.name === name)?.hidden;

test("3 rename: Undo gives A, Redo gives B", async ({ page, request }) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  await realClick(page, pick(d, "ZZ Cafe A"));
  await rename(d, "ZZ Cafe A2");
  await expect(pick(d, "ZZ Cafe A2")).toBeVisible();
  await realClick(page, btn(d, "Undo"));
  await expect(pick(d, "ZZ Cafe A")).toBeVisible();
  await expect(pick(d, "ZZ Cafe A2")).toHaveCount(0);
  await expect(nameField(d)).toHaveValue("ZZ Cafe A");
  await realClick(page, btn(d, "Redo"));
  await expect(pick(d, "ZZ Cafe A2")).toBeVisible();
  await expect(pick(d, "ZZ Cafe A")).toHaveCount(0);
  await expect(nameField(d)).toHaveValue("ZZ Cafe A2");
});

test("4 hide: Undo puts it back in Payees, Redo moves it to Hidden Payees", async ({
  page,
  request,
}) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  await realClick(page, pick(d, "ZZ Cafe A"));
  await realClick(page, btn(d, "Hide"));
  await expect(d.locator(".mp-payee.is-hidden .mp-name")).toHaveText(["ZZ Cafe A"]);
  await realClick(page, btn(d, "Undo"));
  await expect(d.getByText(/^Hidden Payees/)).toHaveCount(0);
  await expect(pick(d, "ZZ Cafe A")).toBeVisible();
  expect(await hiddenOf(request, s, "ZZ Cafe A")).toBe(false);
  await realClick(page, btn(d, "Redo"));
  await expect(d.locator(".mp-payee.is-hidden .mp-name")).toHaveText(["ZZ Cafe A"]);
  expect(await hiddenOf(request, s, "ZZ Cafe A")).toBe(true);
});

test("5 delete with a new payee: Undo brings the payee, its count and its register rows back", async ({
  page,
  request,
}) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  await realClick(page, pick(d, "ZZ Cafe A"));
  await expect(btn(d, "Show 3 Transactions")).toBeVisible();
  await realClick(page, btn(d, "Delete"));
  await d
    .getByRole("combobox", { name: "New payee", exact: true })
    .selectOption({ label: "ZZ Cafe B" });
  await realClick(page, btn(d, "Delete"));
  await expect(pick(d, "ZZ Cafe A")).toHaveCount(0);
  await realClick(page, btn(d, "Undo"));
  await expect(pick(d, "ZZ Cafe A")).toBeVisible();
  await realClick(page, pick(d, "ZZ Cafe A"));
  await expect(btn(d, "Show 3 Transactions")).toBeVisible();
  await realClick(page, pick(d, "ZZ Cafe B"));
  await expect(btn(d, "Show 2 Transactions")).toBeVisible();
  await realClick(page, btn(d, "Done"));
  await expect(page.getByRole("row").filter({ hasText: "ZZ Cafe A" })).toHaveCount(3);
});

test("6 button states: disabled on open, a register change does not enable Undo, Redo off after a new change", async ({
  page,
  request,
}) => {
  const s = await seedPayees(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  // A register change made before the dialog opens.
  await page.getByRole("button", { name: "Add Transaction", exact: true }).click();
  await page.getByRole("combobox", { name: "Payee", exact: true }).fill("ZZ Reg");
  await page.getByRole("combobox", { name: "Payee", exact: true }).press("Tab");
  await page.getByRole("textbox", { name: "Memo", exact: true }).fill("before");
  await page.getByRole("textbox", { name: "Memo", exact: true }).press("Enter");
  await expect(page.getByRole("row").filter({ hasText: "ZZ Reg" })).toHaveCount(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const d = await openManagePayees(page, s.name);
  await expect(btn(d, "Undo")).toBeDisabled();
  await expect(btn(d, "Redo")).toBeDisabled();
  await realClick(page, pick(d, "ZZ Cafe A"));
  await rename(d, "ZZ Cafe A2");
  await expect(pick(d, "ZZ Cafe A2")).toBeVisible();
  await expect(btn(d, "Undo")).toBeEnabled();
  await expect(btn(d, "Redo")).toBeDisabled();
  await realClick(page, btn(d, "Undo"));
  await expect(btn(d, "Redo")).toBeEnabled();
  await page.screenshot({ path: "test-results/manage-payees-redo-footer.png" });
  await realClick(page, pick(d, "ZZ Cafe A"));
  await realClick(page, btn(d, "Hide"));
  await expect(d.locator(".mp-payee.is-hidden .mp-name")).toHaveText(["ZZ Cafe A"]);
  await expect(btn(d, "Redo")).toBeDisabled();
  await expect(btn(d, "Undo")).toBeEnabled();
  await page.screenshot({ path: "test-results/manage-payees-undo-footer.png" });
});

test("7 AC10: Undo reverts the last change and Done closes", async ({ page, request }) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  await realClick(page, pick(d, "ZZ Cafe A"));
  await realClick(page, btn(d, "Hide"));
  await expect(d.locator(".mp-payee.is-hidden")).toHaveCount(1);
  await realClick(page, btn(d, "Undo"));
  await expect(d.locator(".mp-payee.is-hidden")).toHaveCount(0);
  await realClick(page, btn(d, "Done"));
  await expect(d).toHaveCount(0);
  expect(await hiddenOf(request, s, "ZZ Cafe A")).toBe(false);
});
