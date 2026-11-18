import type { APIRequestContext } from "@playwright/test";
import { payeeIds, seedPayees } from "./manage-payees-seed";
import { call } from "./register-seed";

export type RuleRow = {
  id: string;
  payee_id: string;
  kind: "contains" | "is";
  text: string;
  created_at: string;
};

/** The Manage Payees plan plus the payees ZZ Cafe, ZZ Other (both with a transaction) and a hidden ZZ Gone. */
export async function seedRulesPlan(request: APIRequestContext) {
  const s = await seedPayees(request);
  await s.tx("ZZ Cafe");
  await s.tx("ZZ Other");
  await s.tx("ZZ Gone");
  const ids = await payeeIds(request, s.plan);
  await call(request, "PATCH", `/api/v1/budgets/${s.plan}/payees/${ids["ZZ Gone"]}`, {
    hidden: true,
  });
  return { ...s, ids };
}

export const rulesOf = async (request: APIRequestContext, plan: string, payeeId: string) =>
  (await call(request, "GET", `/api/v1/budgets/${plan}/payees/${payeeId}/rename-rules`))
    .rules as RuleRow[];

export const addRuleVia = async (
  request: APIRequestContext,
  plan: string,
  payeeId: string,
  kind: "contains" | "is",
  text: string,
) =>
  (
    await call(request, "POST", `/api/v1/budgets/${plan}/payees/${payeeId}/rename-rules`, {
      kind,
      text,
    })
  ).rule as RuleRow;
