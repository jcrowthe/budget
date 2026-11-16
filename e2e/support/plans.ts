import type { Page } from "@playwright/test";

export type PlanRow = { id: string; name: string; last_opened_at: string | null };

/**
 * Every GET /api/v1/budgets this page makes returns only the plans `keep` accepts (real data, filtered).
 * The suite runs fullyParallel against one database: other specs create and open plans at any time.
 * `served` holds each filtered list in the order it was served. Pair with
 * `test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }))`.
 */
export async function showOnlyPlans(
  page: Page,
  keep: (p: PlanRow) => boolean,
): Promise<{ served: PlanRow[][] }> {
  const served: PlanRow[][] = [];
  await page.route("**/api/v1/budgets", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    const body = await res.json();
    body.data.budgets = body.data.budgets.filter(keep);
    served.push(body.data.budgets.map((p: PlanRow) => ({ ...p })));
    return route.fulfill({ response: res, json: body });
  });
  return { served };
}
