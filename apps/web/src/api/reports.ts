import type { MonthSpan, RangeFacts } from "@budget/schema/report-range";
import {
  type NetWorth,
  NetWorthResponse,
  ReportRangeResponse,
  type ReportSettingsList,
  ReportSettingsResponse,
  type ReportSettingsUpdate,
  type ReportSlug,
} from "@budget/schema/reports";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

const settingsKey = (budgetId: string) => ["report-settings", budgetId];

export const useReportSettings = (budgetId: string) =>
  useQuery({
    queryKey: settingsKey(budgetId),
    queryFn: async () =>
      (
        await apiFetch(`/api/v1/budgets/${budgetId}/report-settings`, {
          schema: ReportSettingsResponse,
        })
      ).data,
    staleTime: Number.POSITIVE_INFINITY,
  });

/** Saves run one after another; the screen updates at once; a failed save rolls back. */
export function useUpdateReportSettings(budgetId: string) {
  const qc = useQueryClient();
  return useMutation({
    scope: { id: `report-settings:${budgetId}` },
    mutationFn: async (v: { report: ReportSlug; patch: ReportSettingsUpdate }) =>
      (
        await apiFetch(`/api/v1/budgets/${budgetId}/report-settings/${v.report}`, {
          method: "PUT",
          body: v.patch,
          schema: ReportSettingsResponse,
        })
      ).data,
    onMutate: async ({ report, patch }) => {
      await qc.cancelQueries({ queryKey: settingsKey(budgetId) });
      const previous = qc.getQueryData<ReportSettingsList>(settingsKey(budgetId));
      qc.setQueryData<ReportSettingsList>(settingsKey(budgetId), (old) => {
        if (!old) return old;
        return {
          last_report: patch.visited ? report : old.last_report,
          reports: old.reports.map((r) => {
            const hide =
              patch.hide_export_dialog === undefined
                ? r.hide_export_dialog
                : patch.hide_export_dialog;
            if (r.report !== report) return { ...r, hide_export_dialog: hide };
            return {
              ...r,
              preset: patch.preset ?? r.preset,
              start_month: patch.preset
                ? patch.preset === "custom"
                  ? (patch.start_month ?? null)
                  : null
                : r.start_month,
              end_month: patch.preset
                ? patch.preset === "custom"
                  ? (patch.end_month ?? null)
                  : null
                : r.end_month,
              excluded_category_ids: patch.excluded_category_ids ?? r.excluded_category_ids,
              excluded_account_ids: patch.excluded_account_ids ?? r.excluded_account_ids,
              hide_export_dialog: hide,
            };
          }),
        };
      });
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(settingsKey(budgetId), ctx.previous);
    },
    onSuccess: (data) => qc.setQueryData(settingsKey(budgetId), data),
  });
}

/** The plan's first month and the browser's current month (clamping limits). */
export const useReportFacts = (budgetId: string, today: string) =>
  useQuery({
    queryKey: ["report-facts", budgetId, today],
    queryFn: async (): Promise<RangeFacts> => {
      const { first_month, current_month } = (
        await apiFetch(
          `/api/v1/budgets/${budgetId}/reports/range?preset=all_dates&today=${today}`,
          { schema: ReportRangeResponse },
        )
      ).data;
      return { first_month, current_month };
    },
  });

function netWorthQuery(span: MonthSpan, excluded: string[], today: string): string {
  const q = new URLSearchParams({
    start_month: span.start_month,
    end_month: span.end_month,
    today,
  });
  if (excluded.length) q.set("excluded_account_ids", excluded.join(","));
  return q.toString();
}

export const useNetWorth = (
  budgetId: string,
  span: MonthSpan | null,
  excluded: string[],
  today: string,
) =>
  useQuery({
    queryKey: ["net-worth", budgetId, span, excluded, today],
    enabled: !!span,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<NetWorth> =>
      (
        await apiFetch(
          `/api/v1/budgets/${budgetId}/reports/net-worth?${netWorthQuery(span as MonthSpan, excluded, today)}`,
          { schema: NetWorthResponse },
        )
      ).data,
  });

export async function downloadNetWorthCsv(
  budgetId: string,
  span: MonthSpan,
  excluded: string[],
  today: string,
): Promise<void> {
  const res = await fetch(
    `/api/v1/budgets/${budgetId}/reports/net-worth/export?${netWorthQuery(span, excluded, today)}`,
    { credentials: "same-origin" },
  );
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `budget-reflect-net-worth-${today}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
