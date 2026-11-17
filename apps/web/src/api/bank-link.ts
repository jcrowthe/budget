import {
  type AccountLinkRequest,
  AccountResponse,
  type AccountsFromBankRequest,
  AccountsFromBankResponse,
} from "@budget/schema/accounts";
import { PlanSyncResponse, SyncResultResponse } from "@budget/schema/bank-connections";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { listBankConnections } from "./bank-connections";
import { apiFetch } from "./client";

const accountUrl = (budgetId: string, accountId: string) =>
  `/api/v1/budgets/${budgetId}/accounts/${encodeURIComponent(accountId)}` as const;

/** One request that makes every ticked bank account an account of the plan (EXF-461). */
export const createAccountsFromBank = async (budgetId: string, body: AccountsFromBankRequest) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/accounts/from-bank`, {
      method: "POST",
      body,
      idempotencyKey: crypto.randomUUID(),
      schema: AccountsFromBankResponse,
    })
  ).data;

export const linkAccount = async (budgetId: string, accountId: string, body: AccountLinkRequest) =>
  (
    await apiFetch(`${accountUrl(budgetId, accountId)}/link`, {
      method: "POST",
      body,
      idempotencyKey: crypto.randomUUID(),
      schema: AccountResponse,
    })
  ).data.account;

export const unlinkAccount = async (budgetId: string, accountId: string) =>
  (
    await apiFetch(`${accountUrl(budgetId, accountId)}/link`, {
      method: "DELETE",
      idempotencyKey: crypto.randomUUID(),
      schema: AccountResponse,
    })
  ).data.account;

/** Syncs send no Idempotency-Key: each press is a new run. */
export const syncPlan = async (budgetId: string) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/sync`, {
      method: "POST",
      schema: PlanSyncResponse,
    })
  ).data;

export const syncConnection = async (budgetId: string, connectionId: string) =>
  (
    await apiFetch(
      `/api/v1/bank-connections/${encodeURIComponent(connectionId)}/sync?budget_id=${encodeURIComponent(budgetId)}`,
      { method: "POST", schema: SyncResultResponse },
    )
  ).data;

/** The plan's bank connections, newest first (the Link Account list and the edit dialog's connection). */
export const useBankConnections = (budgetId: string, enabled = true) =>
  useQuery({
    queryKey: ["bank-connections", budgetId],
    queryFn: () => listBankConnections(budgetId),
    enabled: enabled && !!budgetId,
    retry: false,
  });

/** Every query of the plan (accounts, register, months) and its connections may have changed. */
export function invalidateBankLink(qc: QueryClient, budgetId: string): void {
  void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(budgetId) });
}

/** The sync after adding or linking, and when a plan opens: not awaited, a failure shows nothing. */
export function startPlanSync(qc: QueryClient, budgetId: string): void {
  syncPlan(budgetId)
    .catch(() => undefined)
    .finally(() => invalidateBankLink(qc, budgetId));
}
