import { expect } from "vitest";
import { type Json, MONTH, send } from "./bulk-helpers";

export const views = (bid: string, rest = "") => `/api/v1/budgets/${bid}/views${rest}`;

/** Every category of the plan's month read: { id, name, group_id } in grid order. */
export async function planCategories(
  bid: string,
): Promise<{ id: string; name: string; group_id: string }[]> {
  const m = (await (await send(`/api/v1/budgets/${bid}/months/${MONTH}`, "GET")).json()) as Json;
  return m.data.groups.flatMap((g: Json) =>
    g.categories.map((c: Json) => ({ id: c.id, name: c.name, group_id: g.id })),
  );
}

export async function createView(bid: string, name: string, category_ids: string[] = []) {
  const res = await send(views(bid), "POST", { name, category_ids });
  expect(res.status).toBe(201);
  return ((await res.json()) as Json).data.view as Json;
}

export async function listViews(bid: string): Promise<Json> {
  const res = await send(views(bid), "GET");
  expect(res.status).toBe(200);
  return ((await res.json()) as Json).data;
}

export const BUILTINS = ["underfunded", "overfunded", "money_available", "snoozed"];
