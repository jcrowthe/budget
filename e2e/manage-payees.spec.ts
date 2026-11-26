import type { Page } from "@playwright/test";
import { expect as baseExpect, test } from "./fixtures";
import { delayRoute } from "./support/delay-route";
import { openManagePayees, payees, seedPayees } from "./support/manage-payees-seed";
import { realClick } from "./support/real-click";
import { call } from "./support/register-seed";
import { rulesOf } from "./support/rename-rules-seed";

// A loaded box answers REST calls slowly: wait far longer than the default 5 s for what a request renders.
const expect = baseExpect.configure({ timeout: 30_000 });
test.setTimeout(90_000);

const open = async (page: Page, s: Awaited<ReturnType<typeof seedPayees>>) => {
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const d = await openManagePayees(page, s.name);
  // The list loads after the dialog opens and re-renders it: wait for the first payee before pressing anything.
  await expect(d.locator(".mp-name").first()).toBeVisible();
  return d;
};
// Under load a press right after the list renders can be lost: press Expand again until the group is open.
const expandTransfers = async (page: Page, d: ReturnType<Page["locator"]>) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    if ((await btn(d, "Collapse Transfer Payees").count()) > 0) return;
    await realClick(page, btn(d, "Expand Transfer Payees"));
    await btn(d, "Collapse Transfer Payees")
      .waitFor({ state: "visible", timeout: 8_000 })
      .catch(() => {});
  }
};
const btn = (d: ReturnType<Page["locator"]>, name: string) =>
  d.getByRole("button", { name, exact: true });
const pick = (d: ReturnType<Page["locator"]>, name: string) => btn(d, `Select ${name}`);
const tick = (d: ReturnType<Page["locator"]>, name: string) =>
  d.getByRole("checkbox", { name: `Check ${name}`, exact: true });
const names = (d: ReturnType<Page["locator"]>) => d.locator(".mp-name");

test("1 opens from the menu; Done closes it and the focus is back on the plan button", async ({
  page,
  request,
}) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  for (const g of ["Payees", "Transfer Payees"]) {
    await expect(d.getByText(g, { exact: true })).toBeVisible();
  }
  await expect(d.getByText("Hidden Payees", { exact: true })).toHaveCount(0);
  await expect(btn(d, "Collapse Payees")).toBeVisible();
  await expect(btn(d, "Expand Transfer Payees")).toBeVisible();
  await expect(d.getByText("Select a payee to edit.", { exact: true })).toBeVisible();
  await realClick(page, btn(d, "Done"));
  await expect(d).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Sidebar" })
      .getByRole("button", { name: s.name, exact: true }),
  ).toBeFocused();
});

test("3 groups: transfer payees, the selected count, Check all", async ({ page, request }) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  await expandTransfers(page, d);
  await expect(pick(d, "Transfer : ZZ Card")).toBeVisible();
  await expect(pick(d, "Transfer : ZZ Checking")).toBeVisible();
  await realClick(page, tick(d, "ZZ Cafe A"));
  await expect(d.getByText("Payees (1)", { exact: true })).toBeVisible();
  const all = d.getByRole("checkbox", { name: "Check all Payees", exact: true });
  await realClick(page, all);
  await expect(d.getByRole("checkbox", { name: "Uncheck all Payees", exact: true })).toBeChecked();
  await expect(d.getByText("Payees (5)", { exact: true })).toBeVisible();
  await realClick(page, d.getByRole("checkbox", { name: "Uncheck all Payees", exact: true }));
  await expect(d.getByText("Payees", { exact: true })).toBeVisible();
});

test("4 search: every word, any case; the headers stay", async ({ page, request }) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  const search = d.getByRole("textbox", { name: "Search Payees", exact: true });
  await search.fill("PHONE co");
  await expect(names(d)).toHaveText(["XX PHONECO 99", "ZZ Phone Co"]);
  for (const g of ["Payees", "Transfer Payees"])
    await expect(d.getByText(g, { exact: true })).toBeVisible();
  await search.fill("qqq");
  await expect(names(d)).toHaveCount(0);
  await expect(d.getByText("Payees", { exact: true })).toBeVisible();
  await realClick(page, btn(d, "Clear search"));
  await expect(names(d)).toHaveCount(5);
});

test("5 and 6 rename: the two errors, a case-only name, the register follows", async ({
  page,
  request,
}) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  await realClick(page, pick(d, "ZZ Cafe B"));
  const input = d.getByRole("textbox", { name: "Payee Name", exact: true });
  await input.fill("ZZ Cafe A");
  await input.press("Enter");
  await expect(d.getByRole("alert")).toHaveText("Another payee already exists with this name");
  await expect(names(d)).toHaveText([
    "XX PHONECO 99",
    "ZZ Cafe A",
    "ZZ Cafe B",
    "ZZ Phone Co",
    "ZZ Unused",
  ]);
  await input.fill("");
  await input.press("Tab");
  await expect(d.getByRole("alert")).toHaveText("Payee name cannot be empty");
  await input.fill("zz cafe a");
  await input.press("Enter");
  await expect(d.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(async () => (await payees(request, s.plan)).some((p) => p.name === "zz cafe a"))
    .toBe(true);
  await realClick(page, pick(d, "ZZ Cafe A"));
  await input.fill("ZZ Cafe Z");
  await input.press("Enter");
  await expect
    .poll(async () => (await payees(request, s.plan)).some((p) => p.name === "ZZ Cafe Z"))
    .toBe(true);
  await realClick(page, btn(d, "Done"));
  await expect(page.getByRole("row").filter({ hasText: "ZZ Cafe Z" })).toHaveCount(3);
});

test("7 Show N Transactions: the popover, sorted by date, Close", async ({ page, request }) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  await realClick(page, pick(d, "ZZ Cafe B"));
  await expect(btn(d, "Show 2 Transactions")).toBeVisible();
  await realClick(page, pick(d, "ZZ Cafe A"));
  await realClick(page, btn(d, "Show 3 Transactions"));
  const pop = page.getByRole("dialog", { name: "Transactions", exact: true });
  await expect(pop.getByRole("columnheader")).toHaveText([
    "ACCOUNT",
    "DATE",
    "CATEGORY",
    "MEMO",
    "AMOUNT",
  ]);
  const memos = pop.locator("tbody tr td:nth-child(4)");
  await expect(memos).toHaveText(["third", "second", "first"]);
  await realClick(page, pop.getByRole("button", { name: "DATE", exact: true }));
  await expect(memos).toHaveText(["first", "second", "third"]);
  await realClick(page, pop.getByRole("button", { name: "Close", exact: true }));
  await expect(pop).toHaveCount(0);
  await expect(d).toBeVisible();
});

test("7b several selected: Show N Transactions opens a popover with a PAYEE column", async ({
  page,
  request,
}) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  await realClick(page, pick(d, "ZZ Cafe A"));
  await realClick(page, tick(d, "ZZ Cafe B"));
  await expect(btn(d, "Show 5 Transactions")).toBeVisible();
  await realClick(page, btn(d, "Show 5 Transactions"));
  const pop = page.getByRole("dialog", { name: "Transactions", exact: true });
  await expect(pop.getByRole("columnheader")).toHaveText([
    "PAYEE",
    "ACCOUNT",
    "DATE",
    "CATEGORY",
    "MEMO",
    "AMOUNT",
  ]);
  await expect(pop.locator("tbody tr")).toHaveCount(5);
  await expect(
    pop.locator("tbody tr td:nth-child(1)").filter({ hasText: "ZZ Cafe A" }),
  ).toHaveCount(3);
  await expect(
    pop.locator("tbody tr td:nth-child(1)").filter({ hasText: "ZZ Cafe B" }),
  ).toHaveCount(2);
  await realClick(page, pop.getByRole("button", { name: "Close", exact: true }));
  await expect(pop).toHaveCount(0);
});

test("8 a transfer payee is read-only; mixing it with another asks to deselect it", async ({
  page,
  request,
}) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  await expandTransfers(page, d);
  await realClick(page, pick(d, "Transfer : ZZ Card"));
  await expect(d.getByRole("heading", { name: "Transfer : ZZ Card", exact: true })).toBeVisible();
  await expect(
    d.getByText(/Transfer payees are used to move money between accounts/),
  ).toBeVisible();
  await expect(d.getByRole("textbox", { name: "Payee Name" })).toHaveCount(0);
  await expect(d.getByRole("heading", { name: "Categorization", exact: true })).toHaveCount(0);
  await expect(btn(d, "Hide")).toHaveCount(0);
  await expect(btn(d, "Delete")).toHaveCount(0);
  await realClick(page, tick(d, "ZZ Cafe A"));
  await expect(d.getByText(/Only one payee group can be edited at a time/)).toBeVisible();
  await realClick(page, btn(d, "deselect transfer payees"));
  await expect(d.getByRole("textbox", { name: "Payee Name", exact: true })).toHaveValue(
    "ZZ Cafe A",
  );
});

test("8b a transfer payee has a Renaming card: a rule is added and removed; no other card (EXF-885)", async ({
  page,
  request,
}) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  await expandTransfers(page, d);
  await expect(btn(d, "Collapse Transfer Payees")).toBeVisible();
  await realClick(page, pick(d, "Transfer : ZZ Card"));
  await expect(d.getByRole("heading", { name: "Transfer : ZZ Card", exact: true })).toBeVisible();
  await expect(d.getByRole("heading", { name: "Renaming", exact: true })).toBeVisible();
  await expect(
    d.getByText("Imported payees that match these rules will be renamed.", { exact: true }),
  ).toBeVisible();
  await expect(
    d.getByText(/Transfer payees are used to move money between accounts/),
  ).toBeVisible();
  await d.getByRole("textbox", { name: "New rule text", exact: true }).fill("zz card payment");
  await realClick(page, btn(d, "Add a renaming rule"));
  await expect(d.getByRole("textbox", { name: "Rule text", exact: true })).toHaveValue(
    "zz card payment",
  );
  await expect(d.getByRole("img", { name: "Renaming rules applied", exact: true })).toHaveCount(1);
  // It was stored: another selection and back shows it, and a reload of the list keeps the gear.
  await realClick(page, tick(d, "Transfer : ZZ Checking"));
  await realClick(page, tick(d, "Transfer : ZZ Checking"));
  await realClick(page, pick(d, "Transfer : ZZ Card"));
  await expect(d.getByRole("textbox", { name: "Rule text", exact: true })).toHaveValue(
    "zz card payment",
  );
  await expect(d.getByRole("textbox", { name: "Payee Name" })).toHaveCount(0);
  await expect(d.getByRole("heading", { name: "Categorization", exact: true })).toHaveCount(0);
  await expect(btn(d, "Hide")).toHaveCount(0);
  await expect(btn(d, "Delete")).toHaveCount(0);
  await realClick(page, btn(d, "Remove renaming rule"));
  await expect(d.getByRole("textbox", { name: "Rule text", exact: true })).toHaveCount(0);
  await expect(d.getByRole("img", { name: "Renaming rules applied", exact: true })).toHaveCount(0);
});

test("8c a rule added while the payee's rules list is still loading stays on screen, once", async ({
  page,
  request,
}) => {
  const s = await seedPayees(request);
  const transfer = s.ids["Transfer : ZZ Card"];
  await delayRoute(
    page,
    (url) => decodeURIComponent(url.pathname).endsWith(`/payees/${transfer}/rename-rules`),
    1_000,
  );
  const d = await open(page, s);
  await expandTransfers(page, d);
  await realClick(page, pick(d, "Transfer : ZZ Card"));
  await expect(d.getByRole("heading", { name: "Renaming", exact: true })).toBeVisible();
  await d.getByRole("textbox", { name: "New rule text", exact: true }).fill("zz card payment");
  await realClick(page, btn(d, "Add a renaming rule"));
  const ruleText = d.getByRole("textbox", { name: "Rule text", exact: true });
  await expect(ruleText).toHaveCount(1);
  await expect(ruleText).toHaveValue("zz card payment");
  await page.waitForTimeout(1_500);
  await expect(ruleText).toHaveCount(1);
  await expect(ruleText).toHaveValue("zz card payment");
  expect(await rulesOf(request, s.plan, transfer)).toHaveLength(1);
});

test("9 hide and unhide: the picker follows", async ({ page, request }) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  await realClick(page, pick(d, "ZZ Cafe A"));
  await realClick(page, btn(d, "Hide"));
  await expect(d.getByText(/^Hidden Payees/)).toBeVisible();
  await expect(btn(d, "Unhide")).toBeVisible();
  await expect(d.locator(".mp-payee.is-hidden .mp-name")).toHaveText(["ZZ Cafe A"]);
  await expect
    .poll(async () => (await payees(request, s.plan)).find((p) => p.name === "ZZ Cafe A")?.hidden)
    .toBe(true);
  await realClick(page, btn(d, "Unhide"));
  await expect(d.getByText(/^Hidden Payees/)).toHaveCount(0);
  await expect(btn(d, "Hide")).toBeVisible();
});

test("2 and 9 from the payee field: the row stays; a hidden payee is no longer offered", async ({
  page,
  request,
}) => {
  const s = await seedPayees(request);
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const field = page.getByRole("combobox", { name: "Payee", exact: true });
  await realClick(page, page.getByRole("button", { name: "Add Transaction", exact: true }));
  await field.fill("ZZ");
  // The payee list loads after the field opens: click the footer once the list has settled.
  await expect(page.getByRole("option", { name: "ZZ Cafe A", exact: true })).toBeVisible();
  await realClick(page, page.getByRole("button", { name: "Manage Payees", exact: true }));
  const d = page.getByRole("dialog", { name: "Manage Payees", exact: true });
  await expect(d).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(d).toHaveCount(0);
  await expect(field).toHaveValue("ZZ");
  await expect(field).toBeFocused();
  await expect(page.getByRole("option", { name: "ZZ Cafe A", exact: true })).toBeVisible();
  await realClick(page, page.getByRole("button", { name: "Manage Payees", exact: true }));
  await realClick(page, pick(d, "ZZ Cafe A"));
  await realClick(page, btn(d, "Hide"));
  await expect
    .poll(async () => (await payees(request, s.plan)).find((p) => p.name === "ZZ Cafe A")?.hidden)
    .toBe(true);
  await realClick(page, btn(d, "Done"));
  await field.fill("ZZ Cafe");
  await expect(page.getByRole("option", { name: "ZZ Cafe B", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "ZZ Cafe A", exact: true })).toHaveCount(0);
});

test("10 and 11 delete: an unused payee at once; a used one asks for a new payee", async ({
  page,
  request,
}) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  await realClick(page, pick(d, "ZZ Unused"));
  await realClick(page, btn(d, "Delete"));
  await expect(pick(d, "ZZ Unused")).toHaveCount(0);
  await expect(d.getByText("Select a payee to edit.", { exact: true })).toBeVisible();
  await realClick(page, pick(d, "ZZ Cafe A"));
  await realClick(page, btn(d, "Delete"));
  await expect(
    d.getByText(
      "3 transactions are using this payee(s). Select a new payee for these transactions.",
    ),
  ).toBeVisible();
  const select = d.getByRole("combobox", { name: "New payee", exact: true });
  await expect(select).toHaveValue("");
  await expect(select.locator("option", { hasText: "Transfer :" })).toHaveCount(0);
  await realClick(page, btn(d, "Cancel"));
  await expect(btn(d, "Delete")).toBeVisible();
  await realClick(page, btn(d, "Delete"));
  await select.selectOption({ label: "ZZ Cafe B" });
  await realClick(page, btn(d, "Delete"));
  await expect(pick(d, "ZZ Cafe A")).toHaveCount(0);
  await realClick(page, pick(d, "ZZ Cafe B"));
  await expect(btn(d, "Show 5 Transactions")).toBeVisible();
  await realClick(page, btn(d, "Done"));
  await expect(page.getByRole("row").filter({ hasText: "ZZ Cafe B" })).toHaveCount(5);
});

test("12 Select N Unused Payees", async ({ page, request }) => {
  const s = await seedPayees(request);
  let d = await open(page, s);
  // With the seed alone: one unused payee, and the link ticks it alone.
  await expect(btn(d, "Select 1 Unused Payee")).toBeVisible();
  await realClick(page, btn(d, "Select 1 Unused Payee"));
  await expect(d.getByText("Payees (1)", { exact: true })).toBeVisible();
  await expect(tick(d, "ZZ Unused")).toBeChecked();
  await realClick(page, btn(d, "Done"));
  // A payee whose only transaction was deleted joins it.
  await s
    .tx("ZZ Spare")
    .then((t) => call(request, "DELETE", `/api/v1/budgets/${s.plan}/transactions/${t.id}`));
  d = await openManagePayees(page, s.name);
  await expect(btn(d, "Select 2 Unused Payees")).toBeVisible();
  await d.getByRole("textbox", { name: "Search Payees", exact: true }).fill("Spare");
  await expect(btn(d, "Select 1 Unused Payee")).toBeVisible();
  await d.getByRole("textbox", { name: "Search Payees", exact: true }).fill("");
  await realClick(page, btn(d, "Select 2 Unused Payees"));
  await expect(d.getByText("Payees (2)", { exact: true })).toBeVisible();
  await expect(tick(d, "ZZ Spare")).toBeChecked();
  await expect(tick(d, "ZZ Unused")).toBeChecked();
});

test("11 delete with [No Payee] leaves the payee cell empty", async ({ page, request }) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  await realClick(page, pick(d, "ZZ Cafe A"));
  await realClick(page, btn(d, "Delete"));
  await realClick(page, btn(d, "Delete"));
  await expect(pick(d, "ZZ Cafe A")).toHaveCount(0);
  await realClick(page, btn(d, "Done"));
  const rows = page.getByRole("row").filter({ hasText: "third" });
  await expect(rows).toHaveCount(1);
  await expect(rows).not.toContainText("ZZ Cafe");
  await expect(page.getByRole("row").filter({ hasText: "ZZ Cafe A" })).toHaveCount(0);
});

test("13 several selected: the names, Hide All, Delete All with the summed count", async ({
  page,
  request,
}) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  for (const n of ["ZZ Cafe A", "ZZ Cafe B", "ZZ Unused"]) await realClick(page, tick(d, n));
  await expect(d.getByText("3 Payees Selected", { exact: true })).toBeVisible();
  await expect(d.locator(".mp-selected-name")).toHaveText(["ZZ Cafe A", "ZZ Cafe B", "ZZ Unused"]);
  await realClick(page, btn(d, "Delete All"));
  await expect(
    d.getByText(
      "5 transactions are using this payee(s). Select a new payee for these transactions.",
    ),
  ).toBeVisible();
  await expect(btn(d, "Delete All")).toBeVisible();
  await realClick(page, btn(d, "Cancel"));
  await realClick(page, btn(d, "Hide All"));
  await expect(d.getByText("Hidden Payees (3)", { exact: true })).toBeVisible();
  await expect(btn(d, "Unhide All")).toBeVisible();
});

test("14 Undo and Redo are disabled (EXF-530); Done closes", async ({ page, request }) => {
  const s = await seedPayees(request);
  const d = await open(page, s);
  await expect(btn(d, "Undo")).toBeDisabled();
  await expect(btn(d, "Redo")).toBeDisabled();
  await realClick(page, btn(d, "Done"));
  await expect(d).toHaveCount(0);
});

test("23 Expand Transfer Payees does not move when a late payees response lands, and one press opens it", async ({
  page,
  request,
}) => {
  const s = await seedPayees(request);
  await delayRoute(
    page,
    (url) => decodeURIComponent(url.pathname).endsWith("/payees"),
    1_000,
  );
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  const d = await openManagePayees(page, s.name);
  const expand = btn(d, "Expand Transfer Payees");
  // Before the fix the header showed at once, in the second row; after it, only once the rows are there.
  const shown = await Promise.race([
    expand.waitFor().then(() => "header"),
    d.locator(".mp-name").first().waitFor().then(() => "rows"),
  ]);
  const first = shown === "header" ? await expand.boundingBox() : null;
  await expect(d.locator(".mp-name").first()).toBeVisible();
  await expect(expand).toBeVisible();
  const settled = await expand.boundingBox();
  if (first) expect(settled).toEqual(first);
  expect(shown, "no group header before the rows land").toBe("rows");
  if (!settled) throw new Error("Expand Transfer Payees has no box");
  const x = settled.x + settled.width / 2;
  const y = settled.y + settled.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
  await expect(btn(d, "Collapse Transfer Payees")).toBeVisible();
});
