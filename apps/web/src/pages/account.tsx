import { Navigate, useParams } from "react-router";
import { AccountHeader } from "../account/AccountHeader";
import { useAccount } from "../api/accounts";
import { ApiError } from "../api/client";
import { useEnterDueOnOpen } from "../api/scheduledTransactions";
import { Register } from "../register/Register";
import { SelectionProvider } from "../register/selection";
import { accountsPath } from "../shell/planPaths";
import { usePageTitle } from "../shell/useCurrentPlan";

// An unknown account id is silently replaced by All Accounts, as in the source (EXF-475 polish P1).
function AccountPage() {
  const { budgetId = "", accountId = "" } = useParams();
  const { data: account, error } = useAccount(budgetId, accountId);
  useEnterDueOnOpen(budgetId);
  usePageTitle(account?.name ?? "Account");
  if (error instanceof ApiError && error.status < 500) {
    return <Navigate replace to={accountsPath(budgetId)} />;
  }
  return (
    <SelectionProvider key={`${budgetId}:${accountId}`}>
      <AccountHeader account={account} />
      {account && <Register key={account.id} budgetId={budgetId} account={account} />}
    </SelectionProvider>
  );
}

export const page = { path: "/:budgetId/accounts/:accountId", element: <AccountPage /> };
