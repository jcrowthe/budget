import { PageHeader } from "../shell/PageHeader";
import { usePageTitle } from "../shell/useCurrentPlan";

function AccountsPage() {
  usePageTitle("All Accounts");
  return (
    <>
      <PageHeader variant="accounts" title="All Accounts" />
      <div className="page-body" />
    </>
  );
}

export const page = { path: "/:budgetId/accounts", element: <AccountsPage /> };
