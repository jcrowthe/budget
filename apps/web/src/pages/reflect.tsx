import { Navigate, useParams } from "react-router";
import { PageHeader } from "../shell/PageHeader";
import { planPath, reflectPath } from "../shell/planPaths";
import { usePageTitle } from "../shell/useCurrentPlan";

export const REPORTS = {
  "spending-breakdown": "Spending Breakdown",
  "spending-trends": "Spending Trends",
  "net-worth": "Net Worth Report",
  "income-expense": "Income v Expense Report",
  "age-of-money": "Age Of Money",
} as const;

function ReportPage({ title }: { title: string }) {
  usePageTitle(title);
  return (
    <>
      <PageHeader variant="reflect" title="Reflect" />
      <div className="page-body" />
    </>
  );
}

function ReflectPage() {
  const { budgetId = "", report } = useParams();
  if (!report) return <Navigate replace to={reflectPath(budgetId, "spending-breakdown")} />;
  if (!Object.hasOwn(REPORTS, report)) return <Navigate replace to={planPath(budgetId)} />;
  return <ReportPage title={REPORTS[report as keyof typeof REPORTS]} />;
}

export const page = { path: "/:budgetId/reflect/:report?", element: <ReflectPage /> };
