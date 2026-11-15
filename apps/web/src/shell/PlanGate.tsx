import type { ReactNode } from "react";
import { Link } from "react-router";
import { useCurrentPlan } from "./useCurrentPlan";

/** Renders children only for a known plan; an unknown :budgetId shows "Plan not found". */
export function PlanGate({ children }: { children: ReactNode }) {
  const { plan, isLoading } = useCurrentPlan();
  if (isLoading) return null;
  if (!plan) {
    return (
      <div className="card">
        <h2>Plan not found</h2>
        <Link to="/">Go home</Link>
      </div>
    );
  }
  return children;
}
