import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { seedBulk } from "./support/bulk-seed";
import { mouseClick } from "./support/menu";
import { call, realClick } from "./support/register-seed";

// EXF-480: Edit Flags, a custom name for each flag colour of the plan.

const COLOURS = ["Red", "Orange", "Yellow", "Green", "Blue", "Purple"];

const side = (page: Page) => page.getByRole("navigation", { name: "Sidebar" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Edit Flags" });
const field = (page: Page, colour: string) =>
  dialog(page).getByRole("textbox", { name: colour, exact: true });
const flagMenu = (page: Page) => page.getByRole("menu", { name: "Flags" });
const rowOf = (page: Page, payee: string) =>
  page.locator(".register-table tbody tr[data-tx]").filter({ hasText: payee });
const names = async (request: APIRequestContext, plan: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}`)).budget.flag_names;

/** A bulk plan whose ZZ Rent row is flagged red, open on its register. */
async function open(page: Page, request: APIRequestContext) {
  const s = await seedBulk(request);
  await call(request, "PATCH", `/api/v1/budgets/${s.plan}/transactions/${s.rent}`, {
    flag_color: "red",
  });
  await page.goto(`/${s.plan}/accounts/${s.checking}`);
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  return s;
}

async function openDialog(page: Page, planName: string) {
  await mouseClick(page, side(page).getByRole("button", { name: planName, exact: true }));
  await mouseClick(page, page.getByRole("menuitem", { name: "Edit Flags", exact: true }));
  await expect(dialog(page)).toBeVisible();
}

test("AC1: Plan menu, Edit Flags opens six rows with the colour names, a close and Cancel and Done", async ({
  page,
  request,
}) => {
  const s = await open(page, request);
  await openDialog(page, s.name);
  await expect(dialog(page).getByRole("heading", { name: "Edit Flags" })).toBeVisible();
  const boxes = dialog(page).getByRole("textbox");
  await expect(boxes).toHaveCount(6);
  for (const [i, c] of COLOURS.entries()) {
    await expect(boxes.nth(i)).toHaveAccessibleName(c);
    await expect(boxes.nth(i)).toHaveValue(c);
    await expect(boxes.nth(i)).toHaveAttribute("placeholder", c);
    await expect(boxes.nth(i)).toHaveAttribute("maxlength", "50");
  }
  await expect(dialog(page).locator("svg[class*='flag-']")).toHaveCount(6);
  await expect(dialog(page).getByRole("button", { name: "Close" })).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Done" })).toBeVisible();
  // An untouched dialog stores nothing.
  await realClick(page, dialog(page).getByRole("button", { name: "Done" }));
  await expect(dialog(page)).toHaveCount(0);
  expect(Object.values(await names(request, s.plan))).toEqual(Array(6).fill(null));
});

test("AC2 and AC3: a name shows in the flag cell, both menus and the API; clearing restores the colour", async ({
  page,
  request,
}) => {
  const s = await open(page, request);
  await openDialog(page, s.name);
  await field(page, "Red").fill("  Tax  ");
  await realClick(page, dialog(page).getByRole("button", { name: "Done" }));
  await expect(dialog(page)).toHaveCount(0);
  const cell = rowOf(page, "ZZ Rent").locator("td.cell-flag button");
  await expect(cell).toHaveAttribute("title", "Tax");
  await expect(cell).toHaveAccessibleName("Tax");
  expect((await names(request, s.plan)).red).toBe("Tax");

  await realClick(page, cell);
  await expect(flagMenu(page).getByRole("menuitem").nth(1)).toHaveText("Tax");
  await page.keyboard.press("Escape");
  await realClick(
    page,
    rowOf(page, "ZZ Gas").getByRole("checkbox", { name: "Select transaction", exact: true }),
  );
  await realClick(
    page,
    page
      .getByRole("toolbar", { name: "Selection actions" })
      .getByRole("button", { name: "Flag", exact: true }),
  );
  await expect(flagMenu(page).getByRole("menuitem", { name: "Tax", exact: true })).toBeVisible();
  await expect(flagMenu(page).getByRole("menuitem", { name: "Red", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await openDialog(page, s.name);
  await expect(field(page, "Red")).toHaveValue("Tax");
  await field(page, "Red").fill("");
  await realClick(page, dialog(page).getByRole("button", { name: "Done" }));
  await expect(dialog(page)).toHaveCount(0);
  await expect(cell).toHaveAccessibleName("Red");
  expect((await names(request, s.plan)).red).toBeNull();
});

test("AC4: a name is cut at 50 characters", async ({ page, request }) => {
  const s = await open(page, request);
  await openDialog(page, s.name);
  await field(page, "Blue").fill("x".repeat(60));
  await expect(field(page, "Blue")).toHaveValue("x".repeat(50));
});

for (const how of ["Cancel", "Close", "Escape"] as const) {
  test(`AC5: ${how} discards the edit`, async ({ page, request }) => {
    const s = await open(page, request);
    await call(request, "PATCH", `/api/v1/budgets/${s.plan}`, { flag_names: { red: "Tax" } });
    await page.reload();
    await expect(rowOf(page, "ZZ Fee")).toBeVisible();
    await openDialog(page, s.name);
    await field(page, "Red").fill("Nope");
    if (how === "Escape") await page.keyboard.press("Escape");
    else await realClick(page, dialog(page).getByRole("button", { name: how }));
    await expect(dialog(page)).toHaveCount(0);
    expect((await names(request, s.plan)).red).toBe("Tax");
    await openDialog(page, s.name);
    await expect(field(page, "Red")).toHaveValue("Tax");
  });
}

test("the flag menu's Edit Flags footer opens the same dialog", async ({ page, request }) => {
  const s = await open(page, request);
  await realClick(page, rowOf(page, "ZZ Rent").locator("td.cell-flag button"));
  const edit = flagMenu(page).getByRole("menuitem", { name: "Edit Flags", exact: true });
  await expect(edit).not.toHaveAttribute("aria-disabled", "true");
  await realClick(page, edit);
  await expect(dialog(page)).toBeVisible();
  await expect(flagMenu(page)).toHaveCount(0);
  expect(s.plan).toBeTruthy();
});

test("the register search suggests the plan's flag name", async ({ page, request }) => {
  const s = await open(page, request);
  await call(request, "PATCH", `/api/v1/budgets/${s.plan}`, { flag_names: { red: "Tax" } });
  await page.reload();
  await expect(rowOf(page, "ZZ Fee")).toBeVisible();
  const search = page.getByLabel("Find the transactions you're looking for...");
  await search.fill("flag");
  await expect(page.getByRole("option").filter({ hasText: "Flag: Tax" }).first()).toBeVisible();
});
