import {
  type Account,
  type AccountCreateRequest,
  AccountCreateResponse,
  AccountListResponse,
  AccountResponse,
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

/** The plan's open accounts, in display order. */
export const useAccounts = (budgetId: string | undefined) =>
  useQuery({
    queryKey: ["accounts", budgetId],
    queryFn: () => listAccounts(budgetId ?? "", { includeClosed: false }),
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

/** The browser's local date as YYYY-MM-DD (the Starting Balance date). */
export function localToday(now: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(now.getFullYear(), 4)}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
