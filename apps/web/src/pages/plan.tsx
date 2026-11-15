import { currentMonth } from "@budget/core/month";
import { PageHeader } from "../shell/PageHeader";
import { useCurrentPlan, usePageTitle } from "../shell/useCurrentPlan";

function PlanPage() {
  usePageTitle("Plan");
  const { plan, isLoading } = useCurrentPlan();
  if (isLoading) return null;
  if (!plan) {
    return (
      <div className="card">
        <h2>Plan not found</h2>
        <a href="/">Go home</a>
      </div>
    );
  }
  const month = new Date(`${currentMonth()}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <>
      <PageHeader variant="plan" title={month} />
      <div className="page-body" />
    </>
  );
}

export const page = { path: "/:budgetId/budget", element: <PlanPage /> };
