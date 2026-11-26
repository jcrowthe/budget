import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { chip, fixedClock, removePlan, type Seed, SIZES, seedPlan } from "./auto-assign.fixtures";
import { expect, test } from "./fixtures";
import { assign, GROCERIES, openPlan, PHONE, RENT, UTILITIES } from "./plan-panel.fixtures";
import { authHeaders } from "./support/auth";
import { ownUser } from "./support/own-user";

// EXF-502 Plan custom views: New View, Edit View, Manage Views (docs/custom-views-design.md).

test.use({ timezoneId: "UTC" });
const { at } = fixedClock();

const BUILTINS = ["Underfunded", "Overfunded", "Money Available", "Snoozed"];

let s: Seed;
test.beforeEach(async ({ request, page }) => {
  await page.setViewportSize(SIZES[0]);
  await page.clock.setFixedTime(at);
  s = await seedPlan(request, "custom-views");
});
test.afterEach(async ({ request }) => {
  await removePlan(request, s);
});

const viewsButton = (page: Page) => page.getByRole("button", { name: "Views", exact: true });
const editor = (page: Page, title = "New Custom View") => page.getByRole("dialog", { name: title });
const manage = (page: Page) => page.getByRole("dialog", { name: "Manage Views" });
const chipNames = (page: Page) => page.locator(".view-chips .view-chip").allInnerTexts();
const cards = (page: Page) => manage(page).getByRole("listitem");
const cardNames = async (page: Page) =>
  (await cards(page).locator(".manage-view-name").allInnerTexts()).map((t) => t.trim());
const REQUIRED = "The view name is required.";

async function openMenu(page: Page, item: string) {
  await viewsButton(page).click();
  await page.getByRole("menuitem", { name: item }).click();
}
const tick = (page: Page, name: string) =>
  editor(page, "Edit Custom View").or(editor(page)).getByRole("checkbox", { name, exact: true });

async function api(
  request: APIRequestContext,
  method: "post" | "patch" | "delete" | "get",
  path: string,
  data?: unknown,
  // biome-ignore lint/suspicious/noExplicitAny: parsed JSON
): Promise<any> {
  const res = await request[method](`/api/v1/budgets/${s.id}${path}`, {
    headers: await authHeaders(),
    data,
  });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}
const makeView = async (request: APIRequestContext, name: string, cats: string[] = []) =>
  (await api(request, "post", "/views", { name, category_ids: cats.map((c) => s.cat[c]) })).body
    .data.view as { id: string };

async function drag(page: Page, from: Locator, to: Locator, half: "top" | "bottom") {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("no box");
  const sx = a.x + a.width / 2;
  const sy = a.y + a.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 10, sy + 6, { steps: 4 });
  const y = half === "top" ? b.y + 4 : b.y + b.height - 4;
  await page.mouse.move(b.x + b.width / 2, y, { steps: 12 });
  await page.mouse.move(b.x + b.width / 2, y + (half === "top" ? 1 : -1), { steps: 2 });
  await page.mouse.up();
}

test("AC1. New View: menu, required name, a selected chip after Snoozed, the empty view", async ({
  page,
}) => {
  await openPlan(page, s);
  await viewsButton(page).click();
  await expect(page.getByRole("menuitem", { name: "Manage Views" })).toBeVisible();
  await page.getByRole("menuitem", { name: "⊕ New View" }).click();
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByLabel("View Name")).toBeFocused();
  await expect(editor(page).getByLabel("View Name")).toHaveAttribute(
    "placeholder",
    "Keep 'em short & sweet!",
  );
  const save = editor(page).getByRole("button", { name: "Save" });
  await save.click();
  await expect(editor(page).getByText(REQUIRED)).toBeVisible();
  await editor(page).getByLabel("View Name").fill("   ");
  await save.click();
  await expect(editor(page).getByText(REQUIRED)).toBeVisible();
  expect(await chipNames(page)).toEqual(["All", ...BUILTINS]);

  await editor(page).getByLabel("View Name").fill("ZZ View");
  await save.click();
  await expect(editor(page)).toHaveCount(0);
  expect(await chipNames(page)).toEqual(["All", ...BUILTINS, "ZZ View"]);
  await expect(chip(page, "ZZ View")).toHaveAttribute("aria-pressed", "true");

  await expect(page.locator(".view-empty svg")).toBeVisible();
  await expect(page.getByText("There are no categories selected for ZZ View.")).toBeVisible();
  await expect(
    page.locator(".view-empty").getByRole("button", { name: "Edit View" }),
  ).toBeVisible();
  await expect(page.locator(".view-empty").getByRole("button", { name: "View All" })).toBeVisible();
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  await expect(inspector.getByText("This view has no categories.")).toBeVisible();
  await expect(inspector.getByRole("button", { name: "View All Categories" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
  await expect(chip(page, "ZZ View")).toBeVisible();
  await expect(chip(page, "All")).toHaveAttribute("aria-pressed", "true");
});

test("AC2. Edit View: prefilled, renamed, filtered rows with subtotals, hidden members kept", async ({
  page,
  request,
}) => {
  await assign(request, s, RENT, 100000);
  await assign(request, s, PHONE, 25000);
  await assign(request, s, UTILITIES, 7000);
  await makeView(request, "ZZ View");
  await openPlan(page, s);
  await chip(page, "ZZ View").click();
  await page.getByRole("button", { name: "✎ Edit View" }).click();
  await expect(editor(page, "Edit Custom View")).toBeVisible();
  await expect(editor(page, "Edit Custom View").getByLabel("View Name")).toHaveValue("ZZ View");
  await expect(tick(page, RENT)).not.toBeChecked();
  await editor(page, "Edit Custom View").getByLabel("View Name").fill("ZZ Bills");
  await tick(page, RENT).check();
  await tick(page, PHONE).check();
  await editor(page, "Edit Custom View").getByRole("button", { name: "Save" }).click();
  await expect(chip(page, "ZZ Bills")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".category-row")).toHaveCount(2);
  await expect(page.locator(".category-row", { hasText: RENT })).toBeVisible();
  await expect(page.locator(".category-row", { hasText: PHONE })).toBeVisible();
  // one group, Assigned subtotal = 1000.00 + 250.00 (milliunits 100000 + 25000 = $125.00)
  await expect(page.locator(".group-row")).toHaveCount(1);
  await expect(page.locator(".group-row .num").first()).toHaveText("$125.00");

  await page.getByRole("button", { name: "✎ Edit View" }).click();
  await tick(page, PHONE).uncheck();
  await editor(page, "Edit Custom View").getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".category-row")).toHaveCount(1);
  await expect(page.locator(".group-row .num").first()).toHaveText("$100.00");

  // a hidden member stays in the view
  await api(request, "patch", `/categories/${s.cat[RENT]}`, { hidden: true });
  await page.reload();
  await chip(page, "ZZ Bills").click();
  await expect(page.locator(".category-row")).toHaveCount(0);
  await page.getByRole("button", { name: "✎ Edit View" }).click();
  await expect(tick(page, RENT)).toHaveCount(0);
  await editor(page, "Edit Custom View").getByRole("button", { name: "Save" }).click();
  await api(request, "patch", `/categories/${s.cat[RENT]}`, { hidden: false });
  await page.reload();
  await chip(page, "ZZ Bills").click();
  await expect(page.locator(".category-row", { hasText: RENT })).toBeVisible();
});

test("AC3. Manage Views: cards, drag and keyboard reorder, edit, new, delete, Done", async ({
  page,
  request,
}) => {
  const one = await makeView(request, "ZZ One", [RENT]);
  const two = await makeView(request, "ZZ Two", [PHONE]);
  await openPlan(page, s);
  await viewsButton(page).click();
  await page.getByRole("menuitem", { name: "Manage Views" }).click();
  await expect(manage(page)).toBeVisible();
  await expect.poll(() => cardNames(page)).toEqual([...BUILTINS, "ZZ One", "ZZ Two"]);

  const handle = (name: string) => manage(page).getByLabel(`Reorder ${name}`, { exact: true });
  await drag(page, handle("ZZ Two"), cards(page).first(), "top");
  await expect.poll(() => chipNames(page)).toEqual(["All", "ZZ Two", ...BUILTINS, "ZZ One"]);
  await page.reload();
  await viewsButton(page).click();
  await page.getByRole("menuitem", { name: "Manage Views" }).click();
  await expect.poll(() => cardNames(page)).toEqual(["ZZ Two", ...BUILTINS, "ZZ One"]);

  await handle("ZZ Two").focus();
  await page.keyboard.press("Alt+Shift+ArrowDown");
  await expect
    .poll(() => cardNames(page))
    .toEqual(["Underfunded", "ZZ Two", ...BUILTINS.slice(1), "ZZ One"]);
  await expect
    .poll(() => chipNames(page))
    .toEqual(["All", "Underfunded", "ZZ Two", ...BUILTINS.slice(1), "ZZ One"]);

  // Edit stacks over Manage Views; the selected chip is unchanged
  await expect(chip(page, "All")).toHaveAttribute("aria-pressed", "true");
  await manage(page).getByRole("button", { name: "Edit ZZ One" }).click();
  await expect(editor(page, "Edit Custom View")).toBeVisible();
  await expect(manage(page)).toBeVisible();
  await editor(page, "Edit Custom View").getByLabel("View Name").fill("ZZ Uno");
  await editor(page, "Edit Custom View").getByRole("button", { name: "Save" }).click();
  await expect(editor(page, "Edit Custom View")).toHaveCount(0);
  await expect.poll(() => cardNames(page)).toContain("ZZ Uno");
  await expect(chip(page, "All")).toHaveAttribute("aria-pressed", "true");

  // New View in the footer: the new chip is selected behind the dialog
  await manage(page).getByRole("button", { name: "New View" }).click();
  await expect(editor(page)).toBeVisible();
  await editor(page).getByLabel("View Name").fill("ZZ Three");
  await editor(page).getByRole("button", { name: "Save" }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(manage(page)).toBeVisible();
  await expect.poll(() => cardNames(page)).toContain("ZZ Three");
  await expect(chip(page, "ZZ Three")).toHaveAttribute("aria-pressed", "true");

  // Delete: Cancel keeps it, Delete removes the card and the chip; deleting the selected view selects All
  const card = (name: string) => cards(page).filter({ hasText: name });
  await manage(page).getByRole("button", { name: "Delete ZZ Three" }).click();
  await expect(card("ZZ Three").getByRole("button", { name: "Cancel" })).toBeVisible();
  await card("ZZ Three").getByRole("button", { name: "Cancel" }).click();
  await expect(manage(page).getByRole("button", { name: "Delete ZZ Three" })).toBeVisible();
  await expect.poll(() => cardNames(page)).toContain("ZZ Three");
  await manage(page).getByRole("button", { name: "Delete ZZ Three" }).click();
  await card("ZZ Three").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(card("ZZ Three")).toHaveCount(0);
  await expect(chip(page, "ZZ Three")).toHaveCount(0);
  await expect(chip(page, "All")).toHaveAttribute("aria-pressed", "true");

  await manage(page).getByRole("button", { name: "Done" }).click();
  await expect(manage(page)).toHaveCount(0);
  expect(one.id).not.toBe(two.id);
});

test("AC4. built-in cards reorder only; the API refuses to edit or delete them", async ({
  page,
  request,
}) => {
  await openPlan(page, s);
  await viewsButton(page).click();
  await page.getByRole("menuitem", { name: "Manage Views" }).click();
  await expect.poll(() => cardNames(page)).toEqual(BUILTINS);
  for (const name of BUILTINS) {
    await expect(manage(page).getByLabel(`Reorder ${name}`, { exact: true })).toBeVisible();
    await expect(manage(page).getByRole("button", { name: `Edit ${name}` })).toHaveCount(0);
    await expect(manage(page).getByRole("button", { name: `Delete ${name}` })).toHaveCount(0);
  }
  await drag(
    page,
    manage(page).getByLabel("Reorder Snoozed", { exact: true }),
    cards(page).first(),
    "top",
  );
  await expect
    .poll(() => chipNames(page))
    .toEqual(["All", "Snoozed", "Underfunded", "Overfunded", "Money Available"]);
  const patch = await api(request, "patch", "/views/underfunded", { name: "x" });
  expect(patch.status).toBe(422);
  const del = await api(request, "delete", "/views/underfunded");
  expect(del.status).toBe(422);
});

test("narrow layout: a long name truncates and its title is the full name", async ({
  page,
  request,
}) => {
  await page.setViewportSize(SIZES[1]);
  const name = "ZZ A very long custom view name that must not push the row wider than it fits";
  await makeView(request, name, [GROCERIES]);
  await openPlan(page, s);
  const c = page.locator(".view-chip.is-custom");
  await expect(c).toHaveAttribute("title", name);
  const overflow = await c.evaluate((el) => {
    const n = el.querySelector(".view-chip-name") as HTMLElement;
    return {
      clipped: n.scrollWidth > n.clientWidth && getComputedStyle(n).textOverflow === "ellipsis",
      fits: el.getBoundingClientRect().right <= window.innerWidth,
    };
  });
  expect(overflow).toEqual({ clipped: true, fits: true });
});

const themed = await ownUser("custom-views");
test.describe("dialogs in both themes", () => {
  test.use({ storageState: themed.storageState });
  const setTheme = (request: APIRequestContext, theme: string) =>
    request.patch("/api/v1/settings", {
      headers: { "Cf-Access-Jwt-Assertion": themed.token },
      data: { theme },
    });
  const colours = (dlg: Locator) =>
    dlg.evaluate((el) => {
      const probe = document.createElement("i");
      probe.style.cssText = "background:var(--backgroundTertiary);color:var(--labelPrimary)";
      document.body.append(probe);
      const p = getComputedStyle(probe);
      const d = getComputedStyle(el);
      const out = {
        bg: d.backgroundColor,
        fg: getComputedStyle(el.querySelector("h2") as Element).color,
        tokenBg: p.backgroundColor,
        tokenFg: p.color,
      };
      probe.remove();
      return out;
    });

  test("Manage Views and the editor follow the theme's tokens", async ({ page, request }) => {
    const seen: Record<string, string> = {};
    for (const [theme, cls] of [
      ["dark", "theme-dark"],
      ["default", "theme-light"],
    ] as const) {
      await setTheme(request, theme);
      await openPlan(page, s);
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${cls}\\b`));
      await viewsButton(page).click();
      await page.getByRole("menuitem", { name: "Manage Views" }).click();
      const m = await colours(manage(page));
      expect(m.bg).toBe(m.tokenBg);
      await manage(page).getByRole("button", { name: "New View" }).click();
      const e = await colours(editor(page));
      expect(e.bg).toBe(e.tokenBg);
      expect(e.fg).toBe(e.tokenFg);
      seen[theme] = e.bg;
    }
    expect(seen.dark).not.toBe(seen.default);
    await setTheme(request, "dark");
  });
});
