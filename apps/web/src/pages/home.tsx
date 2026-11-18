import { Navigate } from "react-router";
import { useBudgets } from "../api/budgets";
import { PlansListPage } from "../plans/plans-list-page";
import { planPath } from "../shell/planPaths";
import { pickLastOpened } from "../shell/useCurrentPlan";

/** `/`: opens the plan used last; with no plan at all it shows the plans page. */
function Home() {
  const { data, isLoading, error } = useBudgets();
  if (isLoading) return null;
  if (error) return <div className="card">Could not load plans.</div>;
  const target = pickLastOpened(data ?? []);
  if (target) return <Navigate to={planPath(target.id)} replace />;
  return <PlansListPage />;
}

export const page = { path: "/", element: <Home /> };
