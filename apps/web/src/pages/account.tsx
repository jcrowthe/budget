import { Navigate, useParams } from "react-router";
import { AccountHeader } from "../account/AccountHeader";
import { ReconcileProvider } from "../account/ReconcileContext";
import { useAccount } from "../api/accounts";
import { ApiError } from "../api/client";
import { useEnterDueOnOpen } from "../api/scheduledTransactions";
import { AttentionBanner } from "../register/AttentionBanner";
import { AttentionFilterProvider } from "../register/attention-filter";
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
      <AttentionFilterProvider>
        <AttentionBanner count={account?.needs_attention_count} />
        {account ? (
          <ReconcileProvider key={account.id} account={account}>
            <AccountHeader account={account} />
            <Register key={account.id} budgetId={budgetId} account={account} />
          </ReconcileProvider>
        ) : (
          <AccountHeader account={account} />
        )}
      </AttentionFilterProvider>
    </SelectionProvider>
  );
}

export const page = { path: "/:budgetId/accounts/:accountId", element: <AccountPage /> };
