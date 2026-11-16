import { PayeeListResponse } from "@budget/schema/payees";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

/** Every payee of the plan, hidden and system ones included: the picker filters them itself. */
export const listPayees = async (budgetId: string) =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/payees?include_hidden=true`, {
      schema: PayeeListResponse,
    })
  ).data.payees;

export const usePayees = (budgetId: string) =>
  useQuery({
    queryKey: ["payees", budgetId],
    queryFn: () => listPayees(budgetId),
    staleTime: 30_000,
  });
