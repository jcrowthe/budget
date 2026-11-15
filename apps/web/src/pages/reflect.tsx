import { PageHeader } from "../shell/PageHeader";
import { usePageTitle } from "../shell/useCurrentPlan";

function ReflectPage() {
  usePageTitle("Reflect");
  return (
    <>
      <PageHeader variant="reflect" title="Reflect" />
      <div className="page-body" />
    </>
  );
}

export const page = { path: "/:budgetId/reflect", element: <ReflectPage /> };
