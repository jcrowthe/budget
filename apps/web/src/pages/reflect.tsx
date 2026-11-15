import { PageHeader } from "../shell/PageHeader";
import { PlanGate } from "../shell/PlanGate";
import { usePageTitle } from "../shell/useCurrentPlan";

function ReflectPage() {
  usePageTitle("Reflect");
  return (
    <PlanGate>
      <PageHeader variant="reflect" title="Reflect" />
      <div className="page-body" />
    </PlanGate>
  );
}

export const page = { path: "/:budgetId/reflect", element: <ReflectPage /> };
