import { type BudgetCreate, BudgetListResponse, BudgetResponse } from "@budget/schema/budgets";
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
