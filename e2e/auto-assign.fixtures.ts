import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { assign, panel, removePlan, row, type Seed, seedPlan, TODAY } from "./plan-panel.fixtures";
import { authHeaders } from "./support/auth";
import { monthIso } from "./support/plan-seed";
import { MONTHLY, putTarget, readCategory } from "./targets.fixtures";

export { realClick } from "./support/real-click";
export type { Seed };
export { assign, MONTHLY, panel, putTarget, readCategory, removePlan, row, seedPlan, TODAY };

/** The two window sizes every spec of this feature runs at. */
export const SIZES = [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
] as const;

/** Noon UTC on the 15th of the current UTC month: far from a month edge, so "the current month" is stable. */
export function fixedClock() {
  const n = new Date();
  const at = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 15, 12));
  return { at, today: at.toISOString().slice(0, 10) };
}

export const NEXT = monthIso(1);
export const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

export const chip = (page: Page, name: string) =>
  page.locator(".view-chips").getByRole("button", { name, exact: true });
export const autoCard = (page: Page) =>
  panel(page).locator(".panel-card", { has: page.locator("#panel-auto-assign") });
export const option = (scope: Locator, label: string) =>
  scope.locator("button.auto-assign-option", {
    has: scope.page().locator("span", { hasText: new RegExp(`^${label}$`) }),
  });
export const optionLabels = (scope: Locator) => scope.locator("button.auto-assign-option > span");

export async function setSnooze(
  request: APIRequestContext,
  s: Seed,
  category: string,
  month: string,
  snoozed: boolean,
  today: string,
) {
  return request.put(
    `/api/v1/budgets/${s.id}/months/${month}/categories/${s.cat[category]}/target-snooze?today=${today}`,
    { headers: await authHeaders(), data: { snoozed } },
  );
}

/** Categories of a month read (optionally narrowed by a view), as parsed JSON. */
export async function readMonth(
  request: APIRequestContext,
  s: Seed,
  month: string,
  today: string,
  query = "",
  // biome-ignore lint/suspicious/noExplicitAny: parsed JSON
): Promise<any> {
  const res = await request.get(`/api/v1/budgets/${s.id}/months/${month}?today=${today}${query}`, {
    headers: await authHeaders(),
  });
  return (await res.json()).data;
}

export const group = (page: Page) => page.locator(".group-row");
