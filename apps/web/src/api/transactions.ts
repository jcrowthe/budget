import {
  type FlagColor,
  PlanTransactionListResponse,
  type TransactionBulkRequest,
  TransactionBulkResponse,
  type TransactionCreateRequest,
  TransactionListResponse,
  TransactionResponse,
  TransactionsResponse,
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

const invalidatePlan = (qc: ReturnType<typeof useQueryClient>, budgetId: string) =>
  qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(budgetId) });

export const bulkTransactions = async (budgetId: string, body: TransactionBulkRequest) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/transactions/bulk`, {
      method: "POST",
      body,
      idempotencyKey: crypto.randomUUID(),
      schema: TransactionBulkResponse,
    })
  ).data;

/** One bulk op; every query of the plan refetches before the promise settles (so a selection can move to new rows). */
export function useBulkTransactions(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TransactionBulkRequest) => bulkTransactions(budgetId, body),
    onSuccess: () => invalidatePlan(qc, budgetId),
  });
}

const idsCall = (budgetId: string, action: "approve" | "reject", ids: string[]) =>
  apiFetch(`/api/v1/budgets/${budgetId}/transactions/${action}`, {
    method: "POST",
    body: { ids },
    idempotencyKey: crypto.randomUUID(),
    schema: TransactionsResponse,
  });

export const approveTransactions = (budgetId: string, ids: string[]) =>
  idsCall(budgetId, "approve", ids);
export const rejectTransactions = (budgetId: string, ids: string[]) =>
  idsCall(budgetId, "reject", ids);

/** Approve or reject a selection of imported rows. */
export function useApproveReject(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { action: "approve" | "reject"; ids: string[] }) =>
      idsCall(budgetId, v.action, v.ids),
    onSuccess: () => invalidatePlan(qc, budgetId),
  });
}

/** Sets or clears one row's flag; the row changes at once and the plan refetches when it settles. */
export function useSetFlag(budgetId: string, key: readonly unknown[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; color: FlagColor | null }) =>
      updateTransaction(budgetId, v.id, { flag_color: v.color }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<{ transactions: { id: string }[] }>(key);
      if (previous) {
        qc.setQueryData(key, {
          ...previous,
          transactions: previous.transactions.map((t) =>
            t.id === v.id ? { ...t, flag_color: v.color } : t,
          ),
        });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => invalidatePlan(qc, budgetId),
  });
}

/** Downloads the CSV of the selected rows under `fileName`. */
export async function downloadExport(
  budgetId: string,
  ids: readonly string[],
  fileName: string,
): Promise<void> {
  const res = await fetch(
    `/api/v1/budgets/${budgetId}/transactions/export?ids=${ids.map(encodeURIComponent).join(",")}`,
    { credentials: "same-origin" },
  );
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
