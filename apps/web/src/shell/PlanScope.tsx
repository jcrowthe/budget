import { useEffect, useRef } from "react";
import { Link, Navigate, Outlet } from "react-router";
import { useMarkOpened } from "../api/budgets";
import { usePlanOpenSync } from "./bank-link-sync";
import { planPath } from "./planPaths";
import { useCurrentPlan, useDocumentTitle } from "./useCurrentPlan";

function PlanNotFound() {
  useDocumentTitle("Plan Not Found | Budget");
  return (
    <div className="card">
      <h2>Plan not found</h2>
      <p>This plan doesn't exist or was deleted.</p>
      <Link to="/">Go to your plans</Link>
    </div>
  );
}

/** Layout for every /:budgetId/... page: resolves the plan, handles not-found, records the open. */
export function PlanScope() {
  const { plan, isLoading, error } = useCurrentPlan();
  const recorded = useRef<string | null>(null);
  const mark = useMarkOpened();
  // biome-ignore lint/correctness/useExhaustiveDependencies: record once per plan id; `mark` changes identity every render
  useEffect(() => {
    if (plan && recorded.current !== plan.id) {
      recorded.current = plan.id;
      mark.mutate(plan.id);
    }
  }, [plan?.id]);
  usePlanOpenSync(plan?.id);
  if (isLoading) return null;
  if (error) return <div className="card">Could not load plans.</div>;
  if (!plan) return <PlanNotFound />;
  return <Outlet />;
}

export function PlanIndexRedirect() {
  return <Navigate to="budget" replace />;
}

export function PlanFallbackRedirect() {
  const { budgetId } = useCurrentPlan();
  return <Navigate to={planPath(budgetId ?? "")} replace />;
}
