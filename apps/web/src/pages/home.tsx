import { Navigate } from "react-router";
import { useBudgets } from "../api/budgets";
import { LAST_PLAN_KEY } from "../shell/useCurrentPlan";

function Home() {
  const { data, isLoading, error } = useBudgets();
  if (isLoading) return null;
  if (error) return <div className="card">Could not load plans.</div>;
  const plans = data ?? [];
  const last = localStorage.getItem(LAST_PLAN_KEY);
  const target = plans.find((p) => p.id === last) ?? plans[0];
  if (target) return <Navigate to={`/${target.id}/budget`} replace />;
  return (
    <div className="card">
      <h2>Create your first plan</h2>
      <p>Use the plan menu in the sidebar and choose New Plan.</p>
    </div>
  );
}

export const page = { path: "/", element: <Home /> };
