import {
  type FlagColor,
  MatchResponse,
  PlanTransactionListResponse,
  type TransactionBulkRequest,
  TransactionBulkResponse,
  type TransactionCreateRequest,
  TransactionListResponse,
  TransactionResponse,
  TransactionsResponse,
  type TransactionUpdateRequest,
  UnmatchResponse,
} from "@budget/schema/transactions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

type Listed = { transactions: { id: string; cleared: string }[] };

export const listTransactions = async (budgetId: string, accountId: string) =>
  (
    await apiFetch(
      `/api/v1/budgets/${budgetId}/accounts/${encodeURIComponent(accountId)}/transactions?include=running_balance`,
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

type Balances = { cleared: number; uncleared: number; working: number };
type Held = { amount: number; account_id: string; cleared: string };
type AccountBalance = { cleared_balance: number; uncleared_balance: number };

/** `useIsMutating` filter for the register's clear toggles of a plan (EXF-724). */
export const setClearedKey = (budgetId: string) => ["set-cleared", budgetId] as const;

/**
 * Toggles a row between uncleared and cleared. The row, the account's cleared and uncleared balances (the header
 * and the reconcile bar read them) and the list's balances change at once; everything refetches when it settles.
 */
export function useSetCleared(budgetId: string, key: readonly unknown[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: setClearedKey(budgetId),
    mutationFn: (v: { id: string; cleared: "uncleared" | "cleared" }) =>
      updateTransaction(budgetId, v.id, { cleared: v.cleared }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Listed & { balances?: Balances }>(key);
      const row = previous?.transactions.find((t) => t.id === v.id) as Held | undefined;
      let accountKey: readonly unknown[] | undefined;
      let previousAccount: AccountBalance | undefined;
      if (previous) {
        const moved = row && row.cleared !== v.cleared && row.cleared !== "reconciled";
        // The balance moves by the row's amount: into cleared on a clear, back out on an unclear.
        const delta = moved ? (v.cleared === "cleared" ? row.amount : -row.amount) : 0;
        qc.setQueryData(key, {
          ...previous,
          transactions: previous.transactions.map((t) =>
            t.id === v.id ? { ...t, cleared: v.cleared } : t,
          ),
          ...(previous.balances
            ? {
                balances: {
                  ...previous.balances,
                  cleared: previous.balances.cleared + delta,
                  uncleared: previous.balances.uncleared - delta,
                },
              }
            : {}),
        });
        if (row && delta !== 0) {
          accountKey = ["accounts", budgetId, row.account_id];
          await qc.cancelQueries({ queryKey: accountKey });
          previousAccount = qc.getQueryData<AccountBalance>(accountKey);
          if (previousAccount) {
            qc.setQueryData(accountKey, {
              ...previousAccount,
              cleared_balance: previousAccount.cleared_balance + delta,
              uncleared_balance: previousAccount.uncleared_balance - delta,
            });
          }
        }
      }
      return { previous, accountKey, previousAccount };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      if (ctx?.accountKey && ctx.previousAccount)
        qc.setQueryData(ctx.accountKey, ctx.previousAccount);
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

/** Matches an unapproved import and a hand entry (EXF-464): one request. */
export const matchTransactions = async (budgetId: string, ids: string[]) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/transactions/match`, {
      method: "POST",
      body: { ids },
      idempotencyKey: crypto.randomUUID(),
      schema: MatchResponse,
    })
  ).data;
export const unmatchTransaction = async (budgetId: string, id: string) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/transactions/${id}/unmatch`, {
      method: "POST",
      idempotencyKey: crypto.randomUUID(),
      schema: UnmatchResponse,
    })
  ).data;

/** Match two selected rows; every query of the plan refetches once (as a bulk action does). */
export function useMatchTransactions(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => matchTransactions(budgetId, ids),
    onSuccess: () => invalidatePlan(qc, budgetId),
  });
}

/** Unmatch one matched row; every query of the plan refetches once. */
export function useUnmatchTransaction(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unmatchTransaction(budgetId, id),
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
