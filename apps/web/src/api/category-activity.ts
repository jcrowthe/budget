import type { Month } from "@budget/core/month";
import { CategoryActivityResponse } from "@budget/schema/category-activity";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

/** The transactions behind one category's Activity for a month (EXF-509). */
export const getCategoryActivity = async (budgetId: string, month: Month, categoryId: string) =>
  (
    await apiFetch(
      `/api/v1/budgets/${budgetId}/months/${month}/categories/${categoryId}/transactions`,
      { schema: CategoryActivityResponse },
    )
  ).data;

/** Mounted only while the popover is open: one request per open, none per row. */
export const useCategoryActivity = (budgetId: string, month: Month, categoryId: string) =>
  useQuery({
    queryKey: ["category-activity", budgetId, month, categoryId],
    queryFn: () => getCategoryActivity(budgetId, month, categoryId),
    staleTime: 0,
  });
