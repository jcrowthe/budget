import type { Page, Response } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { Plan } from "./support/plan-seed";
import { realClick } from "./support/real-click";
import { call, MONTH, seed, TODAY } from "./support/register-seed";
import { createSched, listSched } from "./support/scheduled-seed";

const RENT = "🏠 Rent/Mortgage";
const GROC = "🛒 Groceries";
const FUN = "🍿 Entertainment";
const UNDO_TITLE = "Undo the last thing you did (in Budget, not in life).";
const REDO_TITLE = "Redo that thing you just undid. Practice decisiveness.";

const pad = (n: number) => String(n).padStart(2, "0");
const ym = (offset: number) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}`;
};

type Req = import("@playwright/test").APIRequestContext;
let plan: Plan;
let seeded = "";
test.beforeEach(async ({ request }: { request: Req }) => {
  plan = new Plan(request);
  seeded = "";
});
test.afterEach(async ({ request }: { request: Req }) => {
  if (plan.id) await plan.remove();
  if (seeded) await request.delete(`/api/v1/budgets/${seeded}`, { headers: await authHeaders() });
});

const open = async (page: Page, id: string) => {
  await page.goto(`/${id}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(
    page.locator(".rta-box.is-positive, .rta-box.is-zero, .rta-box.is-negative"),
  ).toBeVisible();
};
const undoBtn = (page: Page) => page.getByRole("button", { name: "Undo", exact: true });
const redoBtn = (page: Page) => page.getByRole("button", { name: "Redo", exact: true });
const catRow = (page: Page, name: string) =>
  page.locator(".category-row", { has: page.getByText(name, { exact: true }) });
const assignedOf = (page: Page, name: string) =>
  catRow(page, name).locator(".assigned-box .amount");
const pill = (page: Page, name: string) => catRow(page, name).locator(".available-pill");
const isPatch = (r: Response) =>
  r.request().method() === "PATCH" && /\/months\/.+\/categories\//.test(r.url());
const isUndo = (r: Response) =>
  r.request().method() === "POST" && /\/changes\/.+\/undo$/.test(r.url());
const money = (n: number) => `$${n.toFixed(2)}`;
const popover = (page: Page, name: string) => page.getByRole("dialog", { name });

/** Types a value into a category's Assigned cell and waits for the PATCH and for Undo to be enabled. */
async function setTo(page: Page, name: string, text: string) {
  await assignedOf(page, name).click();
  await page.keyboard.type(text);
  const done = page.waitForResponse(isPatch);
  await page.getByRole("textbox", { name: `Assigned for ${name}` }).press("Enter");
  await done;
  await expect(undoBtn(page)).toBeEnabled();
}
/** Clicks a toolbar button and waits for the undo POST to answer 200. */
async function press(page: Page, btn: ReturnType<typeof undoBtn>) {
  const done = page.waitForResponse(isUndo);
  await btn.click();
  const r = await done;
  expect(r.status()).toBe(200);
  return r;
}
const dollars = async (name: string) => (await plan.cat(name)).assigned / 1000;

async function withRentAndGroceries(page: Page) {
  await plan.create("plan-undo");
  await plan.inflow(2000);
  await plan.assign(RENT, 450);
  await plan.assign(GROC, 205);
  await open(page, plan.id);
}

test("1 both buttons are disabled on a fresh load, with no title", async ({ page }) => {
  await plan.create("plan-undo");
  await open(page, plan.id);
  await expect(undoBtn(page)).toBeDisabled();
  await expect(redoBtn(page)).toBeDisabled();
  await expect(undoBtn(page)).not.toHaveAttribute("title", /.+/);
  await expect(redoBtn(page)).not.toHaveAttribute("title", /.+/);
});

test("2 three edits, three Undos in reverse order, three Redos", async ({ page }) => {
  await withRentAndGroceries(page);
  const seen: string[] = [];
  const both = async (label: string, rent: number, groc: number) => {
    await expect(assignedOf(page, RENT)).toHaveText(money(rent));
    await expect(assignedOf(page, GROC)).toHaveText(money(groc));
    expect([await dollars(RENT), await dollars(GROC)]).toEqual([rent, groc]);
    seen.push(`${label}: Rent ${rent} / Groceries ${groc}`);
  };
  await setTo(page, RENT, "451");
  await setTo(page, GROC, "207");
  await setTo(page, RENT, "454");
  await both("edited", 454, 207);
  await expect(undoBtn(page)).toHaveAttribute("title", UNDO_TITLE);
  await expect(redoBtn(page)).toBeDisabled();

  await press(page, undoBtn(page));
  await both("undo 1", 451, 207);
  await press(page, undoBtn(page));
  await both("undo 2", 451, 205);
  await expect(redoBtn(page)).toHaveAttribute("title", REDO_TITLE);
  await press(page, undoBtn(page));
  await both("undo 3", 450, 205);
  await expect(undoBtn(page)).toBeDisabled();

  await press(page, redoBtn(page));
  await both("redo 1", 451, 205);
  await press(page, redoBtn(page));
  await both("redo 2", 451, 207);
  await press(page, redoBtn(page));
  await both("redo 3", 454, 207);
  await expect(redoBtn(page)).toBeDisabled();
  await expect(undoBtn(page)).toBeEnabled();
  console.log(`AC2 sequence: ${seen.join(" | ")}`);
  test.info().annotations.push({ type: "AC2", description: seen.join(" | ") });
});

/** A plan whose group "D4 Register" holds ZZ-TEST Last, ZZ-TEST Gone (second-to-last) and D4 Groceries ($200). */
async function seedGroup(request: Req) {
  const s = await seed(request);
  seeded = s.plan;
  const m = await call(request, "GET", `/api/v1/budgets/${s.plan}/months/${MONTH}`);
  const group = m.groups.find((g: { categories: { id: string }[] }) =>
    g.categories.some((c) => c.id === s.category),
  ).id as string;
  const add = async (name: string) =>
    (await call(request, "POST", `/api/v1/budgets/${s.plan}/categories`, { group_id: group, name }))
      .category.id as string;
  const gone = await add("ZZ-TEST Gone");
  await add("ZZ-TEST Last");
  return { ...s, group, gone };
}
const groupNames = async (request: Req, planId: string, group: string) =>
  (
    (await call(request, "GET", `/api/v1/budgets/${planId}/months/${MONTH}`)).groups.find(
      (g: { id: string }) => g.id === group,
    ).categories as { name: string }[]
  ).map((c) => c.name);

async function deleteVia(page: Page, name: string, reassign: string) {
  await page.locator(".category-name", { hasText: name }).click({ button: "right" });
  await popover(page, "Edit Category").getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Category" });
  await dialog.getByRole("combobox", { name: "Select category" }).fill(reassign.slice(0, 8));
  await page.getByRole("option", { name: new RegExp(reassign) }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".category-name", { hasText: name })).toHaveCount(0);
}

test("3 deleting a category with money (reassigning), then Undo, restores it in place", async ({
  page,
  request,
}) => {
  const s = await seedGroup(request);
  await call(request, "PATCH", `/api/v1/budgets/${s.plan}/months/${MONTH}/categories/${s.gone}`, {
    assigned: 150000,
  });
  await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.checking,
    date: TODAY,
    amount: -30000,
    category_id: s.gone,
  });
  const before = await groupNames(request, s.plan, s.group);
  // New categories are added at the top: Gone is second-to-last.
  expect(before).toEqual(["ZZ-TEST Last", "ZZ-TEST Gone", "D4 Groceries"]);
  await open(page, s.plan);
  await expect(catRow(page, "ZZ-TEST Gone").locator(".cell-activity")).toHaveText("−$30.00");
  await deleteVia(page, "ZZ-TEST Gone", "D4 Groceries");
  await expect(assignedOf(page, "D4 Groceries")).toHaveText("$350.00");
  await press(page, undoBtn(page));
  await expect(page.locator(".category-name", { hasText: "ZZ-TEST Gone" })).toHaveCount(1);
  await expect(page.locator(".category-row .category-name")).toContainText([
    "ZZ-TEST Last",
    "ZZ-TEST Gone",
    "D4 Groceries",
  ]);
  expect(await groupNames(request, s.plan, s.group)).toEqual(before);
  const row = catRow(page, "ZZ-TEST Gone");
  await expect(row.locator(".assigned-box .amount")).toHaveText("$150.00");
  await expect(row.locator(".cell-activity")).toHaveText("−$30.00");
  await expect(assignedOf(page, "D4 Groceries")).toHaveText("$200.00");
  const m = await call(request, "GET", `/api/v1/budgets/${s.plan}/months/${MONTH}`);
  const gone = m.groups
    .flatMap((g: { categories: unknown[] }) => g.categories)
    .find((c: { name: string }) => c.name === "ZZ-TEST Gone");
  expect([gone.assigned, gone.activity]).toEqual([150000, -30000]);
});

test("4 ctrl+Z and ctrl+Y (and ctrl+shift+Z) work outside inputs, not inside the Assigned input", async ({
  page,
}) => {
  await withRentAndGroceries(page);
  await setTo(page, RENT, "451");
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("BODY");
  let done = page.waitForResponse(isUndo);
  await page.keyboard.press("Control+z");
  await done;
  await expect(assignedOf(page, RENT)).toHaveText(money(450));
  expect(await dollars(RENT)).toBe(450);
  done = page.waitForResponse(isUndo);
  await page.keyboard.press("Control+y");
  await done;
  await expect(assignedOf(page, RENT)).toHaveText(money(451));
  done = page.waitForResponse(isUndo);
  await page.keyboard.press("Control+z");
  await done;
  await expect(assignedOf(page, RENT)).toHaveText(money(450));
  done = page.waitForResponse(isUndo);
  await page.keyboard.press("Control+Shift+z");
  await done;
  await expect(assignedOf(page, RENT)).toHaveText(money(451));
  expect(await dollars(RENT)).toBe(451);

  // Inside the Assigned input the key is the input's own, never the Plan's.
  const undoCalls: string[] = [];
  page.on("request", (r) => {
    if (isUndo({ request: () => r, url: () => r.url() } as unknown as Response))
      undoCalls.push(r.url());
  });
  await assignedOf(page, GROC).click();
  const field = page.getByRole("textbox", { name: `Assigned for ${GROC}` });
  await page.keyboard.type("999");
  await page.keyboard.press("Control+z");
  await expect(field).toBeFocused();
  await page.keyboard.press("Control+y");
  await expect(field).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(undoBtn(page)).toBeEnabled();
  expect(undoCalls).toEqual([]);
  expect(await dollars(RENT)).toBe(451);
  expect(await dollars(GROC)).toBe(205);
});

test("5 a reload clears both stacks", async ({ page }) => {
  await withRentAndGroceries(page);
  await setTo(page, RENT, "451");
  await setTo(page, RENT, "452");
  await press(page, undoBtn(page));
  await expect(redoBtn(page)).toBeEnabled();
  await expect(undoBtn(page)).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(undoBtn(page)).toBeDisabled();
  await expect(redoBtn(page)).toBeDisabled();
});

test("6 a new action after an Undo disables Redo", async ({ page }) => {
  await withRentAndGroceries(page);
  await setTo(page, RENT, "451");
  await press(page, undoBtn(page));
  await expect(redoBtn(page)).toBeEnabled();
  await setTo(page, GROC, "207");
  await expect(redoBtn(page)).toBeDisabled();
  expect(await dollars(GROC)).toBe(207);
});

test("7 move, cover and rename each undo with one press; a collapse is not a step", async ({
  page,
}) => {
  await withRentAndGroceries(page);
  await plan.assign(FUN, -70);
  await plan.assign(GROC, 275);
  await page.reload();
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(pill(page, GROC)).toHaveText("$275.00");
  await expect(undoBtn(page)).toBeDisabled();

  // Move 75 from Rent (450) to Groceries.
  await realClick(page, pill(page, RENT));
  const mv = page.getByRole("dialog", { name: "Move money", exact: true });
  await mv.getByRole("textbox", { name: "Amount", exact: true }).fill("75");
  await realClick(page, mv.getByRole("combobox", { name: "To", exact: true }));
  await realClick(page, page.getByRole("option").filter({ hasText: GROC }).first());
  await realClick(page, mv.getByRole("button", { name: "OK", exact: true }));
  await expect(pill(page, RENT)).toHaveText("$375.00");
  await expect(pill(page, GROC)).toHaveText("$350.00");
  await expect(undoBtn(page)).toBeEnabled();
  const r = await press(page, undoBtn(page));
  expect((await r.json()).data.where.surface).toBe("plan");
  await expect(pill(page, RENT)).toHaveText("$450.00");
  await expect(pill(page, GROC)).toHaveText("$275.00");
  await expect(undoBtn(page)).toBeDisabled();

  // Cover Entertainment's -70 from Groceries.
  await realClick(page, pill(page, FUN));
  const cv = page.getByRole("dialog", { name: "Cover overspending", exact: true });
  await realClick(page, cv.getByRole("combobox", { name: "From", exact: true }));
  await realClick(page, page.getByRole("option").filter({ hasText: GROC }));
  await realClick(page, cv.getByRole("button", { name: "OK", exact: true }));
  await expect(pill(page, FUN)).toHaveText("$0.00");
  await expect(pill(page, GROC)).toHaveText("$205.00");
  await expect(undoBtn(page)).toBeEnabled();
  await press(page, undoBtn(page));
  await expect(pill(page, FUN)).toHaveText("−$70.00");
  await expect(pill(page, GROC)).toHaveText("$275.00");
  await expect(undoBtn(page)).toBeDisabled();

  // Rename Rent.
  await page.locator(".category-name", { hasText: RENT }).click({ button: "right" });
  const pop = popover(page, "Edit Category");
  await pop.getByPlaceholder("Enter category name").fill("ZZ-TEST Renamed");
  await pop.getByPlaceholder("Enter category name").press("Enter");
  await expect(page.locator(".category-name", { hasText: "ZZ-TEST Renamed" })).toBeVisible();
  await expect(undoBtn(page)).toBeEnabled();
  await press(page, undoBtn(page));
  await expect(page.locator(".category-name", { hasText: RENT })).toBeVisible();
  await expect(page.locator(".category-name", { hasText: "ZZ-TEST Renamed" })).toHaveCount(0);
  await expect(undoBtn(page)).toBeDisabled();

  // An edit, then a collapse: one Undo undoes the edit and the group stays collapsed.
  await setTo(page, GROC, "300");
  await page.getByRole("button", { name: "Collapse Bills categories" }).click();
  await expect(page.getByRole("button", { name: "Expand Bills categories" })).toBeVisible();
  await press(page, undoBtn(page));
  await expect.poll(() => dollars(GROC)).toBe(275);
  await expect(page.getByRole("button", { name: "Expand Bills categories" })).toBeVisible();
  await expect(undoBtn(page)).toBeDisabled();
});

test("9 deleting a category with a schedule (reassigning), then Undo, puts the schedule back", async ({
  page,
  request,
}) => {
  const s = await seed(request);
  seeded = s.plan;
  const g = (
    await call(request, "POST", `/api/v1/budgets/${s.plan}/category_groups`, {
      name: "ZZ-TEST Keep",
    })
  ).category_group.id;
  const target = (
    await call(request, "POST", `/api/v1/budgets/${s.plan}/categories`, {
      group_id: g,
      name: "ZZ-TEST Target",
    })
  ).category.id as string;
  const now = new Date();
  await createSched(request, s.plan, TODAY, {
    account_id: s.checking,
    date_first: `${now.getFullYear() + 1}-01-11`,
    frequency: "monthly",
    amount: -1000,
    payee_name: "ZZ-TEST Sched",
    category_id: s.category,
  });
  await open(page, s.plan);
  await deleteVia(page, "D4 Groceries", "ZZ-TEST Target");
  expect((await listSched(request, s.plan)).map((x) => x.category_id)).toEqual([target]);
  await press(page, undoBtn(page));
  await expect(page.locator(".category-name", { hasText: "D4 Groceries" })).toHaveCount(1);
  const list = await listSched(request, s.plan);
  expect(list).toHaveLength(1);
  expect(list[0].category_id).toBe(s.category);
});

test("10 Undo goes to the month where the change was made", async ({ page }) => {
  await withRentAndGroceries(page);
  await setTo(page, RENT, "451");
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(page).toHaveURL(`/${plan.id}/budget/${ym(1)}`);
  await expect(undoBtn(page)).toBeEnabled();
  await press(page, undoBtn(page));
  await expect(page).toHaveURL(`/${plan.id}/budget/${ym(0)}`);
  await expect(assignedOf(page, RENT)).toHaveText(money(450));
  expect(await dollars(RENT)).toBe(450);
});
