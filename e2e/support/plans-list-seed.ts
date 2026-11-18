import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect } from "../fixtures";
import { authHeaders, testName } from "./auth";

export type Own = { id: string; name: string };

/** A plan of the spec's own, with a unique name, made through the API. */
export async function ownPlan(
  request: APIRequestContext,
  label: string,
  name?: string,
): Promise<Own> {
  const n = name ?? testName(label);
  const res = await request.post("/api/v1/budgets", {
    headers: await authHeaders(),
    data: { name: n },
  });
  expect(res.status()).toBe(201);
  return { id: (await res.json()).data.budget.id as string, name: n };
}

/** Records that the plan was opened and returns the server's stamp. */
export async function markOpened(request: APIRequestContext, id: string): Promise<string> {
  const res = await request.patch(`/api/v1/budgets/${id}`, {
    headers: await authHeaders(),
    data: { opened: true },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()).data.budget.last_opened_at as string;
}

/** Opens the plans in turn, each strictly later than the one before. */
export async function openInOrder(request: APIRequestContext, plans: Own[]) {
  let last = "";
  for (const p of plans) {
    await expect
      .poll(async () => {
        const stamp = await markOpened(request, p.id);
        const fresh = stamp > last;
        if (fresh) last = stamp;
        return fresh;
      })
      .toBe(true);
  }
}

export const getPlan = async (request: APIRequestContext, id: string) =>
  request.get(`/api/v1/budgets/${id}`, { headers: await authHeaders() });

export const stampOf = async (request: APIRequestContext, id: string) =>
  ((await (await getPlan(request, id)).json()).data.budget.last_opened_at ?? "") as string;

export const plansList = (page: Page) => page.getByRole("list", { name: "Plans", exact: true });

/** The card (list item) of the plan with this name. */
export const card = (page: Page, name: string): Locator =>
  plansList(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name, exact: true }) });

export const cardLink = (page: Page, name: string) =>
  plansList(page).getByRole("link", { name, exact: true });
