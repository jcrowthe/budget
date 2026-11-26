import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders } from "./support/auth";
import { expectContrast } from "./support/contrast";
import { realClick } from "./support/real-click";
import { call, MONTH, seedWorked } from "./support/register-seed";

// EXF-589: one category picker for the Plan page and the register. The same body runs in the Move popover and in
// the entry row, so a difference between the two shows up as a failure in one of them.

type Seed = Awaited<ReturnType<typeof seedWorked>> & { source: string; spare: string };

let s: Seed;

test.beforeEach(async ({ request }) => {
  const w = await seedWorked(request);
  // A second group, so Move has a source outside "D4 Fun Group" (Move leaves its own source out of the list).
  const group = (
    await call(request, "POST", `/api/v1/budgets/${w.plan}/category_groups`, {
      name: "D4 Other Group",
    })
  ).category_group.id as string;
  const make = async (name: string, assigned: number) => {
    const id = (
      await call(request, "POST", `/api/v1/budgets/${w.plan}/categories`, {
        group_id: group,
        name,
      })
    ).category.id as string;
    await call(request, "PATCH", `/api/v1/budgets/${w.plan}/months/${MONTH}/categories/${id}`, {
      assigned,
    });
    return id;
  };
  s = { ...w, source: await make("D4 Source", 50000), spare: await make("D4 Spare", 20000) };
});
test.afterEach(async ({ request }) => {
  await request.delete(`/api/v1/budgets/${s.plan}`, { headers: await authHeaders() });
});

type Place = {
  name: "Move popover" | "entry row";
  open: (page: Page) => Promise<Locator>;
  shown: (name: string) => string;
};

const places: Place[] = [
  {
    name: "Move popover",
    open: async (page) => {
      await page.goto(`/${s.plan}/budget`);
      await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
      const row = page.locator(".category-row", {
        has: page.getByText("D4 Source", { exact: true }),
      });
      await realClick(page, row.locator(".available-pill"));
      const dlg = page.getByRole("dialog", { name: "Move money", exact: true });
      return dlg.getByRole("combobox", { name: "To", exact: true });
    },
    shown: (name) => name,
  },
  {
    name: "entry row",
    open: async (page) => {
      await page.goto(`/${s.plan}/accounts/${s.checking}`);
      await page.getByRole("button", { name: "Add Transaction", exact: true }).click();
      return page.getByRole("combobox", { name: "Category", exact: true });
    },
    shown: (name) => `D4 Fun Group: ${name}`,
  },
];

const list = (page: Page) => page.getByRole("listbox", { name: "Categories", exact: true });
const options = (page: Page) => page.getByRole("option");
const retype = async (page: Page, field: Locator, text: string) => {
  await realClick(page, field);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
};
const names = async (page: Page) =>
  (await options(page).all()).map((o) => o.getAttribute("aria-label"));

for (const place of places) {
  test(`${place.name}: search, highlight, Enter, Tab, arrows, empty text and mouse`, async ({
    page,
  }) => {
    const field = await place.open(page);

    // 1. A real click opens the list.
    await realClick(page, field);
    await expect(list(page)).toBeVisible();

    // 2. A group name lists its three categories; the first is highlighted.
    await page.keyboard.type("d4 fun gr");
    await expect(options(page)).toHaveCount(3);
    const order = await Promise.all(await names(page));
    expect([...order].sort()).toEqual(["D4 Dining", "D4 Fun", "D4 Groceries"]);
    await expect(options(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "false");
    await expect(options(page).nth(2)).toHaveAttribute("aria-selected", "false");
    const id = await options(page).nth(0).getAttribute("id");
    expect(id).toBeTruthy();
    await expect(field).toHaveAttribute("aria-activedescendant", id as string);

    // 3. Enter picks it.
    await page.keyboard.press("Enter");
    await expect(field).toHaveValue(place.shown(order[0] as string));
    await expect(list(page)).toHaveCount(0);

    // 4. A category name: first match highlighted, Tab picks it.
    await retype(page, field, "groc");
    await expect(options(page).first()).toHaveAttribute("aria-label", "D4 Groceries");
    await expect(options(page).first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Tab");
    await expect(field).toHaveValue(place.shown("D4 Groceries"));
    await expect(list(page)).toHaveCount(0);

    // 5. Arrows stop at the ends (no wrap).
    await retype(page, field, "d4 fun gr");
    await expect(options(page)).toHaveCount(3);
    await page.keyboard.press("ArrowUp");
    await expect(options(page).nth(0)).toHaveAttribute("aria-selected", "true");
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowDown");
    await expect(options(page).nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(options(page).nth(0)).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press("ArrowUp");
    await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(field).toHaveValue(place.shown(order[1] as string));

    // 6. Nothing matches.
    await retype(page, field, "zzzz");
    await expect(
      page.getByText("No categories found with that name.", { exact: true }),
    ).toBeVisible();
    await expect(options(page)).toHaveCount(0);

    // 7. Mouse: hovering moves the one highlight; a real click picks.
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await expect(options(page).nth(1)).toBeVisible();
    const second = options(page).nth(1);
    const label = (await second.getAttribute("aria-label")) as string;
    await second.scrollIntoViewIfNeeded();
    const box = (await second.boundingBox()) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(second).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
    await realClick(page, second);
    await expect(list(page)).toHaveCount(0);
    await expect(field).toHaveValue(new RegExp(`${label}$`));

    // 8. Move only: Escape closes the list first, then the popover.
    if (place.name === "Move popover") {
      await realClick(page, field);
      await expect(list(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(list(page)).toHaveCount(0);
      const dlg = page.getByRole("dialog", { name: "Move money", exact: true });
      await expect(dlg).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dlg).toHaveCount(0);
    }
  });
}

async function theme(page: Page, which: "dark" | "light") {
  await page.evaluate((w) => {
    const root = document.documentElement;
    root.classList.remove("theme-dark", "theme-light");
    root.classList.add(`theme-${w}`);
    document.body.classList.toggle("theme-dark", w === "dark");
  }, which);
}

test("light theme: both pickers read in dark and in light", async ({ page }, testInfo) => {
  for (const place of places) {
    for (const which of ["dark", "light"] as const) {
      const field = await place.open(page);
      await theme(page, which);
      await realClick(page, field);
      await expect(list(page)).toBeVisible();
      await expect(options(page).first()).toBeVisible();
      const body = list(page);
      const pill = (tone: string) => body.locator(`.entry-available.${tone}`).first();
      await expectContrast(body.locator(".entry-option-name").first());
      await expectContrast(body.locator(".entry-heading").first());
      await expectContrast(pill("positive"));
      await expectContrast(pill("negative"));
      await expectContrast(pill("zero"));
      await page.screenshot({
        path: testInfo.outputPath(`${place.name.replace(" ", "-")}-${which}.png`),
      });
    }
  }
});
