import { PageHeader } from "../shell/PageHeader";
import { PlanGate } from "../shell/PlanGate";
import { usePageTitle } from "../shell/useCurrentPlan";

function AccountsPage() {
  usePageTitle("All Accounts");
  return (
    <PlanGate>
      <PageHeader variant="accounts" title="All Accounts" />
      <div className="page-body" />
    </PlanGate>
  );
}

export const page = { path: "/:budgetId/accounts", element: <AccountsPage /> };
