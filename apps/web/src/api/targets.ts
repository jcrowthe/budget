import {
  type CardTargetBody,
  type DebtPaymentTargetBody,
  type Target,
  type TargetBody,
  TargetDeletedResponse,
  TargetResponse,
  type TargetSnooze,
  TargetSnoozeResponse,
} from "@budget/schema/targets";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { recordPlan } from "./assigned";
import { apiFetch } from "./client";
import { beginWrite, endWrite } from "./monthCache";
import { localToday } from "./today";

const path = (budgetId: string, categoryId: string): `/api/v1/${string}` =>
  `/api/v1/budgets/${budgetId}/categories/${categoryId}/target`;

export const putTarget = async (
  budgetId: string,
  categoryId: string,
  body: TargetBody | CardTargetBody | DebtPaymentTargetBody,
  onChangeSet?: (id: string) => void,
): Promise<Target> =>
  (
    await apiFetch(`${path(budgetId, categoryId)}?today=${localToday()}`, {
      method: "PUT",
      body,
      idempotencyKey: crypto.randomUUID(),
      schema: TargetResponse,
      onChangeSet,
    })
  ).data.target;

export const deleteTarget = async (
  budgetId: string,
  categoryId: string,
  onChangeSet?: (id: string) => void,
): Promise<Target> =>
  (
    await apiFetch(path(budgetId, categoryId), {
      method: "DELETE",
      idempotencyKey: crypto.randomUUID(),
      schema: TargetDeletedResponse,
      onChangeSet,
    })
  ).data.deleted;

const planRecord = (budgetId: string, categoryId: string) =>
  recordPlan(budgetId, { month: null, categoryIds: [categoryId] });

/** No optimistic write: the card waits for the refetched month, which carries the target's figures. */
export function useSaveTarget(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      categoryId: string;
      body: TargetBody | CardTargetBody | DebtPaymentTargetBody;
    }) => putTarget(budgetId, v.categoryId, v.body, planRecord(budgetId, v.categoryId)),
    onMutate: () => beginWrite(qc, budgetId),
    onSettled: () => endWrite(qc, budgetId),
  });
}

export function useDeleteTarget(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) =>
      deleteTarget(budgetId, categoryId, planRecord(budgetId, categoryId)),
    onMutate: () => beginWrite(qc, budgetId),
    onSettled: () => endWrite(qc, budgetId),
  });
}

export const putTargetSnooze = async (
  budgetId: string,
  month: string,
  categoryId: string,
  snoozed: boolean,
): Promise<TargetSnooze> =>
  (
    await apiFetch(
      `/api/v1/budgets/${budgetId}/months/${month}/categories/${categoryId}/target-snooze?today=${localToday()}`,
      {
        method: "PUT",
        body: { snoozed },
        idempotencyKey: crypto.randomUUID(),
        schema: TargetSnoozeResponse,
      },
    )
  ).data;

/** No optimistic write: the month read that follows carries the status, the pill and the previews. */
export function useSnoozeTarget(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { month: string; categoryId: string; snoozed: boolean }) =>
      putTargetSnooze(budgetId, v.month, v.categoryId, v.snoozed),
    onMutate: () => beginWrite(qc, budgetId),
    onSettled: () => endWrite(qc, budgetId),
  });
}
