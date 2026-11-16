import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openPlan, RENT, removePlan, row, type Seed, seedPlan, TODAY } from "./plan-panel.fixtures";
import { authHeaders } from "./support/auth";
import {
  card,
  entryDate,
  expectTopmost,
  firstOfMonth,
  form,
  MONTHLY,
  money,
  monthName,
  putTarget,
  readCategory,
  realClick,
  utcToday,
} from "./targets.fixtures";

test.use({ timezoneId: "UTC" });

let s: Seed;
let t0 = 0;
let today = "";
test.beforeEach(async ({ request, page }) => {
  t0 = Date.now();
  today = utcToday(t0);
  await page.clock.setFixedTime(t0);
  s = await seedPlan(request, "target-form");
});
test.afterEach(async ({ request }) => {
  await removePlan(request, s);
});

const nextFirst = () => firstOfMonth(today, 1);
const selectRent = async (page: Page) => {
  await openPlan(page, s);
  await page.locator(".category-name", { hasText: RENT }).click();
  await expect(card(page)).toBeVisible();
};
const openForm = async (page: Page) => {
  await selectRent(page);
  await realClick(page, card(page).getByRole("button", { name: "Create Target" }));
  await expect(form(page)).toBeVisible();
};
const tab = (page: Page, name: string) => form(page).getByRole("tab", { name, exact: true });
const amount = (page: Page) => form(page).getByRole("textbox", { name: "Target Amount" });
const dropdown = (page: Page) =>
  form(page).getByRole("button", { name: /^(Next (month|year) I want to|I want to)/ });
const labels = (page: Page) => form(page).locator("dt").allTextContents();
const type = async (page: Page, text: string) => {
  await amount(page).fill(text);
  await amount(page).press("Tab");
};
/** The target as the API holds it, polled until it shows (a click that writes answers later). */
const stored = (request: Parameters<typeof readCategory>[0], category = RENT) =>
  expect.poll(
    async () =>
      (await readCategory(request, s, category, TODAY, today))?.target?.definition ?? null,
    {
      timeout: 10_000,
    },
  );

test("the empty card and the form's defaults", async ({ page }) => {
  await selectRent(page);
  await expect(card(page).getByRole("button", { name: "Target", exact: true })).toBeVisible();
  await expect(card(page).locator("strong")).toHaveText(`How much do you need for ${RENT}?`);
  await expect(card(page)).toContainText(
    "When you create a target, we’ll let you know how much money to set aside to stay on track over time.",
  );
  await realClick(page, card(page).getByRole("button", { name: "Create Target" }));
  await expect(tab(page, "Monthly")).toHaveAttribute("aria-selected", "true");
  await expect(amount(page)).toBeFocused();
  await expect(amount(page)).toHaveValue("");
  const by = form(page).getByLabel("Select Day of Month");
  await expect(by).toHaveValue("");
  await expect(by.locator("option:checked")).toHaveText("Last Day of Month");
  await expect(dropdown(page)).toContainText("Set aside another $0.00");
  await amount(page).press("Tab");
  await expect(amount(page)).toHaveValue("$0.00");
  for (const name of ["Delete", "Cancel", "Save Target"]) {
    await expect(form(page).getByRole("button", { name, exact: true })).toBeVisible();
  }
});

test("each tab: fields, labels, options, defaults, and the live dropdown", async ({ page }) => {
  await openForm(page);
  expect(await labels(page)).toEqual(["I need", "By", "Next month I want to"]);
  await type(page, "100");
  await expect(dropdown(page)).toContainText("Set aside another $100.00");

  await realClick(page, tab(page, "Weekly"));
  expect(await labels(page)).toEqual(["I need", "Every", "Next month I want to"]);
  const weekday = form(page).getByLabel("Select Day of Week");
  await expect(weekday.locator("option:checked")).toHaveText("Saturday");
  await expect(weekday.locator("option")).toHaveText([
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ]);
  await expect(amount(page)).toHaveValue("$100.00"); // the amount survives a tab switch
  await expect(dropdown(page)).toContainText("Set aside another $100.00/week");
  await realClick(page, dropdown(page));
  const list = page.getByRole("listbox");
  await expect(list.getByRole("option")).toHaveCount(2);
  await expect(list).toContainText("Most people choose this");
  await expect(list).toContainText(
    "Sets a Target to have $100.00/week on hand each month. Whatever you don't spend will get applied towards next month.",
  );
  await page.keyboard.press("Escape"); // closes only the dropdown
  await expect(list).toHaveCount(0);
  await expect(form(page)).toBeVisible();

  await realClick(page, tab(page, "Monthly"));
  const days = form(page).getByLabel("Select Day of Month").locator("option");
  await expect(days).toHaveCount(32);
  await expect(days.nth(0)).toHaveText("Last Day of Month");
  await expect(days.nth(1)).toHaveText("31st");
  await expect(days.nth(31)).toHaveText("1st");
  await realClick(page, dropdown(page));
  await expect(page.getByRole("listbox")).toContainText(
    "Sets a Target to have $100.00 on hand each month. Whatever you don't spend will get applied toward next month's $100.00.",
  );
  await page.getByRole("option", { name: /Refill up to \$100\.00/ }).click();
  await expect(dropdown(page)).toContainText("Refill up to $100.00");

  await realClick(page, tab(page, "Yearly"));
  expect(await labels(page)).toEqual(["I need", "By", "Next year I want to"]);
  await expect(form(page).getByRole("textbox", { name: "By" })).toHaveValue(entryDate(nextFirst()));
  await expect(dropdown(page)).toContainText("Refill up to $100.00"); // the choice is kept across tabs
  await realClick(page, dropdown(page));
  await expect(page.getByRole("listbox")).toContainText(
    "Sets a Target to have $100.00 on hand each year. Whatever you don't spend will get applied toward next year's $100.00.",
  );
  await page.keyboard.press("Escape");

  await realClick(page, tab(page, "Custom"));
  expect(await labels(page)).toEqual(["Amount", "I want to", "Due on"]);
  await expect(dropdown(page)).toContainText("Set aside $100.00");
  await expect(form(page).getByRole("textbox", { name: "Due on" })).toHaveValue(
    entryDate(nextFirst()),
  );
  await expect(form(page).getByRole("switch", { name: "Repeat" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await realClick(page, dropdown(page));
  const custom = page.getByRole("option");
  await expect(custom).toHaveCount(3);
  await expect(custom.nth(2)).toContainText("Have a balance of $100.00");
  await expect(custom.nth(2)).toContainText("Use for: long-term savings");
  await expect(custom.nth(2)).toContainText(
    "Reach this amount by a specific time and refrain from spending until you reach it.",
  );
  await expect(custom.nth(0)).toContainText(
    "Add $100.00 to this category, regardless of its current balance.",
  );
  await expect(custom.nth(1)).toContainText(
    "Use what is already in this category and fill it up to $100.00.",
  );
  await custom.nth(2).click();

  // Have a balance: no date until "Due by date" is on.
  await expect(form(page).getByRole("textbox", { name: "Due on" })).toHaveCount(0);
  await expect(form(page).getByRole("switch", { name: "Repeat" })).toHaveCount(0);
  const dueBy = form(page).getByRole("switch", { name: "Due by date" });
  await expect(dueBy).toHaveAttribute("aria-checked", "false");
  await realClick(page, dueBy);
  const month = form(page).getByLabel("Select Month");
  const year = form(page).getByLabel("Select Year");
  const next = nextFirst();
  await expect(month.locator("option:checked")).toHaveText(monthName(next));
  await expect(year).toHaveValue(next.slice(0, 4));
  await expect(year.locator("option")).toHaveCount(50);
  await expect(year.locator("option").first()).toHaveText(today.slice(0, 4));

  // Set aside + Repeat: "Every [1] [Month]"; 3 makes the units plural.
  await realClick(page, dropdown(page));
  await page.getByRole("option", { name: /^Set aside \$100\.00/ }).click();
  await realClick(page, form(page).getByRole("switch", { name: "Repeat" }));
  const interval = form(page).getByLabel("Select Interval");
  const unit = form(page).getByLabel("Select Unit of Time");
  await expect(interval).toHaveValue("1");
  await expect(unit.locator("option")).toHaveText(["Month", "Year"]);
  await interval.selectOption("3");
  await expect(unit.locator("option")).toHaveText(["Months", "Years"]);
  await expect(interval.locator("option")).toHaveCount(11);
});

test("Save, reload and Edit Target for each kind", async ({ page, request }) => {
  await openForm(page);
  // Monthly refill by the 10th.
  await type(page, "100");
  await form(page).getByLabel("Select Day of Month").selectOption("10");
  await realClick(page, dropdown(page));
  await page.getByRole("option", { name: /Refill up to/ }).click();
  await realClick(page, form(page).getByRole("button", { name: "Save Target" }));
  await stored(request).toMatchObject({
    cadence: "monthly",
    behavior: "refill",
    amount: 100000,
    day_of_month: 10,
  });
  await page.reload();
  await page.locator(".category-name", { hasText: RENT }).click();
  await expect(
    card(page).getByRole("heading", { name: "Refill Up to $100.00 Each Month" }),
  ).toBeVisible();
  await expect(card(page)).toContainText("By the 10th of the Month");
  await realClick(page, card(page).getByRole("button", { name: "Edit Target" }));
  await expect(tab(page, "Monthly")).toHaveAttribute("aria-selected", "true");
  await expect(form(page).getByLabel("Select Day of Month").locator("option:checked")).toHaveText(
    "10th",
  );
  await expect(dropdown(page)).toContainText("Refill up to $100.00");
  await expect(amount(page)).toHaveValue(/^\$?100\.00$/); // focused on open: the raw text

  // Edit to Yearly, the date picked in the calendar.
  await realClick(page, tab(page, "Yearly"));
  await amount(page).fill("1200");
  await expect(amount(page)).toHaveValue("1200");
  await amount(page).press("Tab");
  await expect(amount(page)).toHaveValue("$1,200.00");
  await realClick(page, form(page).getByRole("textbox", { name: "By" }));
  const cal = page.getByRole("dialog", { name: "Calendar" });
  await expect(cal).toBeVisible();
  const pick = `${nextFirst().slice(0, 8)}15`;
  await realClick(page, cal.getByRole("button", { name: pick, exact: true }));
  await expect(form(page).getByRole("textbox", { name: "By" })).toHaveValue(entryDate(pick));
  await realClick(page, dropdown(page));
  await page.getByRole("option", { name: /Set aside another/ }).click();
  await realClick(page, form(page).getByRole("button", { name: "Save Target" }));
  await stored(request).toMatchObject({
    cadence: "yearly",
    behavior: "set_aside",
    amount: 1200000,
    due_date: pick,
    day_of_month: null,
  });
  await expect(
    card(page).getByRole("heading", { name: "Set Aside Another $1,200.00 Each Year" }),
  ).toBeVisible();
  await realClick(page, card(page).getByRole("button", { name: "Edit Target" }));
  await expect(tab(page, "Yearly")).toHaveAttribute("aria-selected", "true");
  await expect(form(page).getByRole("textbox", { name: "By" })).toHaveValue(entryDate(pick));

  // Custom, repeating every 3 months.
  await realClick(page, tab(page, "Custom"));
  await type(page, "90");
  await realClick(page, form(page).getByRole("switch", { name: "Repeat" }));
  await form(page).getByLabel("Select Interval").selectOption("3");
  await realClick(page, form(page).getByRole("button", { name: "Save Target" }));
  await stored(request).toMatchObject({
    cadence: "custom",
    behavior: "set_aside",
    amount: 90000,
    repeat: { every: 3, unit: "month" },
  });
  await expect(
    card(page).getByRole("heading", { name: "Set Aside Another $90.00 Every 3 Months" }),
  ).toBeVisible();
  await realClick(page, card(page).getByRole("button", { name: "Edit Target" }));
  await expect(form(page).getByRole("switch", { name: "Repeat" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(form(page).getByLabel("Select Interval")).toHaveValue("3");

  // Custom balance with a due month.
  await realClick(page, dropdown(page));
  await page.getByRole("option", { name: /^Have a balance of/ }).click();
  await type(page, "600");
  await realClick(page, form(page).getByRole("switch", { name: "Due by date" }));
  const due = firstOfMonth(today, 3);
  await form(page)
    .getByLabel("Select Month")
    .selectOption(String(Number(due.slice(5, 7)) - 1));
  await form(page).getByLabel("Select Year").selectOption(due.slice(0, 4));
  await realClick(page, form(page).getByRole("button", { name: "Save Target" }));
  await stored(request).toMatchObject({
    cadence: "custom",
    behavior: "balance",
    amount: 600000,
    due_month: due,
    repeat: null,
    due_date: null,
  });
  await realClick(page, card(page).getByRole("button", { name: "Edit Target" }));
  await expect(form(page).getByRole("switch", { name: "Due by date" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(form(page).getByLabel("Select Month").locator("option:checked")).toHaveText(
    monthName(due),
  );
  await realClick(page, form(page).getByRole("button", { name: "Cancel" }));
  await expect(card(page).getByRole("button", { name: "Edit Target" })).toBeVisible();
});

test("a bad amount is refused at the form, Cancel discards, another selection discards", async ({
  page,
}) => {
  await openForm(page);
  await realClick(page, form(page).getByRole("button", { name: "Save Target" }));
  await expect(form(page).getByRole("alert")).toHaveText("Enter an amount greater than $0.00.");
  await type(page, "50+25");
  await expect(amount(page)).toHaveValue("$75.00");
  await realClick(page, form(page).getByRole("button", { name: "Cancel" }));
  await expect(card(page).getByRole("button", { name: "Create Target" })).toBeVisible();
  await realClick(page, card(page).getByRole("button", { name: "Create Target" }));
  await expect(amount(page)).toHaveValue("");
  await page.locator(".category-name", { hasText: "Phone" }).click();
  await expect(form(page)).toHaveCount(0);
  await expect(card(page).getByRole("button", { name: "Create Target" })).toBeVisible();
});

test("Edit Target, then Save with nothing changed closes the form", async ({ page, request }) => {
  await putTarget(request, s, RENT, MONTHLY, today);
  await openPlan(page, s);
  await page.locator(".category-name", { hasText: RENT }).click();
  await realClick(page, card(page).getByRole("button", { name: "Edit Target" }));
  await realClick(page, form(page).getByRole("button", { name: "Save Target" }));
  await expect(form(page)).toHaveCount(0);
  await expect(card(page).getByRole("button", { name: "Edit Target" })).toBeVisible();
});

test("Delete removes the target at once and leaves the amounts alone", async ({
  page,
  request,
}) => {
  await putTarget(request, s, RENT, MONTHLY, today);
  await request.patch(`/api/v1/budgets/${s.id}/months/${TODAY}/categories/${s.cat[RENT]}`, {
    headers: await authHeaders(),
    data: { assigned: 40000 },
  });
  await openPlan(page, s);
  await expect(row(page, RENT).locator(".status-label")).toContainText("more needed");
  await page.locator(".category-name", { hasText: RENT }).click();
  await realClick(page, card(page).getByRole("button", { name: "Edit Target" }));
  await realClick(page, form(page).getByRole("button", { name: "Delete" }));
  await expect(card(page).getByRole("button", { name: "Create Target" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0); // no confirmation
  await expect(row(page, RENT).locator(".status-label")).toHaveCount(0);
  await expect
    .poll(async () => (await readCategory(request, s, RENT, TODAY, today)).target)
    .toBeNull();
  const c = await readCategory(request, s, RENT, TODAY, today);
  expect([c.assigned, c.available]).toEqual([40000, 40000]);
  await expect(row(page, RENT).locator(".available-pill")).toHaveText(money(40000));
});

test("at 1024 by 700 every control can be reached and Save works", async ({ page, request }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await openForm(page);
  for (const name of ["Weekly", "Monthly", "Yearly", "Custom"]) {
    await expectTopmost(tab(page, name));
  }
  await expectTopmost(amount(page));
  await expectTopmost(form(page).getByLabel("Select Day of Month"));
  await expectTopmost(dropdown(page));
  await realClick(page, tab(page, "Custom"));
  await expectTopmost(form(page).getByRole("textbox", { name: "Due on" }));
  await expectTopmost(form(page).getByRole("switch", { name: "Repeat" }));
  await realClick(page, form(page).getByRole("switch", { name: "Repeat" }));
  await expectTopmost(form(page).getByLabel("Select Interval"));
  await expectTopmost(form(page).getByLabel("Select Unit of Time"));
  await realClick(page, dropdown(page));
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options).toHaveCount(3);
  for (const o of await options.all()) await expectTopmost(o);
  await page.getByRole("option", { name: /^Have a balance of/ }).click();
  await expectTopmost(form(page).getByRole("switch", { name: "Due by date" }));
  await realClick(page, tab(page, "Monthly"));
  for (const name of ["Delete", "Cancel", "Save Target"]) {
    await expectTopmost(form(page).getByRole("button", { name, exact: true }));
  }
  await type(page, "100");
  await realClick(page, form(page).getByRole("button", { name: "Save Target" }));
  await stored(request).toMatchObject({ cadence: "monthly", amount: 100000 });
});
