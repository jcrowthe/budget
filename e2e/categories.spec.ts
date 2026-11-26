import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const ISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;

type Req = import("@playwright/test").APIRequestContext;
let planId = "";

test.beforeEach(async ({ request }: { request: Req }) => {
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: testName("cats") },
  });
  planId = (await res.json()).data.budget.id;
});
test.afterEach(async ({ request }: { request: Req }) => {
  await request.delete(`/api/v1/budgets/${planId}`, {
    headers: await authHeaders(),
  });
});

const RENT = "🏠 Rent/Mortgage";
const GROCERIES = "🛒 Groceries";
const UTILITIES = "⚡️ Utilities";
const ENTERTAINMENT = "🍿 Entertainment";
const VACATION = "🏝️ Vacation";

const open = async (page: Page, path = "budget") => {
  await page.goto(`/${planId}/${path}`);
  await expect(page.getByRole("treegrid", { name: "Plan" })).toBeVisible();
};
const catRow = (page: Page, name: string) =>
  page.locator(".category-row", { has: page.getByText(name, { exact: true }) });
const groupRow = (page: Page, name: string) =>
  page.locator(".group-row", { has: page.getByText(name, { exact: true }) });
const names = (page: Page) => page.locator(".category-row .category-name");
const popover = (page: Page, name: string) => page.getByRole("dialog", { name });

type Month = {
  ready_to_assign: number;
  groups: {
    id: string;
    name: string;
    categories: {
      id: string;
      name: string;
      assigned: number;
      hidden: boolean;
    }[];
  }[];
};
async function month(request: Req): Promise<Month> {
  const res = await request.get(`/api/v1/budgets/${planId}/months/${ISO}`, {
    headers: await authHeaders(),
  });
  return (await res.json()).data;
}
const catId = (m: Month, name: string) =>
  m.groups.flatMap((g) => g.categories).find((c) => c.name === name)?.id ?? "";
async function assign(request: Req, name: string, assigned: number) {
  const id = catId(await month(request), name);
  const res = await request.patch(`/api/v1/budgets/${planId}/months/${ISO}/categories/${id}`, {
    headers: await authHeaders(),
    data: { assigned },
  });
  expect(res.ok()).toBe(true);
}
const width = async (loc: Locator) => (await loc.boundingBox())?.width ?? 0;

test("add a group: required message, then it is the first group", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Category Group" }).click();
  const pop = popover(page, "Add Category Group");
  const field = pop.getByPlaceholder("New Category Group");
  await expect(field).toBeFocused();
  // Measured on the source's Category Group popover: 224px wide (docs/categories-design.md, Test Budget Plan page).
  expect(await width(pop)).toBeCloseTo(224, 0);
  await pop.getByRole("button", { name: "OK" }).click();
  await expect(pop.getByText("The group name is required.")).toBeVisible();
  await field.fill("ZZ Group");
  await field.press("Enter");
  await expect(pop).toHaveCount(0);
  await expect(page.locator(".group-name")).toHaveText(["ZZ Group", "Bills", "Needs", "Wants"]);
  await page.reload();
  await expect(page.locator(".group-name").first()).toHaveText("ZZ Group");
});

test("add a category at the top of its group; a duplicate is refused", async ({ page }) => {
  await open(page);
  const bills = groupRow(page, "Bills");
  await bills.hover();
  await bills.getByRole("button", { name: "Add Category" }).click();
  const pop = popover(page, "Add Category");
  await expect(pop.getByPlaceholder("New Category")).toBeFocused();
  await pop.getByPlaceholder("New Category").fill("ZZ Cat");
  await pop.getByRole("button", { name: "OK" }).click();
  await expect(pop).toHaveCount(0);
  await expect(names(page).first()).toHaveText("ZZ Cat");
  await bills.hover();
  await bills.getByRole("button", { name: "Add Category" }).click();
  await pop.getByPlaceholder("New Category").fill("zz cat ");
  await pop.getByRole("button", { name: "OK" }).click();
  await expect(
    pop.getByText("A category with this name already exists in this group"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".category-name", { hasText: "ZZ Cat" })).toHaveCount(1);
});

test("rename a category and a group, with the messages", async ({ page }) => {
  await open(page);
  await page.locator(".category-name", { hasText: RENT }).click({ button: "right" });
  const pop = popover(page, "Edit Category");
  const field = pop.getByPlaceholder("Enter category name");
  await expect(field).toHaveValue(RENT);
  await expect(field).toBeFocused();
  // Measured on the source's category edit popover: 400px wide (docs/categories-design.md, Test Budget Plan page).
  expect(await width(pop)).toBeCloseTo(400, 0);
  await expect(pop.getByRole("button", { name: "Hide" })).toBeVisible();
  await expect(pop.getByRole("button", { name: "Delete" })).toBeVisible();
  await field.fill("");
  await pop.getByRole("button", { name: "OK" }).click();
  await expect(pop.getByText("The category name is required.")).toBeVisible();
  await field.fill("D1 Rent 🏡");
  await field.press("Enter");
  await expect(pop).toHaveCount(0);
  await expect(page.locator(".category-name").first()).toHaveText("D1 Rent 🏡");

  await page.locator(".group-name", { hasText: "Needs" }).click();
  const gp = popover(page, "Edit Category Group");
  await gp.getByPlaceholder("Enter category name").fill("bills");
  await gp.getByRole("button", { name: "OK" }).click();
  await expect(gp.getByText("This group name already exists")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".group-name")).toHaveText(["Bills", "Needs", "Wants"]);
});

test("right-click on a category opens the edit popover", async ({ page }) => {
  await open(page);
  await catRow(page, GROCERIES).locator(".cell-name").click({ button: "right" });
  const pop = popover(page, "Edit Category");
  await expect(pop.getByPlaceholder("Enter category name")).toHaveValue(GROCERIES);
});

test("delete an unused category or group at once, logged with the actor", async ({
  page,
  request,
}) => {
  await open(page);
  await page.locator(".category-name", { hasText: UTILITIES }).click({ button: "right" });
  await popover(page, "Edit Category").getByRole("button", { name: "Delete" }).click();
  await expect(popover(page, "Edit Category")).toHaveCount(0);
  await expect(page.locator(".category-name", { hasText: UTILITIES })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Delete Category" })).toHaveCount(0);

  await page.getByRole("button", { name: "Category Group" }).click();
  await popover(page, "Add Category Group").getByPlaceholder("New Category Group").fill("ZZ Empty");
  await page.keyboard.press("Enter");
  const row = groupRow(page, "ZZ Empty");
  await row.hover();
  await row.getByRole("button", { name: "Add Category" }).click();
  await popover(page, "Add Category").getByPlaceholder("New Category").fill("ZZ One");
  await page.keyboard.press("Enter");
  await expect(page.locator(".category-name", { hasText: "ZZ One" })).toBeVisible();
  await page.locator(".group-name", { hasText: "ZZ Empty" }).click();
  await popover(page, "Edit Category Group").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".group-name", { hasText: "ZZ Empty" })).toHaveCount(0);
  await expect(page.locator(".category-name", { hasText: "ZZ One" })).toHaveCount(0);
  const m = await month(request);
  expect(m.groups.map((g) => g.name)).toEqual(["Bills", "Needs", "Wants"]);
});

test("delete a category with history: pick a target, Ready to Assign holds", async ({
  page,
  request,
}) => {
  await assign(request, ENTERTAINMENT, 20000);
  const before = (await month(request)).ready_to_assign;
  await open(page);
  await page.locator(".category-name", { hasText: ENTERTAINMENT }).click({ button: "right" });
  await popover(page, "Edit Category").getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Category" });
  await expect(dialog.getByText("you'll need to reassign your past activity")).toBeVisible();
  await expect(dialog.getByText("All assigned amounts")).toBeVisible();
  await expect(dialog.getByText("Any remaining available amount")).toBeVisible();
  const del = dialog.getByRole("button", { name: "Delete" });
  await expect(del).toBeDisabled();
  const picker = dialog.getByRole("combobox", { name: "Select category" });
  await picker.fill("vacat");
  await expect(page.getByRole("listbox", { name: "Categories" })).toBeVisible();
  // The deleted category is not offered.
  await expect(page.getByRole("option", { name: new RegExp(ENTERTAINMENT) })).toHaveCount(0);
  await page.getByRole("option", { name: new RegExp(VACATION) }).click();
  await expect(del).toBeEnabled();
  await del.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".category-name", { hasText: ENTERTAINMENT })).toHaveCount(0);
  await expect(catRow(page, VACATION).locator(".assigned-box .amount")).toHaveText("$20.00");
  expect((await month(request)).ready_to_assign).toBe(before);
});

test("Escape closes the picker list first, then the dialog", async ({ page, request }) => {
  await assign(request, ENTERTAINMENT, 1000);
  await open(page);
  await page.locator(".category-name", { hasText: ENTERTAINMENT }).click({ button: "right" });
  await popover(page, "Edit Category").getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Category" });
  await expect(page.getByRole("listbox", { name: "Categories" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "Categories" })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".category-name", { hasText: ENTERTAINMENT })).toBeVisible();
});

test("delete a group with history reassigns every category", async ({ page, request }) => {
  await assign(request, ENTERTAINMENT, 5000);
  await open(page);
  await page.locator(".group-name", { hasText: "Wants" }).click();
  await popover(page, "Edit Category Group").getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Category Group" });
  await expect(
    dialog.getByText("categories in the group Wants will be reassigned to the selected category."),
  ).toBeVisible();
  const picker = dialog.getByRole("combobox", { name: "Select category" });
  await picker.fill("Groceries");
  await expect(page.getByRole("option", { name: new RegExp(VACATION) })).toHaveCount(0);
  await page.getByRole("option", { name: new RegExp(GROCERIES) }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".group-name")).toHaveText(["Bills", "Needs"]);
  await expect(catRow(page, GROCERIES).locator(".assigned-box .amount")).toHaveText("$5.00");
});

test("collapse is saved on the server: a fresh browser profile sees it, no storage key", async ({
  page,
  browser,
  context,
  baseURL,
  request,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Collapse Bills categories" }).click();
  await expect(page.getByRole("button", { name: "Expand Bills categories" })).toBeVisible();
  await expect
    .poll(async () => (await month(request)).groups.length > 0 && (await collapsedNames(request)))
    .toEqual(["Bills"]);

  // Only the auth cookie: no localStorage, so what shows comes from the server.
  const fresh = await browser.newContext({
    baseURL,
    storageState: {
      cookies: (await context.storageState()).cookies,
      origins: [],
    },
  });
  const p2 = await fresh.newPage();
  await p2.goto(`/${planId}/budget`);
  await expect(p2.getByRole("button", { name: "Expand Bills categories" })).toBeVisible();
  const key = (p: Page) =>
    p.evaluate(() =>
      Object.keys(localStorage).some((k) => k.startsWith("budget.planGrid.collapsed")),
    );
  expect(await key(p2)).toBe(false);
  expect(await key(page)).toBe(false);
  await fresh.close();

  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(page.locator(".category-row")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand all" })).toBeVisible();
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(page.locator(".category-row")).toHaveCount(11);
  await page.keyboard.press("Control+ArrowUp");
  await expect(page.locator(".category-row")).toHaveCount(0);
  await page.keyboard.press("Control+ArrowDown");
  await expect(page.locator(".category-row")).toHaveCount(11);
  await expect.poll(() => collapsedNames(request)).toEqual([]);
});

async function collapsedNames(request: Req): Promise<string[]> {
  const res = await request.get(`/api/v1/budgets/${planId}/months/${ISO}`, {
    headers: await authHeaders(),
  });
  const d = (await res.json()).data as {
    groups: { name: string; collapsed: boolean }[];
  };
  return d.groups.filter((g) => g.collapsed).map((g) => g.name);
}

test("a month fetch started before a collapse cannot reopen the group or undo an Assigned value", async ({
  page,
}) => {
  await open(page);
  // The refetch that follows the Assigned commit is held: it carries the old `collapsed: false` and returns
  // only after the group is collapsed.
  let release: () => void = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  let armed = false;
  let holding = false;
  await page.route("**/api/v1/budgets/*/months/*", async (route) => {
    if (route.request().method() !== "GET" || !armed) return route.continue();
    armed = false;
    holding = true;
    const real = await route.fetch();
    await held;
    await route.fulfill({ response: real }).catch(() => {});
  });
  armed = true;
  const cell = catRow(page, RENT).locator(".assigned-box .amount");
  await cell.click();
  await page.keyboard.type("12");
  await page.keyboard.press("Enter");
  await expect.poll(() => holding).toBe(true);
  await page.getByRole("button", { name: "Collapse Bills categories" }).click();
  await expect(page.getByRole("button", { name: "Expand Bills categories" })).toBeVisible();
  release();
  await page.waitForTimeout(500);
  await expect(page.getByRole("button", { name: "Expand Bills categories" })).toBeVisible();
  await expect(groupRow(page, "Bills").locator(".num").first()).toHaveText("$12.00");
  await page.getByRole("button", { name: "Expand Bills categories" }).click();
  await expect(catRow(page, RENT).locator(".assigned-box .amount")).toHaveText("$12.00");
});

test("delete group wording: singular for one category, plural for two", async ({
  page,
  request,
}) => {
  const base = `/api/v1/budgets/${planId}`;
  const headers = await authHeaders();
  const mk = async (group: string, cats: string[]) => {
    const g = (
      await (
        await request.post(`${base}/category_groups`, {
          headers,
          data: { name: group },
        })
      ).json()
    ).data.category_group;
    for (const name of cats)
      await request.post(`${base}/categories`, {
        headers,
        data: { group_id: g.id, name },
      });
  };
  await mk("Solo", ["Only one"]);
  await mk("Pair", ["First", "Second"]);
  // A group with no history is deleted without a dialog, so give one category of each group an assignment.
  await assign(request, "Only one", 1000);
  await assign(request, "First", 1000);
  await open(page);
  const check = async (group: string, text: RegExp) => {
    await page.locator(".group-name", { hasText: group }).click();
    await popover(page, "Edit Category Group").getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete Category Group" });
    await expect(dialog.getByText(text)).toBeVisible();
    await page.keyboard.press("Escape"); // closes the category list
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  };
  await check(
    "Solo",
    /^The 1 category in the group Solo will be reassigned to the selected category\.$/,
  );
  await check(
    "Pair",
    /^All 2 categories in the group Pair will be reassigned to the selected category\.$/,
  );
});
