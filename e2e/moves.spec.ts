import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { Plan } from "./support/plan-seed";
import { realClick } from "./support/real-click";

const RENT = "🏠 Rent/Mortgage";
const GROC = "🛒 Groceries";
const FUN = "🍿 Entertainment";

let plan: Plan;
test.beforeEach(async ({ request }) => {
  plan = new Plan(request);
  await plan.create("moves");
});
test.afterEach(async () => {
  await plan.remove();
});

const open = async (page: Page) => {
  await page.goto(`/${plan.id}/budget`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(
    page.locator(".rta-box.is-positive, .rta-box.is-zero, .rta-box.is-negative"),
  ).toBeVisible();
};
const catRow = (page: Page, name: string) =>
  page.locator(".category-row", { has: page.getByText(name, { exact: true }) });
const pill = (page: Page, name: string) => catRow(page, name).locator(".available-pill");
const assignedOf = (page: Page, name: string) =>
  catRow(page, name).locator(".assigned-box .amount");
const rta = (page: Page) => page.locator(".rta-box .rta-amount");
const css = (loc: Locator, prop: string) =>
  loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

const sizes = [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
];

/** Opens Move on a pill, picks a destination row by its text, types an amount when given, and presses OK. */
async function moveVia(page: Page, from: string, destination: RegExp | string, amount?: string) {
  await realClick(page, pill(page, from));
  const dlg = page.getByRole("dialog", { name: "Move money", exact: true });
  const ok = dlg.getByRole("button", { name: "OK", exact: true });
  await expect(ok).toBeDisabled();
  if (amount !== undefined)
    await dlg.getByRole("textbox", { name: "Amount", exact: true }).fill(amount);
  await realClick(page, dlg.getByRole("combobox", { name: "To", exact: true }));
  await realClick(page, page.getByRole("option").filter({ hasText: destination }).first());
  await expect(ok).toBeEnabled();
  await realClick(page, ok);
  await expect(dlg).toHaveCount(0);
}

test("Move opens with the full Available and lists Ready to Assign first", async ({ page }) => {
  await plan.inflow(1000);
  await plan.assign(RENT, 475);
  await open(page);
  await realClick(page, pill(page, RENT));
  const dlg = page.getByRole("dialog", { name: "Move money", exact: true });
  await expect(dlg.getByRole("textbox", { name: "Amount", exact: true })).toHaveValue("475.00");
  await expect(dlg.getByRole("button", { name: "OK", exact: true })).toBeDisabled();
  await realClick(page, dlg.getByRole("combobox", { name: "To", exact: true }));
  await expect(page.getByText("Plan Categories", { exact: true })).toBeVisible();
  const first = page.getByRole("option").first();
  await expect(first).toContainText("Inflow: Ready to Assign");
  await expect(first).toContainText("$525.00");
  await expect(page.getByRole("option").filter({ hasText: RENT })).toHaveCount(0);
  await expect(page.getByRole("option").filter({ hasText: GROC })).toHaveCount(1);
});

test("moving between categories changes both, the group subtotals, and not Ready to Assign", async ({
  page,
}) => {
  await plan.inflow(1000);
  await plan.assign(RENT, 475);
  await plan.assign(GROC, 200);
  await open(page);
  const before = await rta(page).innerText();
  await moveVia(page, RENT, GROC, "75");
  await expect(pill(page, RENT)).toHaveText("$400.00");
  await expect(pill(page, GROC)).toHaveText("$275.00");
  await expect(assignedOf(page, RENT)).toHaveText("$400.00");
  await expect(assignedOf(page, GROC)).toHaveText("$275.00");
  await expect(rta(page)).toHaveText(before);
  await page.reload();
  await expect(pill(page, RENT)).toHaveText("$400.00");
  await expect(pill(page, GROC)).toHaveText("$275.00");
  await expect(rta(page)).toHaveText(before);
});

test("the amount takes maths", async ({ page }) => {
  await plan.inflow(1000);
  await plan.assign(RENT, 100);
  await open(page);
  await moveVia(page, RENT, GROC, "20+5");
  await expect(pill(page, RENT)).toHaveText("$75.00");
  await expect(pill(page, GROC)).toHaveText("$25.00");
});

test("moving to Ready to Assign raises it and lowers the source's Assigned", async ({ page }) => {
  await plan.inflow(1000);
  await plan.assign(RENT, 400);
  await open(page);
  await expect(rta(page)).toHaveText("$600.00");
  await moveVia(page, RENT, "Inflow: Ready to Assign", "50");
  await expect(assignedOf(page, RENT)).toHaveText("$350.00");
  await expect(rta(page)).toHaveText("$650.00");
  expect((await plan.cat(RENT)).assigned).toBe(350000);
});

test("moving more than Available is allowed and turns the source red", async ({ page }) => {
  await plan.inflow(1000);
  await plan.assign(RENT, 30);
  await open(page);
  await moveVia(page, RENT, GROC, "100");
  await expect(pill(page, RENT)).toHaveText("−$70.00");
  // Source (CSS rule, dark theme): the negative pill is #bf2e3b.
  expect(await css(pill(page, RENT), "background-color")).toBe("rgb(191, 46, 59)");
  await expect(assignedOf(page, RENT)).toHaveText("−$70.00");
});

test("a zero pill is disabled and opens nothing", async ({ page }) => {
  await open(page);
  const p = pill(page, RENT);
  await expect(p).toBeDisabled();
  await p.click({ force: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a red pill opens Cover with no amount and brings the category to zero", async ({ page }) => {
  await plan.inflow(1000);
  await plan.assign(FUN, -70);
  await plan.assign(GROC, 275);
  await open(page);
  await realClick(page, pill(page, FUN));
  const dlg = page.getByRole("dialog", { name: "Cover overspending", exact: true });
  await expect(dlg.getByText("Cover overspending from", { exact: true })).toBeVisible();
  await expect(dlg.getByRole("textbox", { name: "Amount", exact: true })).toHaveCount(0);
  const ok = dlg.getByRole("button", { name: "OK", exact: true });
  await expect(ok).toBeDisabled();
  await realClick(page, dlg.getByRole("combobox", { name: "From", exact: true }));
  const options = page.getByRole("option");
  await expect(options.first()).toContainText("Inflow: Ready to Assign");
  await expect(options).toHaveCount(2);
  await realClick(page, options.filter({ hasText: GROC }));
  await realClick(page, ok);
  await expect(pill(page, FUN)).toHaveText("$0.00");
  await expect(pill(page, FUN)).toBeDisabled();
  await expect(pill(page, GROC)).toHaveText("$205.00");
  await expect(assignedOf(page, FUN)).toHaveText("$0.00");
});

test("a failed move puts the numbers back and says so", async ({ page }) => {
  await plan.inflow(1000);
  await plan.assign(RENT, 100);
  await open(page);
  await page.route("**/moves", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { id: "500", name: "internal_error", detail: "Internal error" },
      }),
    }),
  );
  await moveVia(page, RENT, GROC, "75");
  await expect(
    page.getByRole("alert").filter({ hasText: "Couldn't move the money." }),
  ).toBeVisible();
  await expect(pill(page, RENT)).toHaveText("$100.00");
  await expect(pill(page, GROC)).toHaveText("$0.00");
});

for (const size of sizes) {
  test(`the last category's pill, picker rows and buttons are reachable at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await plan.inflow(1000);
    await plan.assign(RENT, 100);
    const lastName = (await plan.month()).groups.at(-1)?.categories.at(-1)?.name ?? "";
    await plan.assign(lastName, 60);
    await open(page);
    const last = lastName;
    await realClick(page, pill(page, last));
    const dlg = page.getByRole("dialog", { name: "Move money", exact: true });
    await realClick(page, dlg.getByRole("combobox", { name: "To", exact: true }));
    const list = page.getByRole("listbox", { name: "Plan Categories", exact: true });
    const rows = list.getByRole("option");
    await realClick(page, rows.first());
    await expect(dlg.getByRole("combobox", { name: "To", exact: true })).toHaveValue(
      "Inflow: Ready to Assign",
    );
    await realClick(page, dlg.getByRole("combobox", { name: "To", exact: true }));
    await realClick(page, list.getByRole("option").last());
    await realClick(page, dlg.getByRole("button", { name: "OK", exact: true }));
    await expect(pill(page, last)).toHaveText("$0.00");
  });
}
