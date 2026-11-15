import { formatMoney } from "@budget/core/money";
import { Navigate, useParams } from "react-router";
import { useAccount } from "../api/accounts";
import { ApiError } from "../api/client";
import { ACCOUNT_BADGE, ACCOUNT_TYPE_LABEL } from "../shell/accountTypeLabels";
import { PageHeader } from "../shell/PageHeader";
import { accountsPath } from "../shell/planPaths";
import { usePageTitle } from "../shell/useCurrentPlan";

// An unknown account id is silently replaced by All Accounts, as in the source (EXF-475 polish P1).
// The register (EXF-513) and the real header (EXF-484) come later: this page is the name, badge and balances.
function AccountPage() {
  const { budgetId = "", accountId = "" } = useParams();
  const { data: account, error } = useAccount(budgetId, accountId);
  usePageTitle(account?.name ?? "Account");
  if (error instanceof ApiError && error.status < 500) {
    return <Navigate replace to={accountsPath(budgetId)} />;
  }
  if (!account) return <PageHeader variant="accounts" title="" />;
  return (
    <>
      <PageHeader variant="accounts" title={account.name}>
        <p className="account-badge">
          {ACCOUNT_BADGE[account.type] ?? ACCOUNT_TYPE_LABEL[account.type]}
        </p>
      </PageHeader>
      <dl className="page-body account-balances">
        <dt>Cleared Balance</dt>
        <dd>{formatMoney(account.cleared_balance)}</dd>
        <dt>Uncleared Balance</dt>
        <dd>{formatMoney(account.uncleared_balance)}</dd>
        <dt>Working Balance</dt>
        <dd>{formatMoney(account.balance)}</dd>
      </dl>
    </>
  );
}

export const page = { path: "/:budgetId/accounts/:accountId", element: <AccountPage /> };
