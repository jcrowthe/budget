import {
  PAYEE_BULK_MAX,
  PayeeBulkResponse,
  PayeeDeleteResponse,
  PayeeListResponse,
  PayeeResponse,
  PayeeTransactionsResponse,
} from "@budget/schema/payees";
import { type QueryClient, useQuery } from "@tanstack/react-query";
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

const base = (b: string) => `/api/v1/budgets/${b}/payees` as const;

/** Rename and/or hide one payee. */
export const updatePayee = async (
  b: string,
  id: string,
  body: { name?: string; hidden?: boolean },
) =>
  (
    await apiFetch(`${base(b)}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body,
      schema: PayeeResponse,
    })
  ).data.payee;

/** Delete one payee; its transactions go to the replacement, or to no payee. */
export const deletePayee = async (b: string, id: string, replacementId: string | null) =>
  (
    await apiFetch(
      `${base(b)}/${encodeURIComponent(id)}${
        replacementId ? `?replacement_payee_id=${encodeURIComponent(replacementId)}` : ""
      }`,
      { method: "DELETE", schema: PayeeDeleteResponse },
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
    });
  }
}

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

const VIEWS = new Set([
  "payees",
  "transactions",
  "scheduled-transactions",
  "category-activity",
  "report-transactions",
  "payee-transactions",
]);

/** After a change: every screen that shows payees or their names refetches once, without a reload. */
export const invalidatePayeeViews = (qc: QueryClient, b: string) =>
  qc.invalidateQueries({
    predicate: (q) => VIEWS.has(String(q.queryKey[0])) && q.queryKey.includes(b),
  });
