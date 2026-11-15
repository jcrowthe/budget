import {
  type TransactionDetail,
  TransactionListResponse,
  TransactionResponse,
  type TransactionUpdateRequest,
} from "@budget/schema/transactions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

type TransactionList = (typeof TransactionListResponse)["_output"]["data"];

export const listTransactions = async (budgetId: string, accountId: string) =>
  (
    await apiFetch(
      `/api/v1/budgets/${budgetId}/accounts/${encodeURIComponent(accountId)}/transactions`,
      { schema: TransactionListResponse },
    )
  ).data;

export const updateTransaction = async (
  budgetId: string,
  id: string,
  patch: TransactionUpdateRequest,
) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/transactions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
      idempotencyKey: crypto.randomUUID(),
      schema: TransactionResponse,
    })
  ).data.transaction;

export const useAccountTransactions = (budgetId: string, accountId: string) =>
  useQuery({
    queryKey: ["transactions", budgetId, accountId],
    queryFn: () => listTransactions(budgetId, accountId),
    retry: false,
  });

/** Toggles a row between uncleared and cleared; the balances (page, sidebar) refetch when it settles. */
export function useSetCleared(budgetId: string, accountId: string) {
  const qc = useQueryClient();
  const key = ["transactions", budgetId, accountId];
  return useMutation({
    mutationFn: (v: { id: string; cleared: "uncleared" | "cleared" }) =>
      updateTransaction(budgetId, v.id, { cleared: v.cleared }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<TransactionList>(key);
      if (previous) {
        qc.setQueryData<TransactionList>(key, {
          ...previous,
          transactions: previous.transactions.map(
            (t): TransactionDetail => (t.id === v.id ? { ...t, cleared: v.cleared } : t),
          ),
        });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(budgetId) }),
  });
}
