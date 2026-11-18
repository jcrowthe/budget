import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import { realClick } from "./support/real-click";

// EXF-874: a press outside the month picker or the month note only closes it. It never reaches what is
// under the pointer, and focus goes back to the button that opened the popover.

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const M = {
  iso: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`,
  label: now.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
};

const created: string[] = [];
async function newPlan(request: APIRequestContext) {
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: testName("outside-press") },
  });
  const id = (await res.json()).data.budget.id as string;
  created.push(id);
  return id;
}
test.afterEach(async ({ request }) => {
  for (const id of created.splice(0)) {
    await request.delete(`/api/v1/budgets/${id}`, { headers: await authHeaders() });
  }
});

const monthButton = (page: Page) => page.locator(".month-button");
const picker = (page: Page) => page.getByRole("dialog", { name: "Choose month", exact: true });
const note = (page: Page) => page.getByRole("dialog", { name: "Month note", exact: true });
const option = (page: Page) => page.locator(".auto-assign-option").first();

const isAutoAssign = (method: string, url: string, id: string) =>
  method === "POST" && url.includes(`/api/v1/budgets/${id}/months/${M.iso}/auto-assign`);

function watchPosts(page: Page, id: string) {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (isAutoAssign(r.method(), r.url(), id)) posts.push(r.url());
  });
  return posts;
}

async function targetRow(page: Page, popover: Locator) {
  const box = await popover.boundingBox();
  if (!box) throw new Error("popover has no box");
  const rows = page.locator(".category-row");
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const name = row.locator(".category-name");
    const b = await name.boundingBox();
    if (b && b.y > box.y + box.height + 4) return { row, name };
  }
  throw new Error("no category row below the popover");
}

async function centreIfTopmost(loc: Locator) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (!b) throw new Error("not visible");
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  expect(
    await loc.evaluate(
      (el, [px, py]) => {
        const h = document.elementFromPoint(px as number, py as number);
        return !!h && (h === el || el.contains(h));
      },
      [x, y],
    ),
  ).toBe(true);
  return { x, y };
}

async function rightPress(page: Page, loc: Locator) {
  const { x, y } = await centreIfTopmost(loc);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
}

async function tapCentre(page: Page, loc: Locator) {
  const { x, y } = await centreIfTopmost(loc);
  await page.touchscreen.tap(x, y);
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
]) {
  test.describe(`outside press, ${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

    test("1. a press on an Auto-Assign option outside the picker only closes it", async ({
      page,
      request,
    }) => {
      const id = await newPlan(request);
      const posts = watchPosts(page, id);
      await page.goto(`/${id}/budget`);
      await expect(option(page)).toBeEnabled();
      await realClick(page, monthButton(page));
      await expect(picker(page)).toBeVisible();
      await realClick(page, option(page));
      await expect(picker(page)).toHaveCount(0);
      await expect(monthButton(page)).toBeFocused();
      await expect(option(page)).toBeEnabled();
      expect(posts).toHaveLength(0);
      const answered = page.waitForResponse((r) => isAutoAssign(r.request().method(), r.url(), id));
      await realClick(page, option(page));
      await answered;
      await expect.poll(() => posts.length).toBe(1);
    });

    test("4. a press on a category row outside the month note only closes it", async ({
      page,
      request,
    }) => {
      const id = await newPlan(request);
      await page.goto(`/${id}/budget`);
      await realClick(page, page.locator(".month-note"));
      await expect(page.getByRole("textbox", { name: "Month note", exact: true })).toBeFocused();
      await page.getByRole("textbox", { name: "Month note", exact: true }).fill("ZZ-TEST draft");
      const t = await targetRow(page, note(page));
      await realClick(page, t.name);
      await expect(note(page)).toHaveCount(0);
      await expect(t.row).toHaveAttribute("aria-selected", "false");
      await expect(page.locator(".month-note")).toBeFocused();
      await expect(page.locator(".month-note")).toHaveText("Enter a note...");
      await realClick(page, t.name);
      await expect(t.row).toHaveAttribute("aria-selected", "true");
    });

    test("5. a press on the month button closes the picker and it stays closed", async ({
      page,
      request,
    }) => {
      const id = await newPlan(request);
      await page.goto(`/${id}/budget`);
      await realClick(page, monthButton(page));
      await expect(picker(page)).toBeVisible();
      await realClick(page, monthButton(page));
      await expect(picker(page)).toHaveCount(0);
      await expect(monthButton(page)).toHaveAttribute("aria-expanded", "false");
      await expect(monthButton(page)).toBeFocused();
    });
  });
}

test.describe("outside press, code clicks", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("6. a click made by code after an outside press is not stopped", async ({
    page,
    request,
  }) => {
    const id = await newPlan(request);
    await page.goto(`/${id}/budget`);
    await realClick(page, monthButton(page));
    await expect(picker(page)).toBeVisible();
    await realClick(page, option(page));
    await expect(picker(page)).toHaveCount(0);
    const seen = await page.evaluate(() => {
      const a = document.createElement("a");
      let prevented: boolean | null = null;
      a.addEventListener("click", (e) => {
        prevented = e.defaultPrevented;
        e.preventDefault();
      });
      document.body.append(a);
      a.click();
      a.remove();
      return prevented;
    });
    expect(seen).toBe(false);
  });
});

test.describe("outside press, touch", () => {
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: true });

  test("2. a tap on the option outside the picker only closes it", async ({ page, request }) => {
    const id = await newPlan(request);
    const posts = watchPosts(page, id);
    await page.goto(`/${id}/budget`);
    await expect(option(page)).toBeEnabled();
    await realClick(page, monthButton(page));
    await expect(picker(page)).toBeVisible();
    await tapCentre(page, option(page));
    await expect(picker(page)).toHaveCount(0);
    await expect(monthButton(page)).toBeFocused();
    expect(posts).toHaveLength(0);
    const answered = page.waitForResponse((r) => isAutoAssign(r.request().method(), r.url(), id));
    await tapCentre(page, option(page));
    await answered;
    await expect.poll(() => posts.length).toBe(1);
  });
});

test.describe("outside press, right press", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("3. a right press on a category row outside the picker only closes it", async ({
    page,
    request,
  }) => {
    const id = await newPlan(request);
    await page.goto(`/${id}/budget`);
    await realClick(page, monthButton(page));
    await expect(picker(page)).toBeVisible();
    const t = await targetRow(page, picker(page));
    await rightPress(page, t.name);
    await expect(picker(page)).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(t.row).toHaveAttribute("aria-selected", "false");
    await expect(monthButton(page)).toBeFocused();
  });
});
