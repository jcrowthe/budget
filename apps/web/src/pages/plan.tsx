import { useEffect } from "react";
import { Navigate, useParams } from "react-router";
import { PlanGrid } from "../plan/PlanGrid";
import { PageHeader } from "../shell/PageHeader";
import { localCurrentMonth, planPath, rememberMonth, usePlanMonth } from "../shell/planPaths";
import { usePageTitle } from "../shell/useCurrentPlan";

function PlanPage() {
  const { budgetId, month: parsed } = usePlanMonth();
  const { month: raw } = useParams();
  // No month in the URL: the source keeps /budget and shows the current month (polish P2).
  const month = raw === undefined ? localCurrentMonth() : parsed;
  usePageTitle("Plan");
  useEffect(() => {
    if (month) rememberMonth(budgetId, month);
  }, [budgetId, month]);
  // A present but invalid month is replaced with the current month's canonical URL.
  if (!month) return <Navigate replace to={planPath(budgetId, localCurrentMonth())} />;
  const title = new Date(`${month}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <div className="plan-page">
      <PageHeader variant="plan" title={title} />
      <div className="plan-body">
        <PlanGrid budgetId={budgetId} month={month} />
        <aside className="plan-inspector" aria-label="Inspector" />
      </div>
    </div>
  );
}

export const page = { path: "/:budgetId/budget/:month?", element: <PlanPage /> };
