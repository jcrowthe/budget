import type { Month } from "@budget/core/month";
import { type MonthDetail, MonthDetailResponse } from "@budget/schema/months";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

export const getMonth = async (budgetId: string, month: Month): Promise<MonthDetail> =>
  (await apiFetch(`/api/v1/budgets/${budgetId}/months/${month}`, { schema: MonthDetailResponse }))
    .data;

/** Unknown fields are stripped by the schema, so additions to the read model cannot break the grid. */
export const useMonth = (budgetId: string, month: Month) =>
  useQuery({
    queryKey: ["month", budgetId, month],
    queryFn: () => getMonth(budgetId, month),
    placeholderData: keepPreviousData,
  });
