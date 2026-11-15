import type { Month } from "@budget/core/month";
import {
  type MonthDetail,
  MonthDetailResponse,
  type MonthNote,
  MonthNoteResponse,
  type MonthRange,
  MonthRangeResponse,
} from "@budget/schema/months";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export const getMonthRange = async (budgetId: string): Promise<MonthRange> =>
  (await apiFetch(`/api/v1/budgets/${budgetId}/month-range`, { schema: MonthRangeResponse })).data;

/** Facts only; the browser applies "today" (see plan/monthNav.ts). */
export const useMonthRange = (budgetId: string) =>
  useQuery({ queryKey: ["month-range", budgetId], queryFn: () => getMonthRange(budgetId) });

export const setMonthNote = async (
  budgetId: string,
  month: Month,
  note: string | null,
): Promise<MonthNote> =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/months/${month}`, {
      method: "PATCH",
      body: { note },
      idempotencyKey: crypto.randomUUID(),
      schema: MonthNoteResponse,
    })
  ).data;

export function useSetMonthNote(budgetId: string, month: Month) {
  const qc = useQueryClient();
  const key = ["month", budgetId, month];
  return useMutation({
    mutationFn: (note: string | null) => setMonthNote(budgetId, month, note),
    onMutate: (note) => {
      qc.setQueryData<MonthDetail>(key, (d) => d && { ...d, note });
    },
    onError: () => qc.invalidateQueries({ queryKey: key }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["month-range", budgetId] });
    },
  });
}
