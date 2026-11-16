import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  assign,
  box,
  GROCERIES,
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
  TODAY,
  TRANSPORT,
  UTILITIES,
} from "./plan-panel.fixtures";
import { realClick } from "./support/real-click";

let s: Seed;
test.beforeEach(async ({ request }) => {
  s = await seedPlan(request, "sel");
});
test.afterEach(async ({ request }) => {
  await removePlan(request, s);
});

const checked = (page: Page, name: string) =>
  expect(box(page, name)).toHaveAttribute("aria-checked", "true");
const unchecked = (page: Page, name: string) =>
  expect(box(page, name)).toHaveAttribute("aria-checked", "false");
const header = (page: Page, label = "Check all") =>
  page.getByRole("checkbox", { name: label, exact: true });
const bg = (loc: ReturnType<typeof row>) =>
  loc.evaluate((el) => getComputedStyle(el).backgroundColor);

test("a name click selects only that category and opens no popover", async ({ page }) => {
  await openPlan(page, s);
  await page.locator(".category-name", { hasText: RENT }).click();
  await checked(page, RENT);
  await expect(row(page, RENT)).toHaveAttribute("aria-selected", "true");
  // Source: a selected category row is rgb(27, 29, 72) (measured on the test plan's Plan page).
  expect(await bg(row(page, RENT))).toBe("rgb(27, 29, 72)");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(panel(page).getByRole("heading", { level: 1, name: RENT })).toBeVisible();
  await page.locator(".category-name", { hasText: UTILITIES }).click();
  await checked(page, UTILITIES);
  await unchecked(page, RENT);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("checkboxes build a multi-selection, listed in grid order", async ({ page }) => {
  await openPlan(page, s);
  await page.locator(".category-name", { hasText: RENT }).click();
  await realClick(page, box(page, PHONE));
  await expect(panel(page).getByRole("heading", { name: "2 Categories Selected" })).toBeVisible();
  await expect(panel(page)).toContainText(`${RENT}, ${PHONE}`);
  await realClick(page, box(page, PHONE));
  await expect(panel(page).getByRole("heading", { level: 1, name: RENT })).toBeVisible();
});

test("a group checkbox and the header checkbox", async ({ page }) => {
  await openPlan(page, s);
  await page.locator(".category-name", { hasText: RENT }).click();
  await realClick(page, box(page, "Needs"));
  await expect(panel(page).getByRole("heading", { name: "5 Categories Selected" })).toBeVisible();
  await checked(page, "Needs");
  await expect(box(page, "Bills")).toHaveAttribute("aria-checked", "mixed");
  await expect(header(page)).toHaveAttribute("aria-checked", "mixed");
  await realClick(page, box(page, GROCERIES));
  await expect(box(page, "Needs")).toHaveAttribute("aria-checked", "mixed");
  // A partial selection: the header clears it; from empty it selects every category.
  await realClick(page, header(page));
  await expect(panel(page)).toContainText("'s Summary");
  await expect(panel(page).getByText("Categories Selected")).toHaveCount(0);
  await realClick(page, header(page));
  await expect(panel(page).getByRole("heading", { name: "11 Categories Selected" })).toBeVisible();
  await expect(header(page, "Uncheck all")).toHaveAttribute("aria-checked", "true");
});

test("arrow keys, Shift, Ctrl+A and Escape", async ({ page }) => {
  await openPlan(page, s);
  await page.locator(".grid-toolbar").click({ position: { x: 600, y: 5 } });
  await page.keyboard.press("ArrowDown");
  await checked(page, RENT);
  await page.keyboard.press("ArrowDown");
  await checked(page, PHONE);
  await unchecked(page, RENT);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await checked(page, GROCERIES); // across the group boundary
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(panel(page).getByRole("heading", { name: "3 Categories Selected" })).toBeVisible();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(panel(page).getByRole("heading", { name: "2 Categories Selected" })).toBeVisible();
  await page.keyboard.press("Control+a");
  await expect(panel(page).getByRole("heading", { name: "11 Categories Selected" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page).getByText("Categories Selected")).toHaveCount(0);
  await expect(panel(page)).toContainText("'s Summary");
});

test("keys typed in a field leave the selection alone", async ({ page }) => {
  await openPlan(page, s);
  await page.locator(".category-name", { hasText: RENT }).click();
  await page.getByRole("button", { name: "Edit category: " + RENT }).click();
  await page.getByPlaceholder("Enter category name").press("Escape");
  await row(page, RENT).locator(".assigned-box").click();
  const input = row(page, RENT).locator("input");
  await input.press("Control+a");
  await checked(page, RENT);
  await unchecked(page, PHONE);
  await input.press("Escape");
  await checked(page, RENT);
  // The note field is a field too: Escape, ArrowDown and Ctrl+A leave the selection and the inspector alone.
  await realClick(page, panel(page).locator(".note-display"));
  const note = panel(page).getByRole("textbox", { name: "Note" });
  await note.pressSequentially("abc");
  await note.press("Control+a");
  await note.press("ArrowDown");
  await checked(page, RENT);
  await unchecked(page, PHONE);
  await expect(panel(page).getByRole("heading", { level: 1, name: RENT })).toBeVisible();
  await expect(note).toBeFocused();
  await note.press("Escape");
  await checked(page, RENT);
  await expect(panel(page).getByRole("heading", { level: 1, name: RENT })).toBeVisible();
});

test("a right-click opens the edit popover of a category or a group", async ({ page }) => {
  await openPlan(page, s);
  await row(page, RENT).locator(".cell-name").click({ button: "right" });
  const pop = page.getByRole("dialog", { name: "Edit Category", exact: true });
  await expect(pop).toBeVisible();
  await expect(pop.getByPlaceholder("Enter category name")).toHaveValue(RENT);
  await pop.getByRole("button", { name: "Cancel" }).click();
  await page
    .locator(".group-row", { has: page.getByText("Needs", { exact: true }) })
    .click({ button: "right", position: { x: 300, y: 10 } });
  const g = page.getByRole("dialog", { name: "Edit Category Group", exact: true });
  await expect(g.getByPlaceholder("Enter category name")).toHaveValue("Needs");
});

test("the selection survives a month change and not a reload", async ({ page, request }) => {
  await assign(request, s, RENT, 1000);
  await openPlan(page, s);
  await page.locator(".category-name", { hasText: RENT }).click();
  await realClick(page, box(page, TRANSPORT));
  await expect(panel(page)).toContainText(`${longMonth(TODAY)}'s Summary`);
  await realClick(page, page.getByRole("button", { name: "Next month", exact: true }));
  await expect(panel(page)).toContainText(`${longMonth(NEXT)}'s Summary`);
  await expect(panel(page).getByRole("heading", { name: "2 Categories Selected" })).toBeVisible();
  await checked(page, RENT);
  await page.reload();
  await expect(page.locator(".category-row").first()).toBeVisible();
  await unchecked(page, RENT);
  await expect(panel(page).getByText("Categories Selected")).toHaveCount(0);
});

test("at 1024x700 the panel leaves the Assigned column and every control is reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await openPlan(page, s);
  await realClick(page, box(page, RENT));
  await realClick(page, box(page, PHONE));
  await realClick(page, header(page));
  await realClick(page, page.getByRole("button", { name: /^Collapse .* categories$/ }).first());
  await page
    .getByRole("button", { name: /^Expand .* categories$/ })
    .first()
    .click();
  const assigned = await page.locator(".header-row .cell-assigned").boundingBox();
  const side = await panel(page).boundingBox();
  expect((assigned?.x ?? 0) + (assigned?.width ?? 0)).toBeLessThanOrEqual((side?.x ?? 0) + 1);
  await realClick(page, header(page));
  await expect(panel(page).getByRole("heading", { name: /Categories Selected/ })).toBeVisible();
  await realClick(page, panel(page).getByRole("button", { name: /'s Summary$/ }));
  await expect(panel(page).getByRole("button", { name: /'s Summary$/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("the pencil opens the edit popover", async ({ page }) => {
  await openPlan(page, s);
  await page.locator(".category-name", { hasText: RENT }).click();
  await realClick(page, panel(page).getByRole("button", { name: `Edit category: ${RENT}` }));
  await expect(page.getByRole("dialog", { name: "Edit Category", exact: true })).toBeVisible();
});

test("a click on the name of the one selected category opens its edit popover (EXF-592)", async ({
  page,
}) => {
  await openPlan(page, s);
  await page.locator(".category-name", { hasText: RENT }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // A second click, with the real mouse, on the name of the one selected category.
  await realClick(page, row(page, RENT).locator(".category-name"));
  const pop = page.getByRole("dialog", { name: "Edit Category", exact: true });
  await expect(pop).toBeVisible();
  await expect(pop.getByPlaceholder("Enter category name")).toHaveValue(RENT);
  await pop.getByRole("button", { name: "Cancel" }).click();
  await expect(pop).toHaveCount(0);
  await checked(page, RENT);
  // The name of another category selects that one and opens nothing.
  await realClick(page, row(page, UTILITIES).locator(".category-name"));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await checked(page, UTILITIES);
  await unchecked(page, RENT);
});

test("with several selected, a name click selects only that category and opens nothing", async ({
  page,
}) => {
  await openPlan(page, s);
  await page.locator(".category-name", { hasText: RENT }).click();
  await realClick(page, box(page, PHONE));
  await expect(panel(page).getByRole("heading", { name: "2 Categories Selected" })).toBeVisible();
  await realClick(page, row(page, RENT).locator(".category-name"));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await checked(page, RENT);
  await unchecked(page, PHONE);
  await expect(panel(page).getByRole("heading", { level: 1, name: RENT })).toBeVisible();
});

test("selecting a row does not open its Assigned field, so the arrows and Escape stay shortcuts (EXF-592, deliberate)", async ({
  page,
}) => {
  await openPlan(page, s);
  await page.locator(".category-name", { hasText: RENT }).click();
  await expect(row(page, RENT).locator("input")).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await checked(page, PHONE);
  await expect(row(page, PHONE).locator("input")).toHaveCount(0);
  await page.keyboard.press("Control+a");
  await expect(panel(page).getByRole("heading", { name: "11 Categories Selected" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page).getByText("Categories Selected")).toHaveCount(0);
});
