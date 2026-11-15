import type { Month } from "@budget/core/month";
import { applyAssigned } from "@budget/schema/assigned-edit";
import { type AssignedResult, AssignedResultResponse } from "@budget/schema/month-categories";
import type { MonthDetail } from "@budget/schema/months";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { apiFetch } from "./client";

export const setAssignedAmount = async (
  budgetId: string,
  month: Month,
  categoryId: string,
  assigned: number,
): Promise<AssignedResult> =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/months/${month}/categories/${categoryId}`, {
      method: "PATCH",
      body: { assigned },
      idempotencyKey: crypto.randomUUID(),
      schema: AssignedResultResponse,
    })
  ).data;

/** Per plan: the PATCHes run one after another (an absolute set, so the last one sent must arrive last). */
const queues = new Map<string, { tail: Promise<unknown>; pending: number }>();

/**
 * Returns commit(categoryId, before, after): writes the new numbers into the cached month at once, sends the
 * PATCH in the background, and refetches every cached month of the plan when it settles. On failure the old
 * value goes back (only if the cache still shows the new one) and onError runs.
 */
export function useCommitAssigned(
  budgetId: string,
  month: Month,
  onError: (e: unknown) => void,
): (categoryId: string, before: number, after: number) => Promise<void> {
  const qc = useQueryClient();
  return useCallback(
    async (categoryId, before, after) => {
      if (after === before) return;
      const key = ["month", budgetId, month];
      await qc.cancelQueries({ queryKey: key, exact: true });
      qc.setQueryData<MonthDetail>(key, (d) => d && applyAssigned(d, categoryId, after));
      const q = queues.get(budgetId) ?? { tail: Promise.resolve(), pending: 0 };
      queues.set(budgetId, q);
      q.pending++;
      q.tail = q.tail.then(() =>
        setAssignedAmount(budgetId, month, categoryId, after)
          .catch((e) => {
            qc.setQueryData<MonthDetail>(key, (d) => {
              const cur = d?.groups
                .flatMap((g) => g.categories)
                .find((c) => c.id === categoryId)?.assigned;
              return d && cur === after ? applyAssigned(d, categoryId, before) : d;
            });
            onError(e);
          })
          .finally(() => {
            // Refetch only when nothing else is in flight, so it cannot overwrite a pending optimistic value.
            if (--q.pending === 0) {
              queues.delete(budgetId);
              qc.invalidateQueries({ queryKey: ["month", budgetId] });
            }
          }),
      );
    },
    [qc, budgetId, month, onError],
  );
}
