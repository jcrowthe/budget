import type { ReportSlug } from "@budget/schema/reports";
import { useEffect } from "react";
import { Navigate, useParams } from "react-router";
import { downloadNetWorthCsv, useReportSettings, useUpdateReportSettings } from "../api/reports";
import { NetWorthReport } from "../reflect/NetWorthReport";
import { ReportFrame } from "../reflect/ReportFrame";
import { TABS } from "../reflect/ReportTabs";
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
  return (
    <ReportFrame
      report={slug}
      title={title}
      onExport={
        slug === "net-worth"
          ? (s) => downloadNetWorthCsv(s.budgetId, s.span, s.settings.excluded_account_ids, s.today)
          : undefined
      }
    >
      {slug === "net-worth" ? (
        <NetWorthReport />
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
  return <ReportPage key={report} slug={report as ReportSlug} />;
}

export const page = { path: "/:budgetId/reflect/:report?", element: <ReflectPage /> };
