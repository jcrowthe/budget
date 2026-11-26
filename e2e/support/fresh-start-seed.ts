import type { APIRequestContext } from "@playwright/test";
import { authHeaders, testName } from "./auth";
import { call, TODAY } from "./register-seed";

export interface FsPlan {
  plan: string;
  name: string;
  checking: string;
  card: string;
  rent: string;
}

/** A plan of the spec's own: accounts, a group with two categories and a target, assigned amounts, schedules, a payee, a note. */
export async function seedFreshStart(request: APIRequestContext): Promise<FsPlan> {
  const name = testName("FS");
  const { budget } = await call(request, "POST", "/api/v1/budgets", { name });
  const plan = budget.id as string;
  const A = `/api/v1/budgets/${plan}`;
  const acct = async (n: string, type: string, balance: number) =>
    (await call(request, "POST", `${A}/accounts`, { name: n, type, balance })).account.id as string;
  const checking = await acct("ZZ Checking", "checking", 800_000);
  const card = await acct("ZZ Card", "creditCard", 0);
  const group = (await call(request, "POST", `${A}/category_groups`, { name: "ZZ Fresh Group" }))
    .category_group?.id as string | undefined;
  const g =
    group ??
    ((
      await call(request, "GET", `${A}/months/${new Date().toISOString().slice(0, 7)}-01`)
    ).groups.find((x: { name: string }) => x.name === "ZZ Fresh Group").id as string);
  const mk = async (n: string) =>
    (await call(request, "POST", `${A}/categories`, { group_id: g, name: n })).category
      .id as string;
  const rent = await mk("ZZ Rent");
  await mk("ZZ Food");
  await call(request, "PUT", `${A}/categories/${rent}/target`, {
    cadence: "monthly",
    behavior: "set_aside",
    amount: 100_000,
  });
  await call(request, "PATCH", `${A}/categories/${rent}`, { note: "ZZ rent note" });
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  await call(request, "PATCH", `${A}/months/${month}/categories/${rent}`, { assigned: 100_000 });
  const tx = (body: Record<string, unknown>) =>
    call(request, "POST", `${A}/transactions`, {
      account_id: checking,
      date: TODAY,
      inflow_to_ready_to_assign: false,
      ...body,
    });
  await tx({ amount: -40_000, payee_name: "ZZ Grocer", category_id: rent });
  await tx({ amount: -15_000, payee_name: "ZZ Grocer", category_id: rent });
  const date = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const sched = (body: Record<string, unknown>) =>
    call(request, "POST", `${A}/scheduled-transactions`, {
      account_id: checking,
      date_first: date,
      frequency: "monthly",
      ...body,
    });
  await sched({ amount: -50_000, transfer_account_id: card, memo: "ZZ transfer" });
  await sched({
    amount: -30_000,
    payee_name: "ZZ Market",
    memo: "ZZ split",
    subtransactions: [
      { amount: -10_000, category_id: rent },
      { amount: -20_000, category_id: rent },
    ],
  });
  return { plan, name, checking, card, rent };
}

export const plansApi = async (request: APIRequestContext) =>
  (await (await request.get("/api/v1/budgets", { headers: await authHeaders() })).json()).data
    .budgets as { id: string; name: string }[];
