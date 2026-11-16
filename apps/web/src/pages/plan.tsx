import { useEffect } from "react";
import { Navigate, useParams } from "react-router";
import { PlanGrid } from "../plan/PlanGrid";
import { PlanHeader } from "../plan/PlanHeader";
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
  return (
    <div className="plan-page">
      <PlanHeader budgetId={budgetId} month={month} />
      {/* EXF-500: the view chips row goes here, between the header and the grid */}
      <div className="plan-body">
        <PlanGrid budgetId={budgetId} month={month} />
        <aside className="plan-inspector" aria-label="Inspector" />
      </div>
    </div>
  );
}

export const page = { path: "/:budgetId/budget/:month?", element: <PlanPage /> };
