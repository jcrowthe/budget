import {
  type Account,
  type AccountCreateRequest,
  AccountCreateResponse,
  AccountListResponse,
  AccountResponse,
  AccountSummaryResponse,
  type AccountUpdateRequest,
} from "@budget/schema/accounts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export const listAccounts = async (budgetId: string, opts: { includeClosed: boolean }) =>
  (
    await apiFetch(
      `/api/v1/budgets/${budgetId}/accounts?include_closed=${opts.includeClosed}` as const,
      { schema: AccountListResponse },
    )
  ).data.accounts;

export const getAccount = async (budgetId: string, accountId: string): Promise<Account> =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/accounts/${encodeURIComponent(accountId)}`, {
      schema: AccountResponse,
    })
  ).data.account;

export const createAccount = async (budgetId: string, input: AccountCreateRequest) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/accounts`, {
      method: "POST",
      body: input,
      idempotencyKey: crypto.randomUUID(),
      schema: AccountCreateResponse,
    })
  ).data;

export const updateAccount = async (
  budgetId: string,
  accountId: string,
  patch: AccountUpdateRequest,
): Promise<Account> =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/accounts/${encodeURIComponent(accountId)}`, {
      method: "PATCH",
      body: patch,
      idempotencyKey: crypto.randomUUID(),
      schema: AccountResponse,
    })
  ).data.account;

export const getAccountSummary = async (budgetId: string) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/account-summary`, {
      schema: AccountSummaryResponse,
    })
  ).data.balances;

/** Cleared, uncleared and working totals over every open account (the All Accounts header). */
export const useAccountSummary = (budgetId: string) =>
  useQuery({
    queryKey: ["account-summary", budgetId],
    queryFn: () => getAccountSummary(budgetId),
    retry: false,
  });

/** All the plan's accounts, closed included, in display order. */
export const useAccounts = (budgetId: string | undefined) =>
  useQuery({
    queryKey: ["accounts", budgetId],
    queryFn: () => listAccounts(budgetId ?? "", { includeClosed: true }),
    enabled: !!budgetId,
  });

export const useAccount = (budgetId: string, accountId: string) =>
  useQuery({
    queryKey: ["accounts", budgetId, accountId],
    queryFn: () => getAccount(budgetId, accountId),
    retry: false,
  });

export function useCreateAccount(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AccountCreateRequest) => createAccount(budgetId, input),
    // Every query of this plan (accounts, months, ...) may have changed: refetch whichever key it uses.
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(budgetId) }),
  });
}

/** Stars or unstars at once; the accounts query (and so the sidebar's STARRED group) follows. */
export function useSetStarred(budgetId: string, accountId: string) {
  const qc = useQueryClient();
  const oneKey = ["accounts", budgetId, accountId];
  const listKey = ["accounts", budgetId];
  return useMutation({
    mutationFn: (starred: boolean) => updateAccount(budgetId, accountId, { starred }),
    onMutate: async (starred) => {
      await qc.cancelQueries({ queryKey: listKey });
      const one = qc.getQueryData<Account>(oneKey);
      const list = qc.getQueryData<Account[]>(listKey);
      if (one) qc.setQueryData<Account>(oneKey, { ...one, starred });
      if (list) {
        qc.setQueryData<Account[]>(
          listKey,
          list.map((a) => (a.id === accountId ? { ...a, starred } : a)),
        );
      }
      return { one, list };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.one) qc.setQueryData(oneKey, ctx.one);
      if (ctx?.list) qc.setQueryData(listKey, ctx.list);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: listKey }),
  });
}

/** The browser's local date as YYYY-MM-DD (the Starting Balance date). */
export function localToday(now: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(now.getFullYear(), 4)}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
