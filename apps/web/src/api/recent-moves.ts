import { type RecentMove, RecentMovesResponse } from "@budget/schema/recent-moves";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiFetch } from "./client";
import { keepPreviousInPlan } from "./placeholder";

/**
 * The plan's recent assigning and money moves of the last 34 days, newest first (EXF-506); `month` and
 * `category_id` narrow it to one month's changes and one category's (the per-category Moves, acceptance 4).
 */
export const getRecentMoves = async (
  budgetId: string,
  params: { month?: string; category_id?: string } = {},
) => {
  const qs = new URLSearchParams();
  if (params.month) qs.set("month", params.month);
  if (params.category_id) qs.set("category_id", params.category_id);
  const query = qs.size ? `?${qs}` : "";
  return (
    await apiFetch(`/api/v1/budgets/${budgetId}/moves${query}`, { schema: RecentMovesResponse })
  ).data;
};

/** Mounted only while the popover is open: one request per open, and nothing kept to show stale at the next. */
export const useRecentMoves = (budgetId: string) =>
  useQuery({
    queryKey: ["recent-moves", budgetId],
    queryFn: () => getRecentMoves(budgetId),
    staleTime: 0,
    gcTime: 0,
  });

/** One category's moves in the viewed month; one request per open, like the toolbar's. */
export const useCategoryMoves = (budgetId: string, month: string, categoryId: string) =>
  useQuery({
    queryKey: ["category-moves", budgetId, month, categoryId],
    queryFn: () => getRecentMoves(budgetId, { month, category_id: categoryId }),
    staleTime: 0,
    gcTime: 0,
  });

/**
 * The categories with a move in the viewed month (they get the clock icon): one request per month. `version` is
 * the month read's `dataUpdatedAt`, so every refetch of the month (after a write, an Undo or Redo, a month
 * switch) re-reads this too; the previous set stays on screen meanwhile so the icons do not blink.
 */
export const useMovedCategories = (budgetId: string, month: string, version: number) => {
  const placeholderData = useMemo(() => keepPreviousInPlan<RecentMove[]>(budgetId), [budgetId]);
  return useQuery({
    queryKey: ["moved-categories", budgetId, month, version],
    queryFn: () => getRecentMoves(budgetId, { month }),
    placeholderData,
    select: movedIds,
  });
};

const movedIds = (moves: RecentMove[]) => {
  const ids = new Set<string>();
  for (const e of moves) {
    if (e.from) ids.add(e.from.category_id);
    if (e.to) ids.add(e.to.category_id);
  }
  return ids;
};
