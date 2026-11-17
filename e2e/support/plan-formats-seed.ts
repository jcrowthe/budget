import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "../fixtures";
import { authHeaders } from "./auth";
import { realClick } from "./real-click";
import { call, MONTH, seed, TODAY } from "./register-seed";

export { MONTH, TODAY };

/**
 * A plan of its own for the plan-formats specs: ZZ Checking ($2,500.00) and D4 Groceries with nothing assigned and
 * an outflow of 1,234.56 in it, so its Available is -1,234,560 milliunits.
 */
export async function seedFormats(request: APIRequestContext) {
  const s = await seed(request);
  await call(
    request,
    "PATCH",
    `/api/v1/budgets/${s.plan}/months/${MONTH}/categories/${s.category}`,
    {
      assigned: 0,
    },
  );
  await call(request, "POST", `/api/v1/budgets/${s.plan}/transactions`, {
    account_id: s.checking,
    date: TODAY,
    amount: -1234560,
    category_id: s.category,
    payee_name: "ZZ Payee",
  });
  const { budget } = await call(request, "GET", `/api/v1/budgets/${s.plan}`);
  return { ...s, name: budget.name as string };
}

export const budgetOf = async (request: APIRequestContext, plan: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}`)).budget as {
    name: string;
    currency_format: Record<string, unknown>;
    date_format: { format: string };
  };

export async function patchPlan(request: APIRequestContext, plan: string, data: unknown) {
  const res = await request.patch(`/api/v1/budgets/${plan}`, {
    headers: await authHeaders(),
    data,
  });
  expect(res.ok(), `PATCH plan: ${res.status()}`).toBe(true);
}

export const sidebar = (page: Page) => page.getByRole("navigation", { name: "Sidebar" });
export const settingsDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Plan Settings", exact: true });

/** The plan menu, then Plan Settings, both with a real mouse. */
export async function openSettings(page: Page, name: string) {
  await realClick(page, sidebar(page).getByRole("button", { name, exact: true }));
  await realClick(
    page,
    page
      .getByRole("menu", { name: "Plan", exact: true })
      .getByRole("menuitem", { name: "Plan Settings", exact: true }),
  );
  await expect(settingsDialog(page)).toBeVisible();
}

export const field = (page: Page, label: string) =>
  settingsDialog(page).getByLabel(label, { exact: true });

/** Apply Settings and wait for the plan to hold the format. */
export async function apply(page: Page) {
  const done = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && /\/api\/v1\/budgets\/[^/]+$/.test(r.url()),
  );
  await realClick(
    page,
    settingsDialog(page).getByRole("button", { name: "Apply Settings", exact: true }),
  );
  expect((await done).ok()).toBe(true);
  await expect(settingsDialog(page)).toHaveCount(0);
}

export async function applyFormat(
  page: Page,
  f: { currency?: string; numberFormat?: string; placement?: string; date?: string },
) {
  if (f.currency) await field(page, "Currency").selectOption(f.currency);
  if (f.numberFormat) await field(page, "Number Format").selectOption(f.numberFormat);
  if (f.placement) await field(page, "Currency Placement").selectOption(f.placement);
  if (f.date) await field(page, "Date Format").selectOption(f.date);
  await apply(page);
}
