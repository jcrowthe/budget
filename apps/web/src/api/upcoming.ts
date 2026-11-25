import type { Month } from "@budget/core/month";
import { CategoryUpcomingResponse } from "@budget/schema/scheduled-upcoming";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

/** The scheduled transactions dated inside a month for one category (EXF-505). */
export const getCategoryUpcoming = async (budgetId: string, month: Month, categoryId: string) =>
  (
    await apiFetch(
      `/api/v1/budgets/${budgetId}/months/${month}/categories/${categoryId}/upcoming`,
      { schema: CategoryUpcomingResponse },
    )
  ).data;

/** Mounted with the popover: one request per open. The key holds the plan id, so a schedule edit refreshes it. */
export const useCategoryUpcoming = (
  budgetId: string,
  month: Month,
  categoryId: string,
  enabled = true,
) =>
  useQuery({
    queryKey: ["category-upcoming", budgetId, month, categoryId],
    queryFn: () => getCategoryUpcoming(budgetId, month, categoryId),
    staleTime: 0,
    enabled,
  });
