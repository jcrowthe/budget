import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { Plan } from "./support/plan-seed";
import { realClick } from "./support/real-click";

const RENT = "🏠 Rent/Mortgage";
const GROC = "🛒 Groceries";

let plan: Plan;
test.beforeEach(async ({ request }) => {
  plan = new Plan(request);
  await plan.create("rta");
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
const box = (page: Page) => page.locator(".rta-box");
const css = (loc: Locator, prop: string) =>
  loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
const catRow = (page: Page, name: string) =>
  page.locator(".category-row", { has: page.getByText(name, { exact: true }) });
const pill = (page: Page, name: string) => catRow(page, name).locator(".available-pill");
const assignedOf = (page: Page, name: string) =>
  catRow(page, name).locator(".assigned-box .amount");

test("positive state: copy, colours and the Assign button", async ({ page }) => {
  await plan.inflow(1000);
  await open(page);
  const b = box(page);
  await expect(b).toHaveClass(/is-positive/);
  await expect(b.locator(".rta-amount")).toHaveText("$1,000.00");
  await expect(b.locator(".rta-label")).toHaveText("Ready to Assign");
  // Source (CSS rule, dark theme): callout positive #346011, button #508316, amount 21px/700, radius 8.
  expect(await css(b, "background-color")).toBe("rgb(52, 96, 17)");
  expect(await css(b, "border-radius")).toBe("8px");
  expect(await css(b.locator(".rta-amount"), "font-size")).toBe("21px");
  expect(await css(b.locator(".rta-amount"), "font-weight")).toBe("700");
  const assign = b.getByRole("button", { name: "Assign", exact: true });
  expect(await css(assign, "background-color")).toBe("rgb(80, 131, 22)");
});

test("negative state and the live switch to zero", async ({ page }) => {
  await plan.inflow(100);
  await plan.assign(RENT, 150);
  await open(page);
  const b = box(page);
  await expect(b).toHaveClass(/is-negative/);
  await expect(b.locator(".rta-amount")).toHaveText("−$50.00");
  await expect(b.locator(".rta-label")).toHaveText("You assigned more than you have");
  // Source (CSS rules): callout negative #6a1020, Fix This #bf2e3b.
  expect(await css(b, "background-color")).toBe("rgb(106, 16, 32)");
  expect(
    await css(b.getByRole("button", { name: "Fix This", exact: true }), "background-color"),
  ).toBe("rgb(191, 46, 59)");
  await assignedOf(page, RENT).click();
  await page.keyboard.type("100");
  await page.keyboard.press("Enter");
  await expect(b).toHaveClass(/is-zero/);
  await expect(b.locator(".rta-label")).toHaveText("All Money Assigned");
  await expect(b.getByRole("button", { name: "All Money Assigned", exact: true })).toBeDisabled();
  await expect(b.getByRole("button", { name: "Assign", exact: true })).toHaveCount(0);
  // Source (live, zero state, dark theme): #3c3e53 / #9b9caa, 62px high.
  expect(await css(b, "background-color")).toBe("rgb(60, 62, 83)");
  expect(await css(b, "color")).toBe("rgb(155, 156, 170)");
  expect(Math.abs(((await b.boundingBox())?.height ?? 0) - 62)).toBeLessThanOrEqual(2);
});

test("breakdown at zero opens, and closes with Escape and an outside click", async ({ page }) => {
  await plan.inflow(100);
  await plan.assign(RENT, 100);
  await open(page);
  const trigger = box(page).getByRole("button", {
    name: "View Ready to Assign Breakdown",
    exact: true,
  });
  await realClick(page, trigger);
  const dlg = page.getByRole("dialog", { name: "Ready to Assign Breakdown", exact: true });
  await expect(dlg).toBeVisible();
  expect((await dlg.boundingBox())?.width).toBe(540);
  await expect(dlg.getByText("Total Ready to Assign", { exact: true })).toBeVisible();
  await expect(dlg.getByText("= $0.00", { exact: true })).toBeVisible();
  await expect(dlg.getByText("Nice work! Every dollar has a job.", { exact: true })).toBeVisible();
  await expect(
    dlg.getByText("Ready to Assign is money that hasn't yet been assigned to a category.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  await realClick(page, trigger);
  await expect(dlg).toBeVisible();
  await page.mouse.click(5, 400);
  await expect(dlg).toHaveCount(0);
});

test("breakdown lists the lines and its total equals the box", async ({ page }) => {
  await plan.inflow(1000);
  await plan.assign(RENT, 200);
  await plan.assign(RENT, 50, 1);
  await open(page);
  await box(page)
    .getByRole("button", { name: "View Ready to Assign Breakdown", exact: true })
    .click();
  const dlg = page.getByRole("dialog", { name: "Ready to Assign Breakdown", exact: true });
  await expect(dlg.locator(".rta-block-header.is-plus")).toHaveText("+$1,000.00");
  await expect(dlg.getByText(/^Ready to Assign left over from /)).toBeVisible();
  await expect(dlg.getByText(/^Inflow: Ready to Assign transactions in /)).toBeVisible();
  await expect(dlg.getByText("−$250.00", { exact: true })).toBeVisible();
  await expect(dlg.getByText(/^Cash overspending in /)).toBeVisible();
  await expect(dlg.getByText(/^Assigned in (?!Future)/)).toBeVisible();
  await expect(dlg.getByText("Assigned in Future", { exact: true })).toBeVisible();
  await expect(dlg.getByText("−$50.00", { exact: true })).toBeVisible();
  await expect(dlg.getByText("= +$750.00", { exact: true })).toBeVisible();
  await expect(box(page).locator(".rta-amount")).toHaveText("$750.00");
  await expect(
    dlg.getByText("Give these dollars a job by assigning them to one or more categories!", {
      exact: true,
    }),
  ).toBeVisible();
  // Nothing in the next month: no "Assigned in Future" line.
  await plan.assign(RENT, 0, 1);
  await page.reload();
  await box(page)
    .getByRole("button", { name: "View Ready to Assign Breakdown", exact: true })
    .click();
  await expect(page.getByText("Assigned in Future", { exact: true })).toHaveCount(0);
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
]) {
  test(`Assign, Manually, with a real mouse at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await plan.inflow(4270);
    await open(page);
    await realClick(page, box(page).getByRole("button", { name: "Assign", exact: true }));
    const dlg = page.getByRole("dialog", { name: "Assign", exact: true });
    await expect(dlg.getByRole("tab", { name: "Auto", exact: true })).toBeEnabled();
    await expect(dlg.getByRole("tab", { name: "Manually", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const amount = dlg.getByRole("textbox", { name: "Amount", exact: true });
    await expect(amount).toHaveValue("4,270.00");
    const ok = dlg.getByRole("button", { name: "Assign", exact: true });
    await expect(ok).toBeDisabled();
    await amount.fill("25");
    const picker = dlg.getByRole("combobox", { name: "To", exact: true });
    await realClick(page, picker);
    await page.keyboard.type("Ren");
    const rows = page.getByRole("option");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("$0.00");
    await realClick(page, rows.first());
    await expect(ok).toBeEnabled();
    await realClick(page, ok);
    await expect(box(page).locator(".rta-amount")).toHaveText("$4,245.00");
    await expect(assignedOf(page, RENT)).toHaveText("$25.00");
    // The group subtotal moved with it (Bills holds Rent).
    await expect(
      page
        .locator(".group-row", { has: page.getByText("Bills", { exact: true }) })
        .locator(".cell-assigned"),
    ).toHaveText("$25.00");
    await page.reload();
    await expect(box(page).locator(".rta-amount")).toHaveText("$4,245.00");
    await expect(assignedOf(page, RENT)).toHaveText("$25.00");
    await expect.poll(async () => (await plan.cat(RENT)).assigned).toBe(25000);
  });
}

test("the picker filters by name and group and shows Available", async ({ page }) => {
  await plan.inflow(100);
  await open(page);
  await realClick(page, box(page).getByRole("button", { name: "Assign", exact: true }));
  const picker = page
    .getByRole("dialog", { name: "Assign", exact: true })
    .getByRole("combobox", { name: "To", exact: true });
  await realClick(page, picker);
  await page.keyboard.type("wan");
  await expect(page.locator(".entry-heading")).toHaveText(["Wants"]);
  await expect(page.getByRole("option")).toHaveCount(4);
  await page.keyboard.press("Control+a");
  await page.keyboard.type("zzzzz");
  await expect(
    page.getByText("No categories found with that name.", { exact: true }),
  ).toBeVisible();
});

for (const size of [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
]) {
  test(`Fix This, viewed and later month, at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await plan.inflow(100);
    await plan.assign(RENT, 150);
    await plan.assign(GROC, 30, 1);
    await open(page);
    await realClick(page, box(page).getByRole("button", { name: "Fix This", exact: true }));
    const dlg = page.getByRole("dialog", { name: "Un-assign money from", exact: true });
    await expect(dlg.getByText("Un-assign money from", { exact: true }).first()).toBeVisible();
    const ok = dlg.getByRole("button", { name: "OK", exact: true });
    await expect(ok).toBeDisabled();
    const dd = dlg.getByRole("button", { name: "Month", exact: true });
    await realClick(page, dd);
    const options = page.getByRole("listbox", { name: "Month", exact: true }).getByRole("option");
    await expect(options).toHaveCount(2);
    await realClick(page, options.first());
    const picker = dlg.getByRole("combobox", { name: "Category", exact: true });
    await realClick(page, picker);
    await expect(page.getByRole("option")).toHaveCount(1);
    await realClick(page, page.getByRole("option").first());
    await realClick(page, ok);
    await expect(box(page).locator(".rta-amount")).toHaveText("$0.00");
    await expect(box(page)).toHaveClass(/is-zero/);
    await expect(assignedOf(page, RENT)).toHaveText("$70.00");
  });
}

test("Fix This can take the money from a later month", async ({ page }) => {
  await plan.inflow(100);
  await plan.assign(RENT, 150);
  await plan.assign(GROC, 30, 1);
  await open(page);
  await box(page).getByRole("button", { name: "Fix This", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Un-assign money from", exact: true });
  await realClick(page, dlg.getByRole("button", { name: "Month", exact: true }));
  await realClick(
    page,
    page.getByRole("listbox", { name: "Month", exact: true }).getByRole("option").nth(1),
  );
  await realClick(page, dlg.getByRole("combobox", { name: "Category", exact: true }));
  const groc = page.getByRole("option").filter({ hasText: "Groceries" });
  await expect(groc).toHaveCount(1);
  await realClick(page, groc);
  await realClick(page, dlg.getByRole("button", { name: "OK", exact: true }));
  await expect(box(page).locator(".rta-amount")).toHaveText("$0.00");
  await expect.poll(async () => (await plan.cat(GROC, 1)).assigned).toBe(-50000);
});
