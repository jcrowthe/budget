import { env } from "cloudflare:test";
import { expect } from "vitest";
import { createBudget } from "../src/services/budgets";
import type { Json } from "./bulk-helpers";
import { json } from "./helpers";
import { mcpRpc } from "./surface";

// EXF-541: a ZZ-TEST plan with a checking account, loans and their categories, through the API.
export const actor = "user:tester@localhost";
export const NOV = "2026-11-01";
export const D15 = "2026-11-15";
export const send = (path: string, method: string, body?: unknown) => json(path, { method }, body);
export const rand = () => crypto.randomUUID().slice(0, 8);

export async function newPlan() {
  return (await createBudget(env, actor, { name: `ZZ-TEST ${rand()}` })).id;
}

export async function openAccount(bid: string, body: Json) {
  const res = await send(`/api/v1/budgets/${bid}/accounts`, "POST", {
    date: D15,
    ...body,
    name: `ZZ ${body.name} ${rand()}`,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as Json).data.account as Json;
}

export const monthRead = async (bid: string, m = NOV) =>
  ((await (await json(`/api/v1/budgets/${bid}/months/${m}`)).json()) as Json).data;

export const findCategory = async (bid: string, name: string) =>
  (await monthRead(bid)).groups
    .flatMap((g: Json) => g.categories)
    .find((c: Json) => c.name === name) as Json;

export const MORTGAGE = {
  name: "Mortgage",
  type: "mortgage",
  balance: 200000000,
  interest_rate: "6",
  minimum_payment: 1500000,
  escrow_amount: 300000,
};

export async function world(paired = true) {
  const bid = await newPlan();
  const checking = await openAccount(bid, {
    name: "Checking",
    type: "checking",
    balance: 10000000,
  });
  const mortgage = await openAccount(bid, {
    ...MORTGAGE,
    ...(paired ? { new_category: { name: "Mortgage Pay", new_group_name: "ZZ Loans" } } : {}),
  });
  const auto = await openAccount(bid, {
    name: "Auto",
    type: "autoLoan",
    balance: 15000000,
    interest_rate: "4.5",
    minimum_payment: 350000,
  });
  const medical = await openAccount(bid, {
    name: "Medical",
    type: "medicalDebt",
    balance: 1000000,
    interest_rate: "0",
    minimum_payment: 100000,
  });
  return { bid, checking, mortgage, auto, medical };
}

export const pay = (bid: string, loan: string, body: Json) =>
  send(`/api/v1/budgets/${bid}/accounts/${loan}/payments`, "POST", body);

export async function summary(bid: string, loan: string, m: string | null = NOV) {
  const res = await json(
    `/api/v1/budgets/${bid}/accounts/${loan}/summary${m ? `?month=${m}` : ""}`,
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as Json).data as Json;
}

export async function tool(name: string, args: Json) {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result as Json;
}

/** A new visible category in a new group; its id. */
export async function makeCategory(bid: string, name = "ZZ Cat") {
  const g = (await (
    await send(`/api/v1/budgets/${bid}/category_groups`, "POST", { name: `ZZ Group ${rand()}` })
  ).json()) as Json;
  const c = (await (
    await send(`/api/v1/budgets/${bid}/categories`, "POST", {
      group_id: g.data.category_group.id,
      name: `${name} ${rand()}`,
    })
  ).json()) as Json;
  return { id: c.data.category.id as string, group_id: g.data.category_group.id as string };
}
