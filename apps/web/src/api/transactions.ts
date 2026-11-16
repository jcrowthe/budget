import {
  PlanTransactionListResponse,
  type TransactionCreateRequest,
  TransactionListResponse,
  TransactionResponse,
  type TransactionUpdateRequest,
} from "@budget/schema/transactions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

type Listed = { transactions: { id: string; cleared: string }[] };

export const listTransactions = async (budgetId: string, accountId: string) =>
  (
    await apiFetch(
      `/api/v1/budgets/${budgetId}/accounts/${encodeURIComponent(accountId)}/transactions`,
      { schema: TransactionListResponse },
    )
  ).data;

export const listPlanTransactions = async (budgetId: string) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/transactions`, {
      schema: PlanTransactionListResponse,
    })
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

export const createTransaction = async (budgetId: string, body: TransactionCreateRequest) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/transactions`, {
      method: "POST",
      body,
      idempotencyKey: crypto.randomUUID(),
      schema: TransactionResponse,
    })
  ).data.transaction;

/** Creates (no `id`) or changes (with `id`) a row; every query of the plan refetches when it succeeds. */
export function useSaveTransaction(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id?: string; body: TransactionCreateRequest | TransactionUpdateRequest }) =>
      v.id
        ? updateTransaction(budgetId, v.id, v.body as TransactionUpdateRequest)
        : createTransaction(budgetId, v.body as TransactionCreateRequest),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(budgetId) }),
  });
}

export const useAccountTransactions = (budgetId: string, accountId: string, enabled = true) =>
  useQuery({
    queryKey: ["transactions", budgetId, accountId],
    queryFn: () => listTransactions(budgetId, accountId),
    retry: false,
    enabled,
  });

/** Every account's rows (All Accounts); the balances there are summed over the open accounts. */
export const usePlanTransactions = (budgetId: string, enabled = true) =>
  useQuery({
    queryKey: ["transactions", budgetId, "all"],
    queryFn: () => listPlanTransactions(budgetId),
    retry: false,
    enabled,
  });

/** Toggles a row between uncleared and cleared; the balances (page, sidebar) refetch when it settles. */
export function useSetCleared(budgetId: string, key: readonly unknown[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; cleared: "uncleared" | "cleared" }) =>
      updateTransaction(budgetId, v.id, { cleared: v.cleared }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Listed>(key);
      if (previous) {
        qc.setQueryData<Listed>(key, {
          ...previous,
          transactions: previous.transactions.map((t) =>
            t.id === v.id ? { ...t, cleared: v.cleared } : t,
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
