import type { Page } from "@playwright/test";
import { MonthDetailResponse } from "../packages/schema/src/months";

// Made-up amounts, in milliunits. Fixture F: the plan grid's acceptance data (docs/plan-grid-design.md).
const cat = (
  id: string,
  name: string,
  v: [carried: number, assigned: number, activity: number, available: number],
  extra: Record<string, unknown> = {},
  hidden = false,
) => ({
  id,
  name,
  sort: 0,
  hidden,
  kind: null,
  account_id: null,
  cash_spending: v[2],
  credit_spending: 0,
  overspent: v[3] < 0 ? { cash: -v[3], credit: 0 } : null,
  state: v[3] < 0 ? "cash_overspent" : "ok",
  carried: v[0],
  assigned: v[1],
  activity: v[2],
  available: v[3],
  target: null,
  note: null,
  target_snoozed: false,
  payment: null,
  ...extra,
});

export function fixtureF(month: string) {
  const body = {
    data: {
      month,
      note: null,
      ready_to_assign: 0,
      rta_breakdown: {
        left_over_from_previous: 0,
        inflows: 0,
        cash_overspending_previous: 0,
        assigned_in_month: 0,
        assigned_in_future: 0,
      },
      groups: [
        {
          id: "g-bills",
          name: "Bills",
          sort: 0,
          hidden: false,
          kind: null,
          collapsed: false,
          assigned: 270000,
          activity: -150000,
          available: 120000,
          categories: [
            cat("c-rent", "Rent", [0, 230000, -60000, 170000]),
            cat("c-phone", "Phone", [0, 0, -50000, -50000]),
            cat("c-util", "Utilities", [0, 40000, -40000, 0]),
            cat("c-secret", "Secret stash", [0, 10000, 0, 10000], {}, true),
          ],
        },
        {
          id: "g-needs",
          name: "Needs",
          sort: 1,
          hidden: false,
          kind: null,
          collapsed: false,
          assigned: 100000,
          activity: -30000,
          available: 95000,
          categories: [
            // An unknown field the grid must ignore.
            cat("c-groc", "Groceries", [25000, 100000, -30000, 95000], { future_field: 1 }),
            cat("c-emerg", "Emergency fund", [0, 0, 0, 0]),
          ],
        },
        {
          id: "g-hidden",
          name: "Old stuff",
          sort: 2,
          hidden: true,
          kind: null,
          collapsed: false,
          assigned: 0,
          activity: 0,
          available: 0,
          categories: [cat("c-old", "Old thing", [0, 0, 0, 0])],
        },
      ],
      uncategorized: { activity: -12340, available: -12340 },
    },
  };
  MonthDetailResponse.parse(body);
  return body;
}

export function fixtureF0(month: string) {
  const body = { data: { ...fixtureF(month).data, uncategorized: null } };
  MonthDetailResponse.parse(body);
  return body;
}

/** Answers the month request of the page with `body`, after `delayMs`. Send the raw object: parse would strip extras. */
export async function stub(page: Page, body: unknown, status = 200, delayMs = 0) {
  await page.route("**/api/v1/budgets/*/months/*", async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
}
