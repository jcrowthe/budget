import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "../fixtures";
import { authHeaders, testName } from "./auth";
import { realClick } from "./real-click";

export const side = (page: Page) => page.getByRole("navigation", { name: "Sidebar" });
export const newPlanDialog = (page: Page) =>
  page.getByRole("dialog", { name: "New Plan", exact: true });
export const newPlanField = (page: Page, label: string) =>
  newPlanDialog(page).getByLabel(label, { exact: true });

/** A plan of the spec's own, made through the API. */
export async function ownPlan(request: APIRequestContext, label: string) {
  const name = testName(label);
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name },
  });
  expect(res.status()).toBe(201);
  return { name, id: (await res.json()).data.budget.id as string };
}

/** Plan menu, then New Plan, both with a real mouse. */
export async function openNewPlan(page: Page, fromName: string) {
  await realClick(page, side(page).getByRole("button", { name: fromName, exact: true }));
  await realClick(
    page,
    page
      .getByRole("menu", { name: "Plan", exact: true })
      .getByRole("menuitem", { name: "New Plan", exact: true }),
  );
  await expect(newPlanDialog(page)).toBeVisible();
}
