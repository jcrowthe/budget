import { Navigate } from "react-router";
import { useBudgets } from "../api/budgets";
import { planPath } from "../shell/planPaths";
import { pickLastOpened, useDocumentTitle } from "../shell/useCurrentPlan";

function Home() {
  useDocumentTitle("Budget");
  const { data, isLoading, error } = useBudgets();
  if (isLoading) return null;
  if (error) return <div className="card">Could not load plans.</div>;
  const target = pickLastOpened(data ?? []);
  if (target) return <Navigate to={planPath(target.id)} replace />;
  return (
    <div className="card">
      <h2>Create your first plan</h2>
      <p>Use the plan menu in the sidebar and choose New Plan.</p>
    </div>
  );
}

export const page = { path: "/", element: <Home /> };
