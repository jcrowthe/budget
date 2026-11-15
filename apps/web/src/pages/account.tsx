import { Link, useParams } from "react-router";
import { PageHeader } from "../shell/PageHeader";
import { accountsPath } from "../shell/planPaths";
import { usePageTitle } from "../shell/useCurrentPlan";

// EXF-481 replaces this with the register; an unknown id keeps this state.
function AccountPage() {
  const { budgetId = "" } = useParams();
  usePageTitle("Account Not Found");
  return (
    <>
      <PageHeader variant="accounts" title="Account not found" />
      <div className="page-body">
        <div className="card">
          <h2>Account not found</h2>
          <Link to={accountsPath(budgetId)}>All Accounts</Link>
        </div>
      </div>
    </>
  );
}

export const page = { path: "/:budgetId/accounts/:accountId", element: <AccountPage /> };
