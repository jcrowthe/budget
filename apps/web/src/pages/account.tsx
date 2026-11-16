import { formatMoney } from "@budget/core/money";
import { Fragment } from "react";
import { Navigate, useParams } from "react-router";
import { useAccount } from "../api/accounts";
import { ApiError } from "../api/client";
import { Register } from "../register/Register";
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
  const balances: [string, number][] = [
    ["Cleared Balance", account.cleared_balance],
    ["Uncleared Balance", account.uncleared_balance],
    ["Working Balance", account.balance],
  ];
  return (
    <>
      <header className="account-header">
        <h1>{account.name}</h1>
        <p className="account-badge">
          {ACCOUNT_BADGE[account.type] ?? ACCOUNT_TYPE_LABEL[account.type]}
        </p>
      </header>
      <div className="account-balances">
        {balances.map(([label, amount], i) => (
          <Fragment key={label}>
            {i > 0 ? <span className="operator">{i === 1 ? "+" : "="}</span> : null}
            <div className="account-balance">
              <span className="amount">{formatMoney(amount)}</span>
              <span className="label">{label}</span>
            </div>
          </Fragment>
        ))}
      </div>
      <Register key={account.id} account={account} />
    </>
  );
}

export const page = { path: "/:budgetId/accounts/:accountId", element: <AccountPage /> };
