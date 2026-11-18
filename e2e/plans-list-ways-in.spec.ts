import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { showOnlyPlans } from "./support/plans";
import { ownPlan } from "./support/plans-list-seed";
import { realClick } from "./support/real-click";

test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

const side = (page: Page) => page.getByRole("navigation", { name: "Sidebar" });
const menu = (page: Page) => page.getByRole("menu", { name: "Plan", exact: true });
const sub = (page: Page) => page.getByRole("menu", { name: "Plans", exact: true });

async function openSub(page: Page, planName: string) {
  await realClick(page, side(page).getByRole("button", { name: planName, exact: true }));
  const open = menu(page).getByRole("menuitem", { name: "Open Plan", exact: true });
  await open.hover();
  await expect(sub(page)).toBeVisible();
  const [ob, sb] = await Promise.all([open.boundingBox(), sub(page).boundingBox()]);
  await page.mouse.move((sb?.x ?? 0) + 20, (ob?.y ?? 0) + (ob?.height ?? 0) / 2);
}

test("AC13 View All Plans is enabled and opens /plans", async ({ page, request }) => {
  const a = await ownPlan(request, "wi-a");
  const b = await ownPlan(request, "wi-b");
  await showOnlyPlans(page, (p) => p.id === a.id || p.id === b.id);
  await page.goto(`/${b.id}/budget`);
  await expect(side(page).getByRole("button", { name: b.name, exact: true })).toBeVisible();
  await openSub(page, b.name);
  const row = sub(page).getByRole("menuitem", { name: "View All Plans", exact: true });
  await expect(row).not.toHaveAttribute("aria-disabled", "true");
  await realClick(page, row);
  await expect(page).toHaveURL(/\/plans$/);
  await expect(page.getByRole("heading", { name: "Your Plans", exact: true })).toBeVisible();
});

test("AC13 one plan: Open Plan shows with only View All Plans", async ({ page, request }) => {
  const a = await ownPlan(request, "wi-one");
  await showOnlyPlans(page, (p) => p.id === a.id);
  await page.goto(`/${a.id}/budget`);
  await expect(side(page).getByRole("button", { name: a.name, exact: true })).toBeVisible();
  await openSub(page, a.name);
  await expect(sub(page).getByRole("menuitem")).toHaveText(["View All Plans"]);
  await expect(sub(page).getByText("Recent Plans", { exact: true })).toHaveCount(0);
});

test("AC14 the shell on /plans holds nothing of one plan", async ({ page }) => {
  await page.goto("/plans");
  const s = side(page);
  await expect(s.getByRole("button", { name: "No Plan Open", exact: true })).toBeVisible();
  for (const n of ["Plan", "Reflect", "All Accounts"])
    await expect(s.getByRole("link", { name: n, exact: true })).toHaveCount(0);
  for (const n of ["Add Account", "Bank Connections"])
    await expect(s.getByRole("button", { name: n, exact: true })).toHaveCount(0);
  await expect(s.getByText("No Accounts", { exact: true })).toHaveCount(0);
  await expect(page.locator(".sidebar-resizer")).toHaveCount(0);
  await realClick(page, s.getByRole("button", { name: "No Plan Open", exact: true }));
  await expect(
    menu(page).getByRole("menuitem", { name: "New Plan", exact: true }),
  ).not.toHaveAttribute("aria-disabled", "true");
  await expect(
    menu(page).getByRole("menuitem", { name: "Plan Settings", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
});
