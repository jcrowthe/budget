import type { Month } from "@budget/core/month";
import { applyAssigned } from "@budget/schema/assigned-edit";
import { type AssignedResult, AssignedResultResponse } from "@budget/schema/month-categories";
import type { MonthDetail } from "@budget/schema/months";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { recordChange } from "../undo/store";
import { apiFetch } from "./client";
import { beginWrite, endWrite, inOrder } from "./monthCache";

/** Where a Plan write was made: the month it changed (null when it is not month-bound) and its categories. */
export type PlanWhere = { month: Month | null; categoryIds: string[] };

const MAX_WHERES = 250;
// Change set id -> where, in memory like the stacks: a reload clears both (docs/plan-undo-design.md, D-3).
const wheres = new Map<string, PlanWhere>();

function keepWhere(changeSetId: string, where: PlanWhere) {
  wheres.delete(changeSetId);
  wheres.set(changeSetId, where);
  for (const k of wheres.keys()) {
    if (wheres.size <= MAX_WHERES) break;
    wheres.delete(k);
  }
}

/** The onChangeSet of a Plan write: puts the set on the shared stack (origin "plan") and keeps its where. */
export const recordPlan =
  (budgetId: string, where: PlanWhere) =>
  (changeSetId: string): void => {
    keepWhere(changeSetId, where);
    recordChange(budgetId, changeSetId, "plan");
  };

export const planWhere = (changeSetId: string): PlanWhere | undefined => wheres.get(changeSetId);

/** An undo or redo's own set inherits the where of the set it reversed. */
export function carryPlanWhere(fromId: string, toId: string): void {
  const w = wheres.get(fromId);
  if (w) keepWhere(toId, w);
}

export const setAssignedAmount = async (
  budgetId: string,
  month: Month,
  categoryId: string,
  assigned: number,
  onChangeSet?: (id: string) => void,
): Promise<AssignedResult> =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/months/${month}/categories/${categoryId}`, {
      method: "PATCH",
      body: { assigned },
      idempotencyKey: crypto.randomUUID(),
      schema: AssignedResultResponse,
      onChangeSet,
    })
  ).data;

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
      await beginWrite(qc, budgetId);
      qc.setQueryData<MonthDetail>(key, (d) => d && applyAssigned(d, categoryId, after));
      // The PATCHes run one after another (an absolute set, so the last one sent must arrive last).
      void inOrder(budgetId, () =>
        setAssignedAmount(
          budgetId,
          month,
          categoryId,
          after,
          recordPlan(budgetId, { month, categoryIds: [categoryId] }),
        ),
      )
        .catch((e) => {
          qc.setQueryData<MonthDetail>(key, (d) => {
            const cur = d?.groups
              .flatMap((g) => g.categories)
              .find((c) => c.id === categoryId)?.assigned;
            return d && cur === after ? applyAssigned(d, categoryId, before) : d;
          });
          onError(e);
        })
        .finally(() => endWrite(qc, budgetId));
    },
    [qc, budgetId, month, onError],
  );
}
