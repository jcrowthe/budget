import type { MonthSpan, RangeFacts } from "@budget/schema/report-range";
import {
  type IncomeExpense,
  IncomeExpenseResponse,
  type NetWorth,
  NetWorthResponse,
  ReportRangeResponse,
  type ReportSettingsList,
  ReportSettingsResponse,
  type ReportSettingsUpdate,
  type ReportSlug,
  ReportTransactionsResponse,
  type SpendingBreakdown,
  SpendingBreakdownResponse,
  type SpendingTrends,
  SpendingTrendsResponse,
} from "@budget/schema/reports";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { keepPreviousInPlan } from "./placeholder";

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
    mutationKey: ["report-settings-save", budgetId],
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
      // A cancelled first read left nothing cached: read again.
      else void qc.invalidateQueries({ queryKey: settingsKey(budgetId) });
    },
    // Only the last save in the queue sets the cache: an earlier response would undo a later optimistic change.
    onSuccess: (data) => {
      if (qc.isMutating({ mutationKey: ["report-settings-save", budgetId] }) <= 1) {
        qc.setQueryData(settingsKey(budgetId), data);
      }
    },
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
    placeholderData: keepPreviousInPlan(budgetId),
    queryFn: async (): Promise<NetWorth> =>
      (
        await apiFetch(
          `/api/v1/budgets/${budgetId}/reports/net-worth?${netWorthQuery(span as MonthSpan, excluded, today)}`,
          { schema: NetWorthResponse },
        )
      ).data,
  });

async function downloadFile(url: string, filename: string): Promise<void> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export const downloadNetWorthCsv = (
  budgetId: string,
  span: MonthSpan,
  excluded: string[],
  today: string,
): Promise<void> =>
  downloadFile(
    `/api/v1/budgets/${budgetId}/reports/net-worth/export?${netWorthQuery(span, excluded, today)}`,
    `budget-reflect-net-worth-${today}.csv`,
  );

function spendingQuery(
  span: MonthSpan,
  excludedCats: string[],
  excludedAccts: string[],
  today: string,
): URLSearchParams {
  const q = new URLSearchParams({
    start_month: span.start_month,
    end_month: span.end_month,
    today,
  });
  if (excludedCats.length) q.set("excluded_category_ids", excludedCats.join(","));
  if (excludedAccts.length) q.set("excluded_account_ids", excludedAccts.join(","));
  return q;
}

export const useSpendingBreakdown = (
  budgetId: string,
  span: MonthSpan,
  excludedCats: string[],
  excludedAccts: string[],
  groupBy: "category" | "group",
  groupId: string | null,
  today: string,
) =>
  useQuery({
    queryKey: [
      "spending-breakdown",
      budgetId,
      span,
      excludedCats,
      excludedAccts,
      groupBy,
      groupId,
      today,
    ],
    placeholderData: keepPreviousInPlan(budgetId),
    queryFn: async (): Promise<SpendingBreakdown> => {
      const q = spendingQuery(span, excludedCats, excludedAccts, today);
      q.set("group_by", groupBy);
      if (groupId) q.set("group_id", groupId);
      return (
        await apiFetch(`/api/v1/budgets/${budgetId}/reports/spending-breakdown?${q}`, {
          schema: SpendingBreakdownResponse,
        })
      ).data;
    },
  });

export type ReportTransactionSelector =
  | { category_id: string }
  | { group_id: string }
  | { uncategorized: true }
  | { income_payee_id: string }
  | { income: true }
  | { expenses: true };

export const useReportTransactions = (
  budgetId: string,
  span: MonthSpan,
  selector: ReportTransactionSelector,
  excludedAccts: string[],
  excludedCats: string[] = [],
) =>
  useQuery({
    queryKey: ["report-transactions", budgetId, span, selector, excludedAccts, excludedCats],
    placeholderData: keepPreviousInPlan(budgetId),
    queryFn: async () => {
      const q = new URLSearchParams({ start_month: span.start_month, end_month: span.end_month });
      if ("category_id" in selector) q.set("category_id", selector.category_id);
      else if ("group_id" in selector) q.set("group_id", selector.group_id);
      else if ("income_payee_id" in selector) q.set("income_payee_id", selector.income_payee_id);
      else if ("income" in selector) q.set("income", "true");
      else if ("expenses" in selector) q.set("expenses", "true");
      else q.set("uncategorized", "true");
      if (excludedAccts.length) q.set("excluded_account_ids", excludedAccts.join(","));
      if (excludedCats.length) q.set("excluded_category_ids", excludedCats.join(","));
      return (
        await apiFetch(`/api/v1/budgets/${budgetId}/reports/transactions?${q}`, {
          schema: ReportTransactionsResponse,
        })
      ).data.transactions;
    },
  });

export const downloadSpendingBreakdownZip = (
  budgetId: string,
  span: MonthSpan,
  excludedCats: string[],
  excludedAccts: string[],
  today: string,
): Promise<void> =>
  downloadFile(
    `/api/v1/budgets/${budgetId}/reports/spending-breakdown/export?${spendingQuery(span, excludedCats, excludedAccts, today)}`,
    `budget-reflect-spending-breakdown-${today}.zip`,
  );

export const useSpendingTrends = (
  budgetId: string,
  span: MonthSpan,
  excludedCats: string[],
  excludedAccts: string[],
  groupId: string | null,
  today: string,
) =>
  useQuery({
    queryKey: ["spending-trends", budgetId, span, excludedCats, excludedAccts, groupId, today],
    placeholderData: keepPreviousInPlan(budgetId),
    queryFn: async (): Promise<SpendingTrends> => {
      const q = spendingQuery(span, excludedCats, excludedAccts, today);
      if (groupId) q.set("group_id", groupId);
      return (
        await apiFetch(`/api/v1/budgets/${budgetId}/reports/spending-trends?${q}`, {
          schema: SpendingTrendsResponse,
        })
      ).data;
    },
  });

export const useIncomeExpense = (
  budgetId: string,
  span: MonthSpan,
  excludedCats: string[],
  excludedAccts: string[],
  today: string,
) =>
  useQuery({
    queryKey: ["income-expense", budgetId, span, excludedCats, excludedAccts, today],
    placeholderData: keepPreviousInPlan(budgetId),
    queryFn: async (): Promise<IncomeExpense> =>
      (
        await apiFetch(
          `/api/v1/budgets/${budgetId}/reports/income-expense?${spendingQuery(span, excludedCats, excludedAccts, today)}`,
          { schema: IncomeExpenseResponse },
        )
      ).data,
  });

export const downloadSpendingTrendsZip = (
  budgetId: string,
  span: MonthSpan,
  excludedCats: string[],
  excludedAccts: string[],
  today: string,
): Promise<void> =>
  downloadFile(
    `/api/v1/budgets/${budgetId}/reports/spending-trends/export?${spendingQuery(span, excludedCats, excludedAccts, today)}`,
    `budget-reflect-spending-trends-${today}.zip`,
  );

export const downloadIncomeExpenseCsv = (
  budgetId: string,
  span: MonthSpan,
  excludedCats: string[],
  excludedAccts: string[],
  today: string,
): Promise<void> =>
  downloadFile(
    `/api/v1/budgets/${budgetId}/reports/income-expense/export?${spendingQuery(span, excludedCats, excludedAccts, today)}`,
    `budget-reflect-income-expense-${today}.csv`,
  );
