import {
  PAYEE_BULK_MAX,
  type Payee,
  PayeeBulkResponse,
  PayeeCombineResponse,
  PayeeDeleteResponse,
  PayeeListResponse,
  PayeeRecentResponse,
  PayeeResponse,
  PayeeTransactionsResponse,
  type PayeeUpdate,
} from "@budget/schema/payees";
import {
  type PayeeRenameRule,
  RenameRuleListResponse,
  RenameRuleResponse,
} from "@budget/schema/rename-rules";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { recordChange } from "../undo/store";
import { apiFetch } from "./client";
import { keepPreviousInPlan } from "./placeholder";

/** Every payee of the plan, hidden and system ones included: the picker filters them itself. */
export const listPayees = async (budgetId: string) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/payees?include_hidden=true`, {
      schema: PayeeListResponse,
    })
  ).data.payees;

export const usePayees = (budgetId: string) =>
  useQuery({
    queryKey: ["payees", budgetId],
    queryFn: () => listPayees(budgetId),
    staleTime: 30_000,
  });

/** The dialog's writes are its own Undo/Redo entries (EXF-510 AC10). */
const recorded = (b: string) => ({
  onChangeSet: (id: string) => recordChange(b, id, "payees"),
});

const base = (b: string) => `/api/v1/budgets/${b}/payees` as const;

/** Rename and/or hide one payee. */
export const updatePayee = async (b: string, id: string, body: PayeeUpdate) =>
  (
    await apiFetch(`${base(b)}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
      schema: PayeeResponse,
      ...recorded(b),
    })
  ).data.payee;

/** Save the payee's category mode and fixed choice; the answer replaces the payee in the cached list. */
export async function savePayeeCategory(
  qc: QueryClient,
  b: string,
  id: string,
  body: Pick<
    PayeeUpdate,
    "category_mode" | "fixed_category_id" | "fixed_inflow_to_ready_to_assign"
  >,
) {
  const answer = (
    await apiFetch(`${base(b)}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
      idempotencyKey: crypto.randomUUID(),
      schema: PayeeResponse,
      ...recorded(b),
    })
  ).data.payee;
  qc.setQueryData<Payee[]>(["payees", b], (list) => list?.map((p) => (p.id === id ? answer : p)));
  return answer;
}

/** The payee's last 3 counted transactions, newest first; off while no payee is open. */
export const usePayeeRecentTransactions = (b: string, id: string | null) =>
  useQuery({
    queryKey: ["payee-recent-transactions", b, id],
    queryFn: async () =>
      (
        await apiFetch(
          `${base(b)}/${encodeURIComponent(id as string)}/recent-transactions?limit=3`,
          { schema: PayeeRecentResponse },
        )
      ).data.transactions,
    enabled: id !== null,
    placeholderData: keepPreviousInPlan(b),
  });

/** Delete one payee; its transactions go to the replacement, or to no payee. */
export const deletePayee = async (b: string, id: string, replacementId: string | null) =>
  (
    await apiFetch(
      `${base(b)}/${encodeURIComponent(id)}${
        replacementId ? `?replacement_payee_id=${encodeURIComponent(replacementId)}` : ""
      }`,
      { method: "DELETE", schema: PayeeDeleteResponse, ...recorded(b) },
    )
  ).data.deleted;

/** Hide, unhide or delete several payees, in chunks of the API's limit sent one after another. */
export async function bulkPayees(
  b: string,
  body: { ids: string[]; action: "hide" | "unhide" | "delete"; replacementId?: string | null },
) {
  for (let i = 0; i < body.ids.length; i += PAYEE_BULK_MAX) {
    await apiFetch(`${base(b)}/bulk`, {
      method: "POST",
      body: {
        payee_ids: body.ids.slice(i, i + PAYEE_BULK_MAX),
        action: body.action,
        ...(body.replacementId ? { replacement_payee_id: body.replacementId } : {}),
      },
      schema: PayeeBulkResponse,
      ...recorded(b),
    });
  }
}

/** Combine and Rename: the payees become one, `targetId` (one of them) survives under `name`. */
export const combinePayees = async (
  b: string,
  body: { ids: string[]; name: string; targetId: string },
) =>
  (
    await apiFetch(`${base(b)}/combine`, {
      method: "POST",
      body: { payee_ids: body.ids, name: body.name, target_payee_id: body.targetId },
      schema: PayeeCombineResponse,
      ...recorded(b),
    })
  ).data;

/** The payee's transactions for the popover; off while no payee is open. */
export const usePayeeTransactions = (b: string, id: string | null) =>
  useQuery({
    queryKey: ["payee-transactions", b, id],
    queryFn: async () =>
      (
        await apiFetch(`${base(b)}/${encodeURIComponent(id as string)}/transactions`, {
          schema: PayeeTransactionsResponse,
        })
      ).data,
    enabled: id !== null,
    placeholderData: keepPreviousInPlan(b),
  });

const ruleBase = (b: string, id: string) =>
  `${base(b)}/${encodeURIComponent(id)}/rename-rules` as const;

/** A payee's renaming rules, oldest first; off while no ordinary payee is selected. */
export const usePayeeRenameRules = (b: string, id: string | null) =>
  useQuery({
    queryKey: ["payee-rename-rules", b, id],
    queryFn: async () =>
      (await apiFetch(ruleBase(b, id as string), { schema: RenameRuleListResponse })).data.rules,
    enabled: id !== null,
    placeholderData: keepPreviousInPlan(b),
  });

export const createRenameRule = async (
  b: string,
  id: string,
  body: { kind: "contains" | "is"; text: string },
) =>
  (
    await apiFetch(ruleBase(b, id), {
      method: "POST",
      body,
      idempotencyKey: crypto.randomUUID(),
      schema: RenameRuleResponse,
      ...recorded(b),
    })
  ).data.rule;

export const updateRenameRule = async (
  b: string,
  id: string,
  ruleId: string,
  body: { kind?: "contains" | "is"; text?: string },
) =>
  (
    await apiFetch(`${ruleBase(b, id)}/${encodeURIComponent(ruleId)}`, {
      method: "PATCH",
      body,
      idempotencyKey: crypto.randomUUID(),
      schema: RenameRuleResponse,
      ...recorded(b),
    })
  ).data.rule;

export const deleteRenameRule = async (b: string, id: string, ruleId: string) =>
  (
    await apiFetch(`${ruleBase(b, id)}/${encodeURIComponent(ruleId)}`, {
      method: "DELETE",
      idempotencyKey: crypto.randomUUID(),
      schema: RenameRuleResponse,
      ...recorded(b),
    })
  ).data.rule;

/** A rule change's answer, written into the rules list and the payee's `has_rules`: nothing is fetched again. */
export function applyRuleChange(
  qc: QueryClient,
  b: string,
  payeeId: string,
  change: (rules: PayeeRenameRule[]) => PayeeRenameRule[],
) {
  const key = ["payee-rename-rules", b, payeeId];
  const next = change(qc.getQueryData<PayeeRenameRule[]>(key) ?? []);
  qc.setQueryData(key, next);
  qc.setQueryData<Payee[]>(["payees", b], (list) =>
    list?.map((p) => (p.id === payeeId ? { ...p, has_rules: next.length > 0 } : p)),
  );
}

const VIEWS = new Set([
  "payees",
  "payee-rename-rules",
  "transactions",
  "scheduled-transactions",
  "category-activity",
  "report-transactions",
  "payee-transactions",
  "payee-recent-transactions",
]);

/** After a change: every screen that shows payees or their names refetches once, without a reload. */
export const invalidatePayeeViews = (qc: QueryClient, b: string) =>
  qc.invalidateQueries({
    predicate: (q) => VIEWS.has(String(q.queryKey[0])) && q.queryKey.includes(b),
  });
