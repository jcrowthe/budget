import {
  type Budget,
  type BudgetCreate,
  BudgetListResponse,
  BudgetResponse,
  type BudgetUpdate,
} from "@budget/schema/budgets";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

export const listBudgets = async () =>
  (await apiFetch("/api/v1/budgets", { schema: BudgetListResponse })).data.budgets;

export const createBudget = async (input: BudgetCreate) =>
  (
    await apiFetch("/api/v1/budgets", {
      method: "POST",
      body: input,
      idempotencyKey: crypto.randomUUID(),
      schema: BudgetResponse,
    })
  ).data.budget;

export const useBudgets = () => useQuery({ queryKey: ["budgets"], queryFn: listBudgets });

export function useCreateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createBudget,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budgets"] }),
  });
}

export const updateBudget = async (id: string, patch: BudgetUpdate): Promise<Budget> =>
  (
    await apiFetch(`/api/v1/budgets/${id}`, {
      method: "PATCH",
      body: patch,
      idempotencyKey: crypto.randomUUID(),
      schema: BudgetResponse,
    })
  ).data.budget;

function useReplaceInCache() {
  const qc = useQueryClient();
  return (updated: Budget) =>
    qc.setQueryData<Budget[]>(["budgets"], (list) =>
      list?.map((b) => (b.id === updated.id ? updated : b)),
    );
}

/** Records that a plan was opened (server stamps last_opened_at). No invalidation, no retry. */
export function useMarkOpened() {
  const replace = useReplaceInCache();
  return useMutation({
    mutationFn: (id: string) => updateBudget(id, { opened: true }),
    onSuccess: replace,
  });
}

export function useUpdateBudget() {
  const replace = useReplaceInCache();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: BudgetUpdate }) => updateBudget(id, patch),
    onSuccess: replace,
  });
}
