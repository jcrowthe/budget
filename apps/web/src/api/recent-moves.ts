import { RecentMovesResponse } from "@budget/schema/recent-moves";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

/** The plan's recent assigning and money moves of the last 34 days, newest first (EXF-506). */
export const getRecentMoves = async (budgetId: string) =>
  (await apiFetch(`/api/v1/budgets/${budgetId}/moves`, { schema: RecentMovesResponse })).data;

/** Mounted only while the popover is open: one request per open, and nothing kept to show stale at the next. */
export const useRecentMoves = (budgetId: string) =>
  useQuery({
    queryKey: ["recent-moves", budgetId],
    queryFn: () => getRecentMoves(budgetId),
    staleTime: 0,
    gcTime: 0,
  });
