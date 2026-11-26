import type { Month } from "@budget/core/month";
import {
  type MonthDetail,
  MonthDetailResponse,
  MonthListResponse,
  type MonthNote,
  MonthNoteResponse,
  type MonthRange,
  MonthRangeResponse,
  MonthSummaryTotalsResponse,
} from "@budget/schema/months";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { beginWrite, endWrite } from "./monthCache";
import { keepPreviousInPlan } from "./placeholder";
import { localToday } from "./today";

/** Target figures use the person's own date, so the read carries the browser's local day. */
export const getMonth = async (budgetId: string, month: Month): Promise<MonthDetail> =>
  (
    await apiFetch(`/api/v1/budgets/${budgetId}/months/${month}?today=${localToday()}`, {
      schema: MonthDetailResponse,
    })
  ).data;

/** Unknown fields are stripped by the schema, so additions to the read model cannot break the grid. */
export const useMonth = (budgetId: string, month: Month) =>
  useQuery({
    queryKey: ["month", budgetId, month],
    queryFn: () => getMonth(budgetId, month),
    placeholderData: keepPreviousInPlan<MonthDetail>(budgetId),
  });

/**
 * The month the page already holds, without a read of its own: it subscribes to the cache and never fetches, so
 * a late observer (the Auto-Assign list) does not make a second request. Undefined until the page's own
 * `useMonth` has loaded it.
 */
export const useCachedMonth = (budgetId: string, month: Month) =>
  useQuery<MonthDetail>({
    queryKey: ["month", budgetId, month],
    enabled: false,
    // The same placeholder as useMonth: while the next month loads the list keeps its rows.
    placeholderData: keepPreviousInPlan<MonthDetail>(budgetId),
  });

/**
 * EXF-527: each later month's assigned total, from the current month's summary (the read carries the local day,
 * which decides the current month). The fields are absent for any other month.
 */
export const getFutureAssigned = async (budgetId: string, month: Month) => {
  const { data } = await apiFetch(
    `/api/v1/budgets/${budgetId}/months/${month}/summary?today=${localToday()}`,
    { schema: MonthSummaryTotalsResponse },
  );
  return { rows: data.future_assigned ?? [], total: data.future_assigned_total ?? 0 };
};

/**
 * Not under the `month` key prefix: the category writes put a MonthDetail into every query under it. The
 * `month-list` prefix is invalidated by every Assigned write (monthCache.endWrite), so the card follows edits.
 */
export const useFutureAssigned = (budgetId: string, month: Month, enabled: boolean) =>
  useQuery({
    queryKey: ["month-list", budgetId, "future-assigned", month],
    enabled,
    queryFn: () => getFutureAssigned(budgetId, month),
  });

/** EXF-525: Cost to Be Me: the month's targets total and next month's, from the same summary read. */
export const getMonthTargets = async (budgetId: string, month: Month) => {
  const { data } = await apiFetch(
    `/api/v1/budgets/${budgetId}/months/${month}/summary?today=${localToday()}`,
    { schema: MonthSummaryTotalsResponse },
  );
  return { total: data.targets_total, next: data.next_month_targets_total };
};

/** Under `month-list` like the future card, so every `endWrite` (target, hide, assigned writes) refreshes it. */
export const useMonthTargets = (budgetId: string, month: Month, enabled: boolean) =>
  useQuery({
    queryKey: ["month-list", budgetId, "targets", month],
    enabled,
    queryFn: () => getMonthTargets(budgetId, month),
    placeholderData: keepPreviousInPlan(budgetId),
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

export function useSetMonthNote(budgetId: string) {
  const qc = useQueryClient();
  // The month travels in the variables: a re-render (the person moved on) must not retarget the cache keys.
  const key = (month: Month) => ["month", budgetId, month];
  return useMutation({
    mutationFn: (v: { month: Month; note: string | null }) =>
      setMonthNote(budgetId, v.month, v.note),
    onMutate: async (v) => {
      await beginWrite(qc, budgetId);
      qc.setQueryData<MonthDetail>(key(v.month), (d) => d && { ...d, note: v.note });
    },
    onSettled: () => endWrite(qc, budgetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["month-range", budgetId] });
    },
  });
}

/** The summaries of the months from `from` to `to` (inclusive). Idle while `to` is null or before `from`. */
export const useMonthList = (budgetId: string, from: Month, to: Month | null) =>
  useQuery({
    queryKey: ["month-list", budgetId, from, to],
    enabled: !!to && to >= from,
    queryFn: async () =>
      (
        await apiFetch(`/api/v1/budgets/${budgetId}/months?from=${from}&to=${to}`, {
          schema: MonthListResponse,
        })
      ).data.months,
  });
