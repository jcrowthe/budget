import { expect, type Page, test } from "@playwright/test";
import {
  clampWidth,
  isNarrow,
  readSidebarState,
  releaseWidth,
} from "../apps/web/src/shell/sidebarState";
import { openPlan, RENT, removePlan, seedPlan } from "./plan-panel.fixtures";
import { authHeaders, testName } from "./support/auth";
import { realClick } from "./support/real-click";

test.describe("pure rules", () => {
  const get = (m: Record<string, string>) => (k: string) => m[k] ?? null;
  test("readSidebarState", () => {
    const d = { collapsed: false, preferred: 260 };
    expect(readSidebarState(get({}))).toEqual(d);
    expect(readSidebarState(get({ "sidebar-is-collapsed": "true" }))).toEqual({
      ...d,
      collapsed: true,
    });
    expect(readSidebarState(get({ "sidebar-preferred-width": "400" }))).toEqual({
      ...d,
      preferred: 400,
    });
    expect(readSidebarState(get({ "sidebar-preferred-width": "100" }))).toEqual(d);
    expect(readSidebarState(get({ "sidebar-preferred-width": "700" }))).toEqual(d);
    expect(readSidebarState(get({ "sidebar-preferred-width": "abc" }))).toEqual(d);
    expect(
      readSidebarState(() => {
        throw new Error("denied");
      }),
    ).toEqual(d);
  });
  test("releaseWidth, clampWidth, isNarrow", () => {
    expect(releaseWidth(150)).toEqual({ collapsed: true, preferred: 260 });
    expect(releaseWidth(151)).toEqual({ collapsed: false, preferred: 151 });
    expect(releaseWidth(400.4)).toEqual({ collapsed: false, preferred: 400 });
    expect(clampWidth(20)).toBe(56);
    expect(clampWidth(900)).toBe(600);
    expect([150, 151, 220, 221].map(isNarrow)).toEqual([false, true, true, false]);
  });
});

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Sidebar" });
const width = async (page: Page) => Math.round((await sidebar(page).boundingBox())?.width ?? 0);
const toggleBtn = (page: Page) =>
  sidebar(page).getByRole("button", { name: "Expand/Collapse Sidebar" });

async function newPlan(request: import("@playwright/test").APIRequestContext, withAccount = false) {
  const headers = await authHeaders();
  const res = await request.post("/api/v1/budgets", { headers, data: { name: testName("sb") } });
  const id = (await res.json()).data.budget.id as string;
  if (withAccount)
    await request.post(`/api/v1/budgets/${id}/accounts`, {
      headers,
      data: { name: "ZZ-TEST Checking", type: "checking", balance: 5000 },
    });
  return id;
}

test("A10 the collapse button: 32×24 at the right, with its tooltip", async ({ page, request }) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  await expect.poll(() => width(page)).toBe(260);
  const b = await toggleBtn(page).boundingBox();
  expect([b?.width, b?.height]).toEqual([32, 24]);
  expect(Math.round((b?.x ?? 0) + (b?.width ?? 0))).toBe(248);
  await realClickHover(page, toggleBtn(page));
  await page.waitForTimeout(700);
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("Expand/Collapse Sidebar");
  await expect(tip.locator(".key-cap")).toHaveText(["shift", "."]);
  const t = await tip.boundingBox();
  expect((t?.y ?? 0) + (t?.height ?? 0)).toBeLessThan(b?.y ?? 0);
});

async function realClickHover(page: Page, loc: import("@playwright/test").Locator) {
  const b = await loc.boundingBox();
  await page.mouse.move((b?.x ?? 0) + (b?.width ?? 0) / 2, (b?.y ?? 0) + (b?.height ?? 0) / 2);
}

test("A11 the rail: tiles, main area, expand tooltip, Shift+. both ways", async ({
  page,
  request,
}) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  await realClick(page, toggleBtn(page));
  await expect.poll(() => width(page)).toBe(56);
  await expect(sidebar(page)).toHaveClass(/is-collapsed/);
  for (const n of ["Plan", "Reflect", "All Accounts"]) {
    const t = await sidebar(page).getByRole("link", { name: n, exact: true }).boundingBox();
    expect([t?.x, t?.width, t?.height]).toEqual([8, 39, 40]);
    await expect(sidebar(page).getByRole("link", { name: n, exact: true })).toHaveText("");
  }
  expect(Math.round((await page.locator("main.main").boundingBox())?.x ?? 0)).toBe(56);
  await realClickHover(page, toggleBtn(page));
  await page.waitForTimeout(700);
  await expect(page.getByRole("tooltip")).toContainText("Expand/Collapse Sidebar");
  await page.mouse.move(700, 300);
  await realClick(page, toggleBtn(page));
  await expect.poll(() => width(page)).toBe(260);
  await page.keyboard.press("Shift+.");
  await expect.poll(() => width(page)).toBe(56);
  await page.keyboard.press("Shift+.");
  await expect.poll(() => width(page)).toBe(260);
});

test("A12 the first paint after a reload already has the saved width", async ({
  browser,
  request,
}) => {
  const id = await newPlan(request);
  for (const [saved, expected, rail] of [
    [{ c: "true", w: "260" }, 56, true],
    [{ c: "false", w: "400" }, 400, false],
  ] as const) {
    const ctx = await browser.newContext({
      storageState: ".e2e-state/auth.json",
      baseURL: "http://localhost:4173",
    });
    const page = await ctx.newPage();
    await page.addInitScript(
      ([c, w]) => {
        localStorage.setItem("sidebar-is-collapsed", c as string);
        localStorage.setItem("sidebar-preferred-width", w as string);
        const tick = () => {
          const nav = document.querySelector("nav.sidebar");
          if (nav && !(window as unknown as { __first?: unknown }).__first)
            (window as unknown as { __first: unknown }).__first = {
              w: nav.getBoundingClientRect().width,
              rail: !!document.querySelector(".rail-logo"),
            };
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      [saved.c, saved.w],
    );
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route("**/api/v1/budgets", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await gate;
      return route.fallback();
    });
    await page.goto(`/${id}/budget`, { waitUntil: "commit" });
    await page.waitForFunction(() => (window as unknown as { __first?: unknown }).__first);
    const first = await page.evaluate(
      () => (window as unknown as { __first: { w: number; rail: boolean } }).__first,
    );
    release();
    expect(Math.round(first.w)).toBe(expected);
    expect(first.rail).toBe(rail);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await ctx.close();
  }
});

test.describe("at 1024×700", () => {
  test.use({ viewport: { width: 1024, height: 700 } });

  test("A13 the drag: follows, snaps, narrows, clamps, ends on leave, selects no text", async ({
    page,
    request,
  }) => {
    const id = await newPlan(request, true);
    await page.goto(`/${id}/budget`);
    await expect.poll(() => width(page)).toBe(260);
    const edge = async () => (await sidebar(page).boundingBox())?.width ?? 0;
    const y = 400;
    const drag = async (to: number, release = true) => {
      const x0 = (await edge()) - 3;
      await page.mouse.move(x0, y);
      await page.mouse.down();
      await page.mouse.move(to - 3, y, { steps: 5 });
      if (release) await page.mouse.up();
    };
    await drag(400);
    expect(Math.abs((await edge()) - 400)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => getSelection()?.toString())).toBe("");
    await page.reload();
    expect(Math.abs((await edge()) - 400)).toBeLessThanOrEqual(2);
    await drag(200);
    await expect(sidebar(page)).toHaveClass(/is-narrow/);
    await expect(sidebar(page).locator(".nav-accounts .value").first()).toBeHidden();
    await expect(sidebar(page).getByRole("link", { name: "All Accounts" })).toBeVisible();
    await drag(120);
    await expect(sidebar(page)).toHaveClass(/is-collapsed/);
    expect(Math.round(await edge())).toBe(56);
    await realClick(page, toggleBtn(page));
    await expect.poll(() => width(page)).toBe(260);
    await drag(900);
    expect(Math.round(await edge())).toBe(600);
    // Leaving the window ends the drag.
    await page.mouse.move(597, y);
    await page.mouse.down();
    await page.mouse.move(447, y, { steps: 3 });
    await page.evaluate(() => document.documentElement.dispatchEvent(new MouseEvent("mouseleave")));
    await page.mouse.move(300, y, { steps: 3 });
    expect(Math.abs((await edge()) - 450)).toBeLessThanOrEqual(2);
    await page.mouse.up();
  });

  test("A16 at 600 the page does not scroll sideways and nothing overlaps", async ({
    page,
    request,
  }) => {
    const seed = await seedPlan(request, "sb16");
    await page.addInitScript(() => {
      localStorage.setItem("sidebar-preferred-width", "600");
    });
    await openPlan(page, seed);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024);
    const side = (await sidebar(page).boundingBox())?.width ?? 0;
    expect(Math.round(side)).toBe(600);
    expect(Math.round((await page.locator("main.main").boundingBox())?.x ?? 0)).toBe(600);
    expect(
      await page.evaluate(() => !!document.elementFromPoint(300, 350)?.closest("nav.sidebar")),
    ).toBe(true);
    await realClick(page, page.locator(".category-name", { hasText: RENT }));
    await expect(page.getByRole("row").filter({ hasText: RENT }).first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.goto(`/${seed.id}/accounts`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024);
    await removePlan(request, seed);
  });
});

test("A14 the rail's mark opens the menu beside it; the tiles navigate", async ({
  page,
  request,
}) => {
  const id = await newPlan(request);
  await page.goto(`/${id}/budget`);
  await realClick(page, toggleBtn(page));
  await expect.poll(() => width(page)).toBe(56);
  await realClick(page, sidebar(page).locator(".rail-logo"));
  const menu = page.getByRole("menu", { name: "Plan" });
  await expect(menu).toBeVisible();
  expect((await menu.boundingBox())?.x ?? 0).toBeGreaterThanOrEqual(56);
  await realClick(page, menu.getByRole("menuitem", { name: "Keyboard Shortcuts" }));
  await expect(page.getByRole("dialog", { name: "Keyboard Shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  for (const [n, path] of [
    ["Reflect", /\/reflect/],
    ["All Accounts", /\/accounts$/],
    ["Plan", /\/budget/],
  ] as const) {
    const link = sidebar(page).getByRole("link", { name: n, exact: true });
    await realClick(page, link);
    await expect(page).toHaveURL(path);
    await expect(link).toHaveClass(/active/);
  }
});

test("a stray click on the rail's edge keeps the saved width", async ({ page, request }) => {
  const id = await newPlan(request);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("sidebar-is-collapsed", "true");
      localStorage.setItem("sidebar-preferred-width", "400");
    }
  });
  await page.goto(`/${id}/budget`);
  await expect.poll(() => width(page)).toBe(56);
  await page.mouse.click(54, 400);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("sidebar-preferred-width")))
    .toBe("400");
  await realClick(page, toggleBtn(page));
  await expect.poll(() => width(page)).toBe(400);
});
