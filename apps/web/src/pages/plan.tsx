import { currentMonth } from "@budget/core/month";
import { PageHeader } from "../shell/PageHeader";
import { PlanGate } from "../shell/PlanGate";
import { usePageTitle } from "../shell/useCurrentPlan";

function PlanPage() {
  usePageTitle("Plan");
  const month = new Date(`${currentMonth()}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <PlanGate>
      <PageHeader variant="plan" title={month} />
      <div className="page-body" />
    </PlanGate>
  );
}

export const page = { path: "/:budgetId/budget", element: <PlanPage /> };
