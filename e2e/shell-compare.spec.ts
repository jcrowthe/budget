import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

// Measured values below come from docs/scaffold-design.md §7 cases 14 and 15 (the source YNAB app,
// dark theme, 1440×900, sidebar expanded).
test.use({ viewport: { width: 1440, height: 900 } });

const css = (loc: import("@playwright/test").Locator, prop: string) =>
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

async function openPlan(request: import("@playwright/test").APIRequestContext) {
  const name = testName("cmp");
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name },
  });
  return { name, id: (await res.json()).data.budget.id as string };
}

test("shell geometry and colours match the source", async ({ page, request }) => {
  const { name, id } = await openPlan(request);
  await page.goto(`/${id}/budget`);
  const sidebar = page.getByRole("navigation", { name: "Sidebar" });
  await expect(sidebar.getByRole("button", { name })).toBeVisible();

  // Sidebar width 260 and background #121330 (design doc case 14).
  const box = await sidebar.boundingBox();
  expect(box?.width).toBe(260);
  expect(await css(sidebar, "background-color")).toBe("rgb(18, 19, 48)");
  // Main background #0C0D22 (case 14).
  expect(await css(page.locator("main.main"), "background-color")).toBe("rgb(12, 13, 34)");
  // Header band #15172D (case 14).
  expect(await css(page.locator("header.page-header"), "background-color")).toBe("rgb(21, 23, 45)");
  // Figtree font (case 14).
  expect(await css(page.locator("body"), "font-family")).toContain("Figtree");

  // Element order: plan button → Plan/Reflect/All Accounts → accounts card → Add Account (case 14).
  const planBtn = await sidebar.getByRole("button", { name }).boundingBox();
  const plan = sidebar.getByRole("link", { name: "Plan", exact: true });
  const reflect = sidebar.getByRole("link", { name: "Reflect" });
  const all = sidebar.getByRole("link", { name: "All Accounts" });
  const [p, r, a] = await Promise.all([
    plan.boundingBox(),
    reflect.boundingBox(),
    all.boundingBox(),
  ]);
  const card = await sidebar.getByText("No Accounts").boundingBox();
  const add = await sidebar.getByRole("button", { name: "Add Account" }).boundingBox();
  const ys = [planBtn, p, r, a, card, add].map((b) => b?.y ?? Number.NaN);
  expect([...ys].sort((x, y) => x - y)).toEqual(ys);

  // Nav rows 40px high with a 4px gap (case 14).
  expect(p?.height).toBe(40);
  expect(r?.height).toBe(40);
  expect(a?.height).toBe(40);
  expect((r?.y ?? 0) - ((p?.y ?? 0) + (p?.height ?? 0))).toBe(4);
  expect((a?.y ?? 0) - ((r?.y ?? 0) + (r?.height ?? 0))).toBe(4);

  // Active colour is the sidebarActive token #1C1F58; hover is #1B1D48 (case 14, "active and hover colours").
  expect(await css(plan, "background-color")).toBe("rgb(28, 31, 88)");
  await reflect.hover();
  await expect.poll(() => css(reflect, "background-color")).toBe("rgb(27, 29, 72)");

  // Expected differences: no Bank Connections, referral or Share & Earn (case 14).
  await expect(sidebar.getByText(/Bank Connections|Share & Earn|referral/i)).toHaveCount(0);
});

test("plan menu matches the source", async ({ page, request }) => {
  const { name, id } = await openPlan(request);
  await page.goto(`/${id}/budget`);
  const sidebar = page.getByRole("navigation", { name: "Sidebar" });
  const button = sidebar.getByRole("button", { name });
  await button.click();
  const menu = page.getByRole("menu").first();
  await expect(menu).toBeVisible();

  // Dropdown sits under the button with the same width (case 15).
  const [m, b] = await Promise.all([menu.boundingBox(), button.boundingBox()]);
  expect(m?.width).toBe(b?.width);
  expect(m?.y ?? 0).toBeGreaterThanOrEqual((b?.y ?? 0) + (b?.height ?? 0));
  // Background #1F2038 (case 15).
  expect(await css(menu, "background-color")).toBe("rgb(31, 32, 56)");

  // First items "New Plan" and "Open Plan ›"; nothing else (case 15).
  const items = menu.getByRole("menuitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveText("New Plan");
  await expect(items.nth(1)).toHaveText(/^Open Plan/);

  // Items 33px high (case 15).
  expect((await items.nth(0).boundingBox())?.height).toBe(33);
  // Hover #292B3D (case 15).
  await items.nth(0).hover();
  await expect.poll(() => css(items.nth(0), "background-color")).toBe("rgb(41, 43, 61)");
});
