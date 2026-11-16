import {
  type Target,
  type TargetBody,
  TargetDeletedResponse,
  TargetResponse,
} from "@budget/schema/targets";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { localToday } from "./accounts";
import { apiFetch } from "./client";
import { beginWrite, endWrite } from "./monthCache";

const path = (budgetId: string, categoryId: string): `/api/v1/${string}` =>
  `/api/v1/budgets/${budgetId}/categories/${categoryId}/target`;

export const putTarget = async (
  budgetId: string,
  categoryId: string,
  body: TargetBody,
): Promise<Target> =>
  (
    await apiFetch(`${path(budgetId, categoryId)}?today=${localToday()}`, {
      method: "PUT",
      body,
      idempotencyKey: crypto.randomUUID(),
      schema: TargetResponse,
    })
  ).data.target;

export const deleteTarget = async (budgetId: string, categoryId: string): Promise<Target> =>
  (
    await apiFetch(path(budgetId, categoryId), {
      method: "DELETE",
      idempotencyKey: crypto.randomUUID(),
      schema: TargetDeletedResponse,
    })
  ).data.deleted;

/** No optimistic write: the card waits for the refetched month, which carries the target's figures. */
export function useSaveTarget(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { categoryId: string; body: TargetBody }) =>
      putTarget(budgetId, v.categoryId, v.body),
    onMutate: () => beginWrite(qc, budgetId),
    onSettled: () => endWrite(qc, budgetId),
  });
}

export function useDeleteTarget(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) => deleteTarget(budgetId, categoryId),
    onMutate: () => beginWrite(qc, budgetId),
    onSettled: () => endWrite(qc, budgetId),
  });
}
