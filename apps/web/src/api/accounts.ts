import {
  type Account,
  type AccountAdjustBalanceRequest,
  AccountAdjustmentResponse,
  type AccountCloseRequest,
  type AccountCreateRequest,
  AccountCreateResponse,
  AccountDeleteResponse,
  AccountListResponse,
  type AccountOrderRequest,
  AccountResponse,
  AccountSummaryResponse,
  type AccountUpdateRequest,
} from "@budget/schema/accounts";
import {
  type ReconcileRequest as ReconcileRequestInput,
  ReconcileResponse,
} from "@budget/schema/reconcile";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { recordChange } from "../undo/store";
import { ApiError, apiFetch } from "./client";

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
  onChangeSet?: (id: string) => void,
): Promise<Account> =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/accounts/${encodeURIComponent(accountId)}`, {
      method: "PATCH",
      body: patch,
      onChangeSet,
      idempotencyKey: crypto.randomUUID(),
      schema: AccountResponse,
    })
  ).data.account;

const accountUrl = (budgetId: string, accountId: string) =>
  `/api/v1/budgets/${budgetId}/accounts/${encodeURIComponent(accountId)}` as const;

export const adjustAccountBalance = async (
  budgetId: string,
  accountId: string,
  body: AccountAdjustBalanceRequest,
) =>
  (
    await apiFetch(`${accountUrl(budgetId, accountId)}/adjust-balance`, {
      method: "POST",
      body,
      idempotencyKey: crypto.randomUUID(),
      schema: AccountAdjustmentResponse,
    })
  ).data;

export const closeAccount = async (
  budgetId: string,
  accountId: string,
  body: AccountCloseRequest,
) =>
  (
    await apiFetch(`${accountUrl(budgetId, accountId)}/close`, {
      method: "POST",
      body,
      idempotencyKey: crypto.randomUUID(),
      schema: AccountAdjustmentResponse,
    })
  ).data;

export const reopenAccount = async (budgetId: string, accountId: string): Promise<Account> =>
  (
    await apiFetch(`${accountUrl(budgetId, accountId)}/reopen`, {
      method: "POST",
      idempotencyKey: crypto.randomUUID(),
      schema: AccountResponse,
    })
  ).data.account;

export const deleteAccount = async (budgetId: string, accountId: string) =>
  (
    await apiFetch(accountUrl(budgetId, accountId), {
      method: "DELETE",
      idempotencyKey: crypto.randomUUID(),
      schema: AccountDeleteResponse,
    })
  ).data;

export const reconcileAccount = async (
  budgetId: string,
  accountId: string,
  body: ReconcileRequestInput,
) =>
  (
    await apiFetch(`${accountUrl(budgetId, accountId)}/reconcile`, {
      method: "POST",
      body,
      idempotencyKey: crypto.randomUUID(),
      schema: ReconcileResponse,
    })
  ).data;

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

/** Every query of the plan (accounts, months, register, ...) may have changed: refetch whichever key it uses. */
function useInvalidatePlan(budgetId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(budgetId) });
}

export function useUpdateAccount(budgetId: string, accountId: string) {
  const invalidate = useInvalidatePlan(budgetId);
  return useMutation({
    mutationFn: (patch: AccountUpdateRequest) => updateAccount(budgetId, accountId, patch),
    onSuccess: invalidate,
  });
}

export function useAdjustBalance(budgetId: string, accountId: string) {
  const invalidate = useInvalidatePlan(budgetId);
  return useMutation({
    mutationFn: (body: AccountAdjustBalanceRequest) =>
      adjustAccountBalance(budgetId, accountId, body),
    onSuccess: invalidate,
  });
}

export function useCloseAccount(budgetId: string, accountId: string) {
  const invalidate = useInvalidatePlan(budgetId);
  return useMutation({
    mutationFn: (body: AccountCloseRequest) => closeAccount(budgetId, accountId, body),
    onSuccess: invalidate,
  });
}

/** Refetches the plan's queries on success and when the cleared balance changed under the request (409). */
export function useReconcileAccount(budgetId: string, accountId: string) {
  const invalidate = useInvalidatePlan(budgetId);
  return useMutation({
    mutationFn: (body: ReconcileRequestInput) => reconcileAccount(budgetId, accountId, body),
    onSuccess: invalidate,
    onError: (e) => {
      if (e instanceof ApiError && e.errorName === "reconcile_changed") invalidate();
    },
  });
}

export function useReopenAccount(budgetId: string, accountId: string) {
  const invalidate = useInvalidatePlan(budgetId);
  return useMutation({
    mutationFn: () => reopenAccount(budgetId, accountId),
    onSuccess: invalidate,
  });
}

/** The deleted account's own query is not refetched (it would 404 while the page still shows it). */
export function useDeleteAccount(budgetId: string, accountId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deleteAccount(budgetId, accountId),
    onSuccess: () => {
      void qc.invalidateQueries({
        predicate: (q) =>
          q.queryKey.includes(budgetId) &&
          !(q.queryKey[0] === "accounts" && q.queryKey[2] === accountId),
      });
    },
  });
}

export const reorderAccounts = async (
  budgetId: string,
  accountIds: string[],
  onChangeSet?: (id: string) => void,
): Promise<Account[]> => {
  const body: AccountOrderRequest = { account_ids: accountIds };
  return (
    await apiFetch(`/api/v1/budgets/${budgetId}/accounts/order`, {
      method: "PUT",
      body,
      onChangeSet,
      idempotencyKey: crypto.randomUUID(),
      schema: AccountListResponse,
    })
  ).data.accounts;
};

/** The list with the listed accounts permuted into the positions they held: the order the server will give. */
export function withAccountsOrdered<T extends { id: string }>(list: T[], ids: string[]): T[] {
  const byId = new Map(list.map((a) => [a.id, a]));
  const listed = new Set(ids);
  let k = 0;
  return list.map((a) => (listed.has(a.id) ? (byId.get(ids[k++] as string) ?? a) : a));
}

/** Puts the dropped order in the sidebar at once; a failure puts the list back, and the list is refetched. */
export function useReorderAccounts(budgetId: string) {
  const qc = useQueryClient();
  const listKey = ["accounts", budgetId];
  return useMutation({
    mutationFn: (ids: string[]) =>
      reorderAccounts(budgetId, ids, (id) => recordChange(budgetId, id, "register")),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: listKey });
      const list = qc.getQueryData<Account[]>(listKey);
      if (list) qc.setQueryData<Account[]>(listKey, withAccountsOrdered(list, ids));
      return { list };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.list) qc.setQueryData(listKey, ctx.list);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: listKey }),
  });
}

/** Stars or unstars at once; the accounts query (and so the sidebar's STARRED group) follows. */
export function useSetStarred(budgetId: string, accountId: string) {
  const qc = useQueryClient();
  const oneKey = ["accounts", budgetId, accountId];
  const listKey = ["accounts", budgetId];
  return useMutation({
    mutationFn: (starred: boolean) =>
      updateAccount(budgetId, accountId, { starred }, (id) =>
        recordChange(budgetId, id, "register"),
      ),
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
export { localToday } from "./today";
