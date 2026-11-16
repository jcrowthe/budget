import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  assign,
  box,
  GROCERIES,
  getMonth,
  longMonth,
  NEXT,
  openPlan,
  PHONE,
  panel,
  RENT,
  removePlan,
  row,
  type Seed,
  seedPlan,
  spend,
  TODAY,
} from "./plan-panel.fixtures";
import { authHeaders } from "./support/auth";
import { realClick } from "./support/real-click";

let s: Seed;
test.beforeEach(async ({ request }) => {
  s = await seedPlan(request, "panel");
});
test.afterEach(async ({ request }) => {
  await removePlan(request, s);
});

const summaryRow = (page: Page, label: string) =>
  panel(page).locator(".panel-row", { hasText: label });
const value = (page: Page, label: string) => summaryRow(page, label).locator(".panel-row-value");
const select = (page: Page, name: string) =>
  page.locator(".category-name", { hasText: name }).click();

const here = longMonth(TODAY);
const prev = longMonth(
  new Date(Date.UTC(Number(TODAY.slice(0, 4)), Number(TODAY.slice(5, 7)) - 2, 1))
    .toISOString()
    .slice(0, 10),
);
const TIPS: [string, string][] = [
  ["Left Over from Last Month", `The total amount of money you have left over from ${prev}.`],
  [`Assigned in ${here}`, `The total amount of money you have assigned in ${here}.`],
  ["Activity", `The total amount of activity (e.g. spending) in ${here}.`],
  [
    "Available",
    `The total amount of money you have available in ${here}. Pro-tip: This includes money set aside for credit card payments and money left over from past months.`,
  ],
];

test("the month summary and its four tooltips", async ({ page }) => {
  await openPlan(page, s);
  await expect(panel(page).getByRole("heading", { name: `${here}'s Summary` })).toBeVisible();
  for (const [label, tip] of TIPS) {
    await summaryRow(page, label).first().hover();
    await expect(page.getByRole("tooltip")).toHaveText(tip, { timeout: 5000 });
    await page.mouse.move(5, 5);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
  await summaryRow(page, "Activity").focus();
  await expect(page.getByRole("tooltip")).toHaveText(TIPS[2]?.[1] ?? "", { timeout: 5000 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("the totals follow the API, hidden categories and edits", async ({ page, request }) => {
  await assign(request, s, GROCERIES, 100000);
  await assign(request, s, RENT, 50000);
  await spend(request, s, GROCERIES, 30000);
  await openPlan(page, s);
  await expect(value(page, "Left Over from Last Month")).toHaveText("$0.00");
  await expect(value(page, `Assigned in ${here}`)).toHaveText("$150.00");
  await expect(value(page, "Activity")).toHaveText("−$30.00");
  await expect(value(page, "Available")).toHaveText("$120.00");
  // Two selected: the same figures over just those two.
  await realClick(page, box(page, GROCERIES));
  await realClick(page, box(page, RENT));
  await expect(panel(page).getByRole("heading", { name: "2 Categories Selected" })).toBeVisible();
  await expect(value(page, `Assigned in ${here}`)).toHaveText("$150.00");
  await expect(value(page, "Available")).toHaveText("$120.00");
  // An Assigned edit follows without a reload.
  await realClick(page, box(page, RENT));
  await realClick(page, box(page, GROCERIES));
  await row(page, PHONE).locator(".assigned-box").click();
  await row(page, PHONE).locator("input").fill("25");
  await row(page, PHONE).locator("input").press("Enter");
  await realClick(page, box(page, "Needs"));
  await realClick(page, header(page));
  await expect(value(page, `Assigned in ${here}`)).toHaveText("$175.00");
  // The API agrees, with and without ids.
  const month = await getMonth(request, s.id, TODAY);
  expect(
    month.groups
      .flatMap((g: { categories: { assigned: number }[] }) => g.categories)
      .reduce((a: number, c: { assigned: number }) => a + c.assigned, 0),
  ).toBe(175000);
  // Hiding a category with money drops its figures from the month totals.
  await page.keyboard.press("Escape");
  await row(page, GROCERIES).locator(".cell-name").click({ button: "right" });
  await page
    .getByRole("dialog", { name: "Edit Category", exact: true })
    .getByRole("button", { name: "Hide" })
    .click();
  await expect(value(page, `Assigned in ${here}`)).toHaveText("$75.00");
  await expect(value(page, "Available")).toHaveText("$75.00");
});

test("moving money keeps the month totals and moves the selection's", async ({ page, request }) => {
  await assign(request, s, GROCERIES, 100000);
  await openPlan(page, s);
  await expect(value(page, "Available")).toHaveText("$100.00");
  await realClick(page, box(page, GROCERIES));
  await realClick(page, box(page, RENT));
  await expect(value(page, "Available")).toHaveText("$100.00");
  await row(page, GROCERIES).locator(".available-pill").click();
  const dlg = page.getByRole("dialog", { name: "Move money", exact: true });
  await dlg.getByRole("textbox", { name: "Amount", exact: true }).fill("10");
  await realClick(page, dlg.getByRole("combobox", { name: "To", exact: true }));
  await realClick(page, page.getByRole("option").filter({ hasText: PHONE }).first());
  await dlg.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The month totals are unchanged; the two selected categories lost 10.00 to a category outside them.
  await realClick(page, header(page));
  await expect(value(page, `Assigned in ${here}`)).toHaveText("$100.00");
  await expect(value(page, "Available")).toHaveText("$100.00");
  await realClick(page, box(page, GROCERIES));
  await realClick(page, box(page, RENT));
  await expect(value(page, `Assigned in ${here}`)).toHaveText("$90.00");
});

test("collapse and expand the summary and the Available Balance card", async ({ page }) => {
  await openPlan(page, s);
  const sum = panel(page).getByRole("button", { name: `${here}'s Summary` });
  await realClick(page, sum);
  await expect(sum).toHaveAttribute("aria-expanded", "false");
  await expect(panel(page).getByText("Left Over from Last Month")).toBeHidden();
  await realClick(page, sum);
  await expect(sum).toHaveAttribute("aria-expanded", "true");
  await expect(panel(page).getByText("Left Over from Last Month")).toBeVisible();
  await select(page, RENT);
  const bal = panel(page).getByRole("button", { name: "Available Balance" });
  await realClick(page, bal);
  await expect(bal).toHaveAttribute("aria-expanded", "false");
  await expect(panel(page).getByText("Cash Spending")).toBeHidden();
  await realClick(page, bal);
  await expect(panel(page).getByText("Cash Spending")).toBeVisible();
});

test("the inspector's rows add up to the pill, this month and the next", async ({
  page,
  request,
}) => {
  await assign(request, s, GROCERIES, 100000);
  await spend(request, s, GROCERIES, 30000);
  await openPlan(page, s);
  await select(page, GROCERIES);
  await expect(panel(page).getByRole("heading", { level: 1, name: GROCERIES })).toBeVisible();
  await expect(
    panel(page).getByRole("button", { name: `Edit category: ${GROCERIES}` }),
  ).toBeVisible();
  const vals = panel(page).locator(".panel-card-body .panel-row-value");
  await expect(vals).toHaveText(["$0.00", "+$100.00", "−$30.00", "$0.00"]);
  const pill = panel(page).locator(".available-pill");
  await expect(pill).toHaveText("$70.00");
  await expect(pill).toHaveClass(/positive/);
  // Next month: 70 left over; assigning 30 gives 100.
  await assign(request, s, GROCERIES, 30000, NEXT);
  await realClick(page, page.getByRole("button", { name: "Next month", exact: true }));
  await expect(panel(page).getByRole("button", { name: "Available Balance" })).toBeVisible();
  await expect(vals).toHaveText(["$70.00", "+$30.00", "$0.00", "$0.00"]);
  await expect(pill).toHaveText("$100.00");
});

test("the pencil renames through the popover", async ({ page }) => {
  await openPlan(page, s);
  await select(page, RENT);
  await realClick(page, panel(page).getByRole("button", { name: `Edit category: ${RENT}` }));
  const pop = page.getByRole("dialog", { name: "Edit Category", exact: true });
  await pop.getByPlaceholder("Enter category name").fill("ZZ Renamed");
  await pop.getByRole("button", { name: "OK" }).click();
  await expect(panel(page).getByRole("heading", { level: 1, name: "ZZ Renamed" })).toBeVisible();
  await expect(page.locator(".category-name", { hasText: "ZZ Renamed" })).toBeVisible();
});

const noteOf = async (request: APIRequestContext, month = TODAY) =>
  (await getMonth(request, s.id, month)).groups
    .flatMap((g: { categories: { id: string; note: string | null }[] }) => g.categories)
    .find((c: { id: string }) => c.id === s.cat[RENT]).note;

test("a two-line note is saved on blur, shown after a reload, in the hover title and in other months", async ({
  page,
  request,
}) => {
  await openPlan(page, s);
  await select(page, RENT);
  const notes = panel(page).locator(".panel-card", { hasText: "Notes" });
  await expect(notes.getByText("Enter a note...")).toBeVisible();
  await realClick(page, notes.locator(".note-display"));
  const field = notes.getByRole("textbox", { name: "Note" });
  await field.pressSequentially("line one");
  await field.press("Enter");
  await field.pressSequentially("line two");
  await realClick(page, page.locator(".grid-toolbar"));
  await expect.poll(() => noteOf(request)).toBe("line one\nline two");
  expect(await noteOf(request, NEXT)).toBe("line one\nline two");
  await page.reload();
  await expect(page.locator(".category-row").first()).toBeVisible();
  await select(page, RENT);
  await expect(panel(page).locator(".note-display")).toHaveText("line one\nline two");
  await expect(page.locator(".category-name", { hasText: RENT })).toHaveAttribute(
    "title",
    `${RENT}\nline one\nline two`,
  );
  // Clear it.
  await realClick(page, panel(page).locator(".note-display"));
  await panel(page).getByRole("textbox", { name: "Note" }).fill("");
  await realClick(page, page.locator(".grid-toolbar"));
  await expect.poll(() => noteOf(request)).toBeNull();
  await expect(panel(page).getByText("Enter a note...")).toBeVisible();
  await expect(page.locator(".category-name", { hasText: RENT })).toHaveAttribute("title", RENT);
});

test("two note saves in a row land in order even when the first is slow", async ({
  page,
  request,
}) => {
  await openPlan(page, s);
  await select(page, RENT);
  let first = true;
  let release: () => void = () => {};
  const firstDone = new Promise<void>((r) => {
    release = r;
  });
  await page.route(`**/api/v1/budgets/${s.id}/categories/${s.cat[RENT]}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    if (first) {
      first = false;
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue().catch(() => {});
      release();
      return;
    }
    await route.continue().catch(() => {});
  });
  const save = async (text: string) => {
    await realClick(page, panel(page).locator(".note-display"));
    await panel(page).getByRole("textbox", { name: "Note" }).fill(text);
    await realClick(page, page.locator(".grid-toolbar"));
  };
  await save("first");
  await save("second");
  // The held first save has now reached the server: only then can a lost-write race show.
  await firstDone;
  await expect.poll(() => noteOf(request), { timeout: 10000 }).toBe("second");
  await expect(panel(page).locator(".note-display")).toHaveText("second");
  await page.waitForTimeout(500);
  expect(await noteOf(request)).toBe("second");
});

test("the REST summary, the category month and the tool agree with the panel", async ({
  page,
  request,
}) => {
  await assign(request, s, GROCERIES, 100000);
  await spend(request, s, GROCERIES, 30000);
  await openPlan(page, s);
  const get = async (path: string) => {
    const res = await request.get(`/api/v1/budgets/${s.id}/months/${TODAY}${path}`, {
      headers: await authHeaders(),
    });
    return { status: res.status(), body: (await res.json()).data };
  };
  const all = await get("/summary");
  expect(all.body).toEqual({ leftover: 0, assigned: 100000, activity: -30000, available: 70000 });
  await expect(value(page, "Available")).toHaveText("$70.00");
  const one = await get(`/summary?category_ids=${s.cat[GROCERIES]},${s.cat[RENT]}`);
  expect(one.body.available).toBe(70000);
  expect((await get(`/summary?category_ids=${crypto.randomUUID()}`)).status).toBe(404);
  expect((await get("/summary?category_ids=")).status).toBe(422);
  const cm = await get(`/categories/${s.cat[GROCERIES]}`);
  expect(cm.body).toMatchObject({
    assigned: 100000,
    cash_activity: -30000,
    credit_activity: 0,
    available: 70000,
  });
  await select(page, GROCERIES);
  await expect(panel(page).locator(".available-pill")).toHaveText("$70.00");
});

test("the panel is a third of the body, resizes with the mouse and keeps its width for the session", async ({
  page,
}) => {
  await openPlan(page, s);
  const bodyW = (await page.locator(".plan-body").boundingBox())?.width ?? 0;
  const w0 = (await panel(page).boundingBox())?.width ?? 0;
  expect(Math.abs(w0 - bodyW * 0.33)).toBeLessThanOrEqual(2);
  const handle = panel(page).getByRole("separator", { name: "Resize panel" });
  await expect(handle).toBeVisible();
  const hb = await handle.boundingBox();
  const x = (hb?.x ?? 0) + (hb?.width ?? 0) / 2;
  const y = (hb?.y ?? 0) + 200;
  expect(
    await handle.evaluate(
      (el, [px, py]) => el.contains(document.elementFromPoint(px as number, py as number)),
      [x, y],
    ),
  ).toBe(true);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 50, y, { steps: 5 });
  await page.mouse.move(x - 100, y, { steps: 5 });
  await page.mouse.up();
  const w1 = (await panel(page).boundingBox())?.width ?? 0;
  expect(Math.abs(w1 - (w0 + 100))).toBeLessThanOrEqual(3);
  await page.reload();
  await expect(page.locator(".category-row").first()).toBeVisible();
  expect(Math.abs(((await panel(page).boundingBox())?.width ?? 0) - w1)).toBeLessThanOrEqual(1);
  await page.getByRole("separator", { name: "Resize panel" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await panel(page).boundingBox())?.width ?? 0)
    .toBeLessThan(w1 - 10);
});

const header = (page: Page, label = "Check all") =>
  page.getByRole("checkbox", { name: label, exact: true });
