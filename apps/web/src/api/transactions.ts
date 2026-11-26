import {
  type EnterNowRequest,
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
import { recordChange } from "../undo/store";
import { apiFetch } from "./client";
import { keepPreviousInPlan } from "./placeholder";

/** The register records each of its writes on the plan's Undo stack (EXF-530); the raw requests record nothing. */
const record = (budgetId: string) => (id: string) => recordChange(budgetId, id, "register");

type Listed = { transactions: { id: string; cleared: string }[] };

/** `q` is the register search (EXF-528); it is sent only when it is not empty. */
export const listTransactions = async (budgetId: string, accountId: string, q = "") =>
  (
    await apiFetch(
      `/api/v1/budgets/${budgetId}/accounts/${encodeURIComponent(accountId)}/transactions?include=running_balance${q ? `&q=${encodeURIComponent(q)}` : ""}`,
      { schema: TransactionListResponse },
    )
  ).data;

export const listPlanTransactions = async (budgetId: string, q = "") =>
  (
    await apiFetch(
      `/api/v1/budgets/${budgetId}/transactions${q ? `?q=${encodeURIComponent(q)}` : ""}`,
      {
        schema: PlanTransactionListResponse,
      },
    )
  ).data;

export const updateTransaction = async (
  budgetId: string,
  id: string,
  patch: TransactionUpdateRequest,
  onChangeSet?: (id: string) => void,
) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/transactions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: patch,
      onChangeSet,
      idempotencyKey: crypto.randomUUID(),
      schema: TransactionResponse,
    })
  ).data.transaction;

export const createTransaction = async (
  budgetId: string,
  body: TransactionCreateRequest,
  onChangeSet?: (id: string) => void,
) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/transactions`, {
      method: "POST",
      body,
      onChangeSet,
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
        ? updateTransaction(budgetId, v.id, v.body as TransactionUpdateRequest, record(budgetId))
        : createTransaction(budgetId, v.body as TransactionCreateRequest, record(budgetId)),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(budgetId) }),
  });
}

/** The cache key of a register's list; a search adds its text, so it never replaces the full list. */
export const transactionsKey = (budgetId: string, accountId: string | "all", q = "") =>
  q
    ? (["transactions", budgetId, accountId, q] as const)
    : (["transactions", budgetId, accountId] as const);

export const useAccountTransactions = (
  budgetId: string,
  accountId: string,
  enabled = true,
  q = "",
) =>
  useQuery({
    queryKey: transactionsKey(budgetId, accountId, q),
    queryFn: () => listTransactions(budgetId, accountId, q),
    retry: false,
    enabled,
    // Typing does not flash "Loading" between two searches.
    placeholderData: q
      ? keepPreviousInPlan<Awaited<ReturnType<typeof listTransactions>>>(budgetId)
      : undefined,
  });

/** Every account's rows (All Accounts); the balances there are summed over the open accounts. */
export const usePlanTransactions = (budgetId: string, enabled = true, q = "") =>
  useQuery({
    queryKey: transactionsKey(budgetId, "all", q),
    queryFn: () => listPlanTransactions(budgetId, q),
    retry: false,
    enabled,
    placeholderData: q
      ? keepPreviousInPlan<Awaited<ReturnType<typeof listPlanTransactions>>>(budgetId)
      : undefined,
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
      updateTransaction(budgetId, v.id, { cleared: v.cleared }, record(budgetId)),
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

export const bulkTransactions = async (
  budgetId: string,
  body: TransactionBulkRequest,
  onChangeSet?: (id: string) => void,
) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/transactions/bulk`, {
      method: "POST",
      body,
      onChangeSet,
      idempotencyKey: crypto.randomUUID(),
      schema: TransactionBulkResponse,
    })
  ).data;

/** One bulk op; every query of the plan refetches before the promise settles (so a selection can move to new rows). */
export function useBulkTransactions(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TransactionBulkRequest) =>
      bulkTransactions(budgetId, body, record(budgetId)),
    onSuccess: () => invalidatePlan(qc, budgetId),
  });
}

const idsCall = (
  budgetId: string,
  action: "approve" | "reject",
  ids: string[],
  onChangeSet?: (id: string) => void,
) =>
  apiFetch(`/api/v1/budgets/${budgetId}/transactions/${action}`, {
    method: "POST",
    body: { ids },
    onChangeSet,
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
      idsCall(budgetId, v.action, v.ids, record(budgetId)),
    onSuccess: () => invalidatePlan(qc, budgetId),
  });
}

/** Matches an unapproved import and a hand entry (EXF-464): one request. */
export const matchTransactions = async (
  budgetId: string,
  ids: string[],
  onChangeSet?: (id: string) => void,
) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/transactions/match`, {
      method: "POST",
      body: { ids },
      onChangeSet,
      idempotencyKey: crypto.randomUUID(),
      schema: MatchResponse,
    })
  ).data;
export const unmatchTransaction = async (
  budgetId: string,
  id: string,
  onChangeSet?: (id: string) => void,
) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/transactions/${id}/unmatch`, {
      method: "POST",
      onChangeSet,
      idempotencyKey: crypto.randomUUID(),
      schema: UnmatchResponse,
    })
  ).data;

/** Match two selected rows; every query of the plan refetches once (as a bulk action does). */
export function useMatchTransactions(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => matchTransactions(budgetId, ids, record(budgetId)),
    onSuccess: () => invalidatePlan(qc, budgetId),
  });
}

/** Unmatch one matched row; every query of the plan refetches once. */
export function useUnmatchTransaction(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unmatchTransaction(budgetId, id, record(budgetId)),
    onSuccess: () => invalidatePlan(qc, budgetId),
  });
}

/** Sets or clears one row's flag; the row changes at once and the plan refetches when it settles. */
export function useSetFlag(budgetId: string, key: readonly unknown[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; color: FlagColor | null }) =>
      updateTransaction(budgetId, v.id, { flag_color: v.color }, record(budgetId)),
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

/** The cache key of an account's pending bank transactions (EXF-466). */
export const pendingKey = (budgetId: string, accountId: string) =>
  ["pending-transactions", budgetId, accountId] as const;

export const listPendingTransactions = async (budgetId: string, accountId: string) =>
  (
    await apiFetch(
      `/api/v1/budgets/${budgetId}/transactions?status=pending&account_id=${encodeURIComponent(accountId)}`,
      { schema: PlanTransactionListResponse },
    )
  ).data;

/** The bank's pending transactions of a linked account: they affect no balance (the register's Pending section). */
export const usePendingTransactions = (budgetId: string, accountId: string, enabled = true) =>
  useQuery({
    queryKey: pendingKey(budgetId, accountId),
    queryFn: () => listPendingTransactions(budgetId, accountId),
    retry: false,
    enabled,
    placeholderData:
      keepPreviousInPlan<Awaited<ReturnType<typeof listPendingTransactions>>>(budgetId),
  });

export const enterPendingTransaction = async (
  budgetId: string,
  id: string,
  body: EnterNowRequest,
  onChangeSet?: (id: string) => void,
) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/transactions/${encodeURIComponent(id)}/enter-now`, {
      method: "POST",
      body,
      onChangeSet,
      idempotencyKey: crypto.randomUUID(),
      schema: TransactionResponse,
    })
  ).data.transaction;

/** Enter Now (one request, one change set, undoable); every query of the plan refetches when it succeeds. */
export function useEnterPending(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body?: EnterNowRequest }) =>
      enterPendingTransaction(budgetId, v.id, v.body ?? {}, record(budgetId)),
    onSuccess: () => invalidatePlan(qc, budgetId),
  });
}

/** The clock of a row entered from a pending item: hides or shows it (one PATCH, recorded for Undo). */
export function useSetClock(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: "entered" | null }) =>
      updateTransaction(budgetId, v.id, { status: v.status }, record(budgetId)),
    onSuccess: () => invalidatePlan(qc, budgetId),
  });
}
