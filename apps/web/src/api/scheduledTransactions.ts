import {
  EnterDueResponse,
  type ScheduledBulkRequest,
  ScheduledBulkResponse,
  ScheduledCreateResponse,
  type ScheduledTransactionCreate,
  ScheduledTransactionListResponse,
  ScheduledTransactionResponse,
  type ScheduledTransactionUpdate,
} from "@budget/schema/scheduled-transactions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiFetch } from "./client";
import { keepPreviousInPlan } from "./placeholder";
import { localToday } from "./today";

const base = (budgetId: string) => `/api/v1/budgets/${budgetId}/scheduled-transactions` as const;

export const listScheduled = async (budgetId: string, accountId?: string) =>
  (
    await apiFetch(
      `${base(budgetId)}${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ""}`,
      { schema: ScheduledTransactionListResponse },
    )
  ).data.scheduled_transactions;

/** The plan's schedules, or one account's. Another plan's rows are never shown as a placeholder. */
export const useScheduledTransactions = (budgetId: string, accountId?: string) =>
  useQuery({
    queryKey: ["scheduled-transactions", budgetId, accountId ?? "all"],
    queryFn: () => listScheduled(budgetId, accountId),
    placeholderData: keepPreviousInPlan(budgetId),
    retry: false,
  });

const invalidatePlan = (qc: ReturnType<typeof useQueryClient>, budgetId: string) =>
  qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(budgetId) });

export function useCreateScheduled(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ScheduledTransactionCreate) =>
      (
        await apiFetch(`${base(budgetId)}?today=${localToday()}`, {
          method: "POST",
          body,
          idempotencyKey: crypto.randomUUID(),
          schema: ScheduledCreateResponse,
        })
      ).data,
    onSuccess: () => invalidatePlan(qc, budgetId),
  });
}

export function useUpdateScheduled(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; body: ScheduledTransactionUpdate }) =>
      (
        await apiFetch(`${base(budgetId)}/${encodeURIComponent(v.id)}?today=${localToday()}`, {
          method: "PATCH",
          body: v.body,
          idempotencyKey: crypto.randomUUID(),
          schema: ScheduledTransactionResponse,
        })
      ).data.scheduled_transaction,
    onSuccess: () => invalidatePlan(qc, budgetId),
  });
}

/** Enter Now or Delete for one or several schedules, in one request. */
export function useScheduledBulk(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ScheduledBulkRequest) =>
      (
        await apiFetch(`${base(budgetId)}/bulk?today=${localToday()}`, {
          method: "POST",
          body,
          idempotencyKey: crypto.randomUUID(),
          schema: ScheduledBulkResponse,
        })
      ).data,
    onSuccess: () => invalidatePlan(qc, budgetId),
  });
}

const enterDue = async (budgetId: string, today: string) =>
  (
    await apiFetch(`${base(budgetId)}/enter-due?today=${today}`, {
      method: "POST",
      body: {},
      idempotencyKey: crypto.randomUUID(),
      schema: EnterDueResponse,
    })
  ).data;

/** The day each plan was last entered for, once per load of the app. */
const enteredFor = new Map<string, string>();
const MAX_CALLS = 5;

/**
 * Enters what is due when a plan is opened: once per plan per load of the app, and again when the browser's date
 * changes (checked on focus, on visibility and every 60 s). It repeats while the server has more, and refetches the
 * plan when something was entered. A failure is forgotten, so the next trigger tries again.
 */
export function useEnterDueOnOpen(budgetId: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!budgetId) return;
    let live = true;
    const run = async () => {
      const day = localToday();
      if (enteredFor.get(budgetId) === day) return;
      enteredFor.set(budgetId, day);
      try {
        let entered = 0;
        for (let i = 0; i < MAX_CALLS; i++) {
          const r = await enterDue(budgetId, day);
          entered += r.entered.length;
          if (!r.has_more) break;
        }
        if (entered > 0 && live) await invalidatePlan(qc, budgetId);
      } catch {
        enteredFor.delete(budgetId);
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    void run();
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(run, 60_000);
    return () => {
      live = false;
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [budgetId, qc]);
}
