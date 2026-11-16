import type { ReportSlug } from "@budget/schema/reports";
import { useEffect } from "react";
import { Navigate, useParams } from "react-router";
import {
  downloadIncomeExpenseCsv,
  downloadNetWorthCsv,
  useReportSettings,
  useUpdateReportSettings,
} from "../api/reports";
import { IncomeExpenseReport } from "../reflect/IncomeExpenseReport";
import { NetWorthReport } from "../reflect/NetWorthReport";
import { ReportFrame } from "../reflect/ReportFrame";
import { TABS } from "../reflect/ReportTabs";
import { SpendingBreakdownPage } from "../reflect/SpendingBreakdownPage";
import { SpendingTrendsPage } from "../reflect/SpendingTrendsPage";
import type { ReportState } from "../reflect/state";
import { planPath, reflectPath } from "../shell/planPaths";
import { usePageTitle } from "../shell/useCurrentPlan";

export const REPORTS = {
  "spending-breakdown": "Spending Breakdown",
  "spending-trends": "Spending Trends",
  "net-worth": "Net Worth Report",
  "income-expense": "Income v Expense Report",
  "age-of-money": "Age Of Money",
} as const;

function ReportPage({ slug }: { slug: ReportSlug }) {
  usePageTitle(REPORTS[slug]);
  const { budgetId = "" } = useParams();
  const { mutate } = useUpdateReportSettings(budgetId);
  // Opening a report records it as the last visited one (the bare /reflect address opens it).
  useEffect(() => {
    mutate({ report: slug, patch: { visited: true } });
  }, [mutate, slug]);
  const title = TABS.find((t) => t.slug === slug)?.label ?? REPORTS[slug];
  if (slug === "spending-breakdown") return <SpendingBreakdownPage title={title} />;
  if (slug === "spending-trends") return <SpendingTrendsPage title={title} />;
  const onExport: ((s: ReportState) => Promise<void>) | undefined =
    slug === "net-worth"
      ? (s) => downloadNetWorthCsv(s.budgetId, s.span, s.settings.excluded_account_ids, s.today)
      : slug === "income-expense"
        ? (s) =>
            downloadIncomeExpenseCsv(
              s.budgetId,
              s.span,
              s.settings.excluded_category_ids,
              s.settings.excluded_account_ids,
              s.today,
            )
        : undefined;
  return (
    <ReportFrame report={slug} title={title} onExport={onExport}>
      {slug === "net-worth" ? (
        <NetWorthReport />
      ) : slug === "income-expense" ? (
        <IncomeExpenseReport />
      ) : (
        <p className="reflect-placeholder">This report is not built yet.</p>
      )}
    </ReportFrame>
  );
}

/** /reflect with no report: the last visited one, else Spending Breakdown (also when the read fails). */
function ReflectIndex({ budgetId }: { budgetId: string }) {
  const { data, isPending } = useReportSettings(budgetId);
  if (isPending) return null;
  return <Navigate replace to={reflectPath(budgetId, data?.last_report ?? "spending-breakdown")} />;
}

function ReflectPage() {
  const { budgetId = "", report } = useParams();
  if (!report) return <ReflectIndex budgetId={budgetId} />;
  if (!Object.hasOwn(REPORTS, report)) return <Navigate replace to={planPath(budgetId)} />;
  return <ReportPage key={`${budgetId}:${report}`} slug={report as ReportSlug} />;
}

export const page = { path: "/:budgetId/reflect/:report?", element: <ReflectPage /> };
