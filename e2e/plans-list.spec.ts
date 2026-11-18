import { BudgetListResponse } from "../packages/schema/src/budgets";
import { expect, test } from "./fixtures";
import { newPlanDialog } from "./support/new-plan-seed";
import {
  card,
  cardLink,
  openInOrder,
  ownPlan,
  plansList,
  stampOf,
} from "./support/plans-list-seed";
import { realClick } from "./support/real-click";

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

test("AC471-1 the page lists plans, most recently used first, with Last used", async ({
  page,
  request,
}) => {
  const [p1, p2, p3, p4] = [
    await ownPlan(request, "pl1"),
    await ownPlan(request, "pl2"),
    await ownPlan(request, "pl3"),
    await ownPlan(request, "pl4"),
  ] as const;
  await openInOrder(request, [p2, p3, p1]);
  await page.goto("/plans");
  await expect(page).toHaveTitle("Open Plan");
  await expect(page.getByRole("heading", { name: "Your Plans", exact: true })).toBeVisible();
  await expect(cardLink(page, p1.name)).toBeVisible();
  const own = [p1, p2, p3, p4].map((p) => p.name);
  const names = await plansList(page)
    .getByRole("link")
    .evaluateAll((els) => els.map((e) => e.querySelector(".plans-list-name")?.textContent ?? ""));
  expect(names.filter((n) => own.includes(n))).toEqual([p1.name, p3.name, p2.name, p4.name]);
  for (const p of [p1, p2, p3])
    await expect(card(page, p.name).locator(".plans-list-used")).toHaveText("Last used just now");
  await expect(card(page, p4.name).locator(".plans-list-used")).toHaveText("Never opened");
  await expect(page.getByRole("button", { name: "Create New Plan", exact: true })).toBeVisible();

  // Three days and a minute after P1's stamp.
  const stamp = await stampOf(request, p1.id);
  await page.clock.setFixedTime(new Date(Date.parse(stamp) + 3 * 86_400_000 + 60_000));
  await page.goto("/plans");
  await expect(card(page, p1.name).locator(".plans-list-used")).toHaveText("Last used 3 days ago");
});

test("AC471-2 a click opens the plan; the keyboard opens it too", async ({ page, request }) => {
  const p2 = await ownPlan(request, "po2");
  const p3 = await ownPlan(request, "po3");
  await page.goto("/plans");
  await expect(cardLink(page, p2.name)).toHaveAttribute("href", `/${p2.id}/budget`);
  await expect(cardLink(page, p3.name)).toHaveAttribute("href", `/${p3.id}/budget`);
  await realClick(page, cardLink(page, p2.name));
  await expect(page).toHaveURL(`/${p2.id}/budget`);
  await page.goto("/plans");
  await cardLink(page, p3.name).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/${p3.id}/budget`);
});

test("AC471-3 the trash shows on hover and on keyboard focus", async ({ page, request }) => {
  const p = await ownPlan(request, "ph");
  await page.goto("/plans");
  const c = card(page, p.name);
  const trash = c.getByRole("button", { name: "Delete Plan", exact: true });
  await page.mouse.move(0, 0);
  await expect(trash).toBeHidden();
  await c.hover({ position: { x: 20, y: 20 } });
  await expect(trash).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(trash).toBeHidden();
  await cardLink(page, p.name).focus();
  await page.keyboard.press("Tab"); // keep the pointer away: focus is what shows it
  await expect(trash).toBeFocused();
  await expect(trash).toBeVisible();
  await cardLink(page, p.name).focus();
  await expect(trash).toBeVisible();
});

test("AC471-4 Create New Plan opens New Plan; Cancel refocuses the card; creating opens the plan", async ({
  page,
  request,
}) => {
  const p = await ownPlan(request, "pc");
  await page.goto("/plans");
  await expect(cardLink(page, p.name)).toBeVisible();
  const create = page.getByRole("button", { name: "Create New Plan", exact: true });
  await realClick(page, create);
  await expect(newPlanDialog(page)).toBeVisible();
  await realClick(page, newPlanDialog(page).getByRole("button", { name: "Cancel", exact: true }));
  await expect(newPlanDialog(page)).toHaveCount(0);
  await expect(create).toBeFocused();
  await realClick(page, create);
  const name = `ZZ-TEST pc-new ${crypto.randomUUID().slice(0, 8)}`;
  await newPlanDialog(page).getByLabel("Plan Name", { exact: true }).fill(name);
  await realClick(
    page,
    newPlanDialog(page).getByRole("button", { name: "Create Plan", exact: true }),
  );
  await expect(page).toHaveURL(/\/[0-9a-f-]{36}\/budget$/);
  await expect(
    page.getByRole("navigation", { name: "Sidebar" }).getByRole("button", { name, exact: true }),
  ).toBeVisible();
});

test("the empty list: the heading and only Create New Plan", async ({ page }) => {
  const body = { data: { budgets: [] } };
  expect(BudgetListResponse.safeParse(body).success).toBe(true);
  await page.route("**/api/v1/budgets", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: body }) : route.fallback(),
  );
  for (const path of ["/plans", "/"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Your Plans", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create New Plan", exact: true })).toBeVisible();
    await expect(plansList(page).getByRole("link")).toHaveCount(0);
    await expect(page).toHaveTitle("Open Plan");
  }
});

test("AC471 one request: /plans reads the plans once and never a plan by id", async ({ page }) => {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/")) urls.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  await page.goto("/plans");
  await expect(page.getByRole("button", { name: "Create New Plan", exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  expect(urls.filter((u) => u === "GET /api/v1/budgets")).toHaveLength(1);
  expect(urls.filter((u) => /\/api\/v1\/budgets\/[0-9a-f-]{36}/.test(u))).toEqual([]);
});
