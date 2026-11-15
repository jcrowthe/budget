import { useEffect } from "react";
import { Navigate } from "react-router";
import { PageHeader } from "../shell/PageHeader";
import { localCurrentMonth, planPath, rememberMonth, usePlanMonth } from "../shell/planPaths";
import { usePageTitle } from "../shell/useCurrentPlan";

function PlanPage() {
  const { budgetId, month } = usePlanMonth();
  usePageTitle("Plan");
  useEffect(() => {
    if (month) rememberMonth(budgetId, month);
  }, [budgetId, month]);
  // A missing or invalid month is replaced with the current month's canonical URL.
  if (!month) return <Navigate replace to={planPath(budgetId, localCurrentMonth())} />;
  const title = new Date(`${month}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <>
      <PageHeader variant="plan" title={title} />
      <div className="page-body" />
    </>
  );
}

export const page = { path: "/:budgetId/budget/:month?", element: <PlanPage /> };
