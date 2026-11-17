import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";
import { mouseClick } from "./support/menu";

// Measured values asserted below come from docs/plan-menu-design.md §Source and §5 (the source app,
// plan "Test Budget", dark theme).

const css = (loc: Locator, prop: string) =>
  loc.evaluate(
    (el, p) =>
      (
        globalThis as unknown as {
          getComputedStyle(e: unknown): { getPropertyValue(p: string): string };
        }
      )
        .getComputedStyle(el)
        .getPropertyValue(p),
    prop,
  );

async function newPlan(request: APIRequestContext, name = testName("menu")) {
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name },
  });
  return { name, id: (await res.json()).data.budget.id as string };
}
const markOpened = async (request: APIRequestContext, id: string) =>
  request.patch(`/api/v1/budgets/${id}`, { headers: await authHeaders(), data: { opened: true } });

const side = (page: Page) => page.getByRole("navigation", { name: "Sidebar" });
const planButton = (page: Page, name: string) =>
  side(page).getByRole("button", { name, exact: true });
const menu = (page: Page) => page.getByRole("menu", { name: "Plan", exact: true });
const sub = (page: Page) => page.getByRole("menu", { name: "Plans", exact: true });
const item = (page: Page, name: string) => page.getByRole("menuitem", { name, exact: true });

/** Plans A and B; B is open and A is the most recently opened other plan. */
async function twoPlans(page: Page, request: APIRequestContext, aName?: string) {
  const a = await newPlan(request, aName);
  const b = await newPlan(request);
  await markOpened(request, a.id);
  // The suite runs in parallel against one database: other specs open plans too, which would push A out of
  // the five most recent. Show this test only its own two plans (real data, filtered).
  await page.route("**/api/v1/budgets", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    const body = await res.json();
    body.data.budgets = body.data.budgets.filter(
      (x: { id: string }) => x.id === a.id || x.id === b.id,
    );
    return route.fulfill({ response: res, json: body });
  });
  await page.goto(`/${b.id}/budget`);
  await expect(planButton(page, b.name)).toBeVisible();
  return { a, b };
}

/** Real mouse: open the menu, hover Open Plan, then move along its row into the submenu. */
async function hoverIntoSubmenu(page: Page, planName: string) {
  await mouseClick(page, planButton(page, planName));
  const open = item(page, "Open Plan");
  await mouseClick(page, open, { click: false });
  await expect(sub(page)).toBeVisible();
  const [ob, sb] = await Promise.all([open.boundingBox(), sub(page).boundingBox()]);
  await page.mouse.move((sb?.x ?? 0) + 20, (ob?.y ?? 0) + (ob?.height ?? 0) / 2);
}

async function expectSubmenuReachable(page: Page, request: APIRequestContext, aName?: string) {
  const { a, b } = await twoPlans(page, request, aName);
  await hoverIntoSubmenu(page, b.name);
  const s = await sub(page).boundingBox();
  const vp = page.viewportSize();
  expect(s?.x).toBeGreaterThanOrEqual(8);
  expect((s?.x ?? 0) + (s?.width ?? 0)).toBeLessThanOrEqual((vp?.width ?? 0) - 8 + 0.5);
  expect((s?.y ?? 0) + (s?.height ?? 0)).toBeLessThanOrEqual(vp?.height ?? 0);
  // Source (Designer, 1440\u00d7900): the submenu starts at the Open Plan row's right edge and row top.
  const row = await item(page, "Open Plan").boundingBox();
  // Every submenu row is topmost at its own centre before anything is clicked.
  const subRows = sub(page).getByRole("menuitem");
  for (let i = 0; i < (await subRows.count()); i++)
    await mouseClick(page, subRows.nth(i), { click: false });
  if (aName === undefined) {
    expect(s?.x).toBeCloseTo((row?.x ?? 0) + (row?.width ?? 0), 0);
    expect(s?.y).toBeCloseTo(row?.y ?? 0, 0);
  }
  // The sidebar never scrolls sideways.
  const sc = await side(page).evaluate((el) => [el.scrollWidth, el.clientWidth, el.scrollLeft]);
  expect(sc[0]).toBe(sc[1]);
  expect(sc[2]).toBe(0);
  await mouseClick(page, sub(page).getByRole("menuitem", { name: a.name, exact: true }));
  await expect(page).toHaveURL(`/${a.id}/budget`);
  await expect(planButton(page, a.name)).toBeVisible();
}

// Route callbacks still fetching when a test ends would otherwise surface as an error outside any test.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test.describe("1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("1 EXF-571: the submenu is reachable with a real mouse", async ({ page, request }) => {
    await expectSubmenuReachable(page, request);
  });

  test("13 EXF-454: measurements", async ({ page, request }) => {
    const { b } = await twoPlans(page, request);
    const btn = planButton(page, b.name);
    await mouseClick(page, btn);
    const [m, bb] = await Promise.all([menu(page).boundingBox(), btn.boundingBox()]);
    expect(m?.width).toBe(240); // source min-width 15rem (design §5)
    expect(m?.x).toBe(8);
    expect(m?.y ?? 0).toBeCloseTo((bb?.y ?? 0) + (bb?.height ?? 0) + 8, 0);
    const rows = menu(page).getByRole("menuitem");
    for (let i = 0; i < (await rows.count()); i++)
      expect((await rows.nth(i).boundingBox())?.height).toBeCloseTo(32.8, 1);
    const np = item(page, "New Plan");
    await mouseClick(page, np, { click: false });
    await expect.poll(() => css(np, "background-color")).toBe("rgb(41, 43, 61)");
    expect(await css(np, "color")).toBe("rgb(255, 255, 255)");
    await page.keyboard.press("Escape");
    // Active/hover fill of the Plan item: rgb(28, 31, 88), measured in the source (docs/plan-menu-design.md, as in shell-compare.spec.ts).
    const planLink = side(page).getByRole("link", { name: "Plan", exact: true });
    expect(await css(planLink, "background-color")).toBe("rgb(28, 31, 88)");
    await planLink.hover();
    await expect.poll(() => css(planLink, "background-color")).toBe("rgb(28, 31, 88)");
    const reflect = side(page).getByRole("link", { name: "Reflect", exact: true });
    await reflect.hover();
    await expect.poll(() => css(reflect, "background-color")).toBe("rgb(27, 29, 72)");
    const add = side(page).getByRole("button", { name: "Add Account", exact: true });
    expect(await css(add, "background-color")).toBe("rgba(255, 255, 255, 0.15)");
    await add.hover();
    await expect.poll(() => css(add, "background-color")).toBe("rgba(255, 255, 255, 0.2)");
  });

  test("6 EXF-470: entries, sections, icons, disabled rows", async ({ page, request }) => {
    const { b } = await twoPlans(page, request);
    await mouseClick(page, planButton(page, b.name));
    const names = [
      "New Plan",
      "Open Plan",
      "Plan Settings",
      "Manage Payees",
      "Edit Flags",
      "Display Options",
      "Export Plan",
      "Make a Fresh Start",
      "Manage Bank Connections",
      "Keyboard Shortcuts",
      "Log Out",
    ];
    const rows = menu(page).getByRole("menuitem");
    await expect(rows).toHaveText(names);
    await expect(menu(page).getByText("Current Plan", { exact: true })).toBeVisible();
    await expect(menu(page).getByText("Account", { exact: true })).toBeVisible();
    await expect(menu(page).getByRole("separator")).toHaveCount(3);
    for (let i = 0; i < names.length; i++) {
      const box = await rows.nth(i).locator("svg").first().boundingBox();
      expect([box?.width, box?.height]).toEqual([16, 16]);
      // Plan Settings is enabled by EXF-468 (menu-actions/plan-settings.tsx).
      const enabled = [
        "New Plan",
        "Open Plan",
        "Plan Settings",
        "Keyboard Shortcuts",
        "Log Out",
      ].includes(names[i] ?? "");
      if (enabled) await expect(rows.nth(i)).not.toHaveAttribute("aria-disabled", "true");
      else await expect(rows.nth(i)).toHaveAttribute("aria-disabled", "true");
    }
    const flags = item(page, "Edit Flags");
    await mouseClick(page, flags, { click: false });
    expect(await css(flags, "color")).toBe("rgb(155, 156, 170)");
    expect(await css(flags, "cursor")).toBe("default");
    expect(await css(flags, "background-color")).toBe("rgba(0, 0, 0, 0)");
    const url = page.url();
    await page.mouse.click(
      ...(await flags.boundingBox().then((x) => [(x?.x ?? 0) + 20, (x?.y ?? 0) + 10] as const)),
    );
    await expect(menu(page)).toBeVisible();
    expect(page.url()).toBe(url);
  });

  test("7 EXF-470: recent plans, most recent first, at most five", async ({ page, request }) => {
    const { b } = await twoPlans(page, request);
    const fake = Array.from({ length: 7 }, (_, i) => ({
      id: crypto.randomUUID(),
      name: testName(`r${i}`),
      created_at: "2026-01-01T00:00:00.000Z",
      last_modified_on: "2026-01-01T00:00:00.000Z",
      last_opened_at: i < 5 ? `2026-02-0${i + 1}T00:00:00.000Z` : null,
      bank_environment: "production",
    }));
    await page.route("**/api/v1/budgets", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const res = await route.fetch();
      const body = await res.json();
      const cur = body.data.budgets.find((x: { id: string }) => x.id === b.id);
      body.data.budgets = [cur, ...fake];
      return route.fulfill({ response: res, json: body });
    });
    await page.reload();
    await expect(planButton(page, b.name)).toBeVisible();
    await hoverIntoSubmenu(page, b.name);
    await expect(sub(page).getByText("Recent Plans", { exact: true })).toBeVisible();
    const expected = fake.slice(0, 5).reverse();
    const rows = sub(page).getByRole("menuitem");
    await expect(rows).toHaveText([...expected.map((p) => p.name), "View All Plans"]);
    for (let i = 0; i < 5; i++)
      await expect(rows.nth(i)).toHaveAttribute("href", `/${expected[i]?.id}/budget`);
    await expect(sub(page).getByRole("separator")).toHaveCount(1);
    await expect(rows.nth(5)).toHaveAttribute("aria-disabled", "true");
    await expect(sub(page).getByText(fake[5]?.name ?? "", { exact: true })).toHaveCount(0);
  });

  test("8 EXF-470: a single plan has no Open Plan", async ({ page, request }) => {
    const { b } = await newPlan(request).then((x) => ({ b: x }));
    await page.route("**/api/v1/budgets", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const res = await route.fetch();
      const body = await res.json();
      body.data.budgets = body.data.budgets.filter((x: { id: string }) => x.id === b.id);
      return route.fulfill({ response: res, json: body });
    });
    await page.goto(`/${b.id}/budget`);
    await mouseClick(page, planButton(page, b.name));
    await expect(item(page, "Open Plan")).toHaveCount(0);
    const np = item(page, "New Plan");
    expect(
      await np.evaluate((el) => el.parentElement?.nextElementSibling?.firstElementChild?.tagName),
    ).toBe("HR");
  });

  test("9 EXF-470: close paths and New Plan", async ({ page, request }) => {
    const { b } = await twoPlans(page, request);
    const btn = planButton(page, b.name);
    await mouseClick(page, btn);
    await expect(menu(page)).toBeVisible();
    await mouseClick(page, btn);
    await expect(menu(page)).toBeHidden();
    await mouseClick(page, btn);
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
    await expect(btn).toBeFocused();
    await mouseClick(page, btn);
    await mouseClick(page, page.locator("header.page-header"));
    await expect(menu(page)).toBeHidden();
    await mouseClick(page, btn);
    await mouseClick(page, item(page, "New Plan"));
    await expect(menu(page)).toBeHidden();
    await expect(page.getByRole("dialog", { name: "New Plan" })).toBeVisible();
  });

  test("10 EXF-470: Log Out is a link to the sign-out path", async ({ page, request }) => {
    const { b } = await twoPlans(page, request);
    await mouseClick(page, planButton(page, b.name));
    const out = item(page, "Log Out");
    expect(await out.evaluate((el) => el.tagName)).toBe("A");
    await expect(out).toHaveAttribute("href", "/cdn-cgi/access/logout");
    await mouseClick(page, out, { click: false });
  });

  test("12 EXF-470: /me and the identity under the plan name", async ({ page, request }) => {
    const me = await request.get("/api/v1/me", { headers: await authHeaders() });
    expect(await me.json()).toEqual({ data: { kind: "user", email: "e2e@localhost" } });
    const { b } = await twoPlans(page, request);
    const id = planButton(page, b.name).locator(".identity");
    await expect(id).toHaveText("e2e@localhost");
    expect(await css(id, "font-size")).toBe("12px");
    expect(await css(id, "font-weight")).toBe("500");
    expect(await css(id, "color")).toBe("rgba(255, 255, 255, 0.7)");
  });

  test("14 favicon", async ({ page, request }) => {
    const res = await request.get("/favicon.ico", { headers: await authHeaders() });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^image\//);
    expect([...(await res.body()).subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    const p = await newPlan(request);
    await page.goto(`/${p.id}/budget`);
    await expect(page.locator('link[rel="icon"][href="/favicon.ico"]')).toHaveCount(1);
  });

  test("5 EXF-571: keyboard", async ({ page, request }) => {
    const { b } = await twoPlans(page, request);
    const btn = planButton(page, b.name);
    const open = item(page, "Open Plan");
    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(item(page, "New Plan")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(open).toBeFocused();
    // Plan Settings (EXF-468) follows Open Plan; Keyboard Shortcuts is enabled (EXF-473): it sits before Log Out.
    await page.keyboard.press("ArrowDown");
    await expect(item(page, "Plan Settings")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(item(page, "Keyboard Shortcuts")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(item(page, "Log Out")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(open).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(sub(page)).toBeVisible();
    await expect(sub(page).getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(sub(page)).toBeHidden();
    await expect(open).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(sub(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sub(page)).toBeHidden();
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
    await expect(btn).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(menu(page)).toBeHidden();
    await expect(btn).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    const first = sub(page).getByRole("menuitem").first();
    const href = await first.getAttribute("href");
    await expect(first).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(href ?? "");
  });
});

test.describe("1024×700", () => {
  test.use({ viewport: { width: 1024, height: 700 } });
  test("2 EXF-571: the submenu is reachable with a real mouse", async ({ page, request }) => {
    await expectSubmenuReachable(page, request);
  });
});

test.describe("640×700", () => {
  test.use({ viewport: { width: 640, height: 700 } });
  test("3 EXF-571: a long plan name stays inside the window", async ({ page, request }) => {
    await expectSubmenuReachable(
      page,
      request,
      `ZZ-TEST ${"long name ".repeat(5)}${Math.random().toString(36).slice(2, 8)}`,
    );
  });
});

test.describe("1024×480", () => {
  test.use({ viewport: { width: 1024, height: 480 } });
  test("4 EXF-571: a short window scrolls the menu", async ({ page, request }) => {
    const { b } = await twoPlans(page, request);
    await mouseClick(page, planButton(page, b.name));
    const m = await menu(page).boundingBox();
    expect((m?.y ?? 0) + (m?.height ?? 0)).toBeLessThanOrEqual(480 - 16 + 0.5);
    expect(await menu(page).evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await mouseClick(page, item(page, "Open Plan"), { click: false });
    const s = await sub(page).boundingBox();
    expect(s?.y).toBeGreaterThanOrEqual(8);
    expect((s?.y ?? 0) + (s?.height ?? 0)).toBeLessThanOrEqual(480 - 8 + 0.5);
    expect(s?.x).toBeGreaterThanOrEqual(8);
    expect((s?.x ?? 0) + (s?.width ?? 0)).toBeLessThanOrEqual(1024 - 8 + 0.5);
    await page.mouse.move((m?.x ?? 0) + 100, (m?.y ?? 0) + (m?.height ?? 0) / 2);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => menu(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await mouseClick(page, item(page, "Log Out"), { click: false });
  });
});
