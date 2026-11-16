import { formatMoney } from "@budget/core/money";
import type { Account, AccountType } from "@budget/schema/accounts";
import { isCredit } from "@budget/schema/card-payments";
import type { AccountBalances } from "@budget/schema/transactions";
import { Fragment, type ReactNode, useState } from "react";
import { useAccountSummary, useSetStarred } from "../api/accounts";
import { ClearedFilledIcon, ClearedOutlineIcon } from "../register/icons";
import { SelectedTotal } from "../register/selection";
import { ACCOUNT_BADGE, ACCOUNT_TYPE_LABEL } from "../shell/accountTypeLabels";
import { EditAccountDialog } from "./EditAccountDialog";
import {
  CardIcon,
  CashIcon,
  ChartDownIcon,
  ChartUpIcon,
  LockIcon,
  PencilIcon,
  StarFilledIcon,
  StarOutlineIcon,
} from "./icons";
import { PaymentBalance } from "./PaymentBalance";
import { Tooltip } from "./Tooltip";
import "./account-header.css";

const TIPS = {
  cleared:
    "The total of all transactions that your bank knows about and that are not currently pending. This should match the cleared (sometimes called posted or current) balance at your bank!",
  uncleared:
    "The total of all uncleared transactions. This includes transactions you've manually entered that your bank does not know about yet, as well as only those pending transactions from your bank that you've chosen to Enter Now.",
  working:
    "The sum of your cleared and uncleared transactions. This represents the money you have available to spend (or owe, in the case of credit cards and loan accounts).",
} as const;

const BLOCKS = [
  { key: "cleared", label: "Cleared Balance", icon: <ClearedFilledIcon width={12} height={12} /> },
  {
    key: "uncleared",
    label: "Uncleared Balance",
    icon: <ClearedOutlineIcon width={12} height={12} />,
  },
  { key: "working", label: "Working Balance", icon: null },
] as const;

const OPS = ["+", "="];

/** Cleared + Uncleared = Working. Empty amounts while loading, so the row keeps its height. */
export function BalanceRow({
  cleared,
  uncleared,
  working,
  children,
}: Partial<AccountBalances> & { children?: ReactNode }) {
  const values = { cleared, uncleared, working };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics and its own box
    <div className="acct-balances" role="group" aria-label="Balances">
      {BLOCKS.map((b, i) => {
        const v = values[b.key];
        return (
          <Fragment key={b.key}>
            {i > 0 && (
              <i className="acct-op" aria-hidden="true">
                {OPS[i - 1]}
              </i>
            )}
            <Tooltip content={TIPS[b.key]}>
              {(tip) => (
                // biome-ignore lint/a11y/noNoninteractiveTabindex: each amount is focusable to show its tooltip
                <div className="acct-balance" data-balance={b.key} tabIndex={0} {...tip}>
                  <span className={`acct-amount${v !== undefined && v < 0 ? " is-negative" : ""}`}>
                    {v === undefined ? "" : formatMoney(v)}
                  </span>
                  <span className="acct-label">
                    {b.icon}
                    {b.label}
                  </span>
                </div>
              )}
            </Tooltip>
          </Fragment>
        );
      })}
      {children ? <div className="acct-balances-right">{children}</div> : null}
    </div>
  );
}

function badgeIcon(type: AccountType): ReactNode {
  switch (type) {
    case "checking":
    case "savings":
    case "cash":
      return <CashIcon />;
    case "creditCard":
    case "lineOfCredit":
      return <CardIcon />;
    case "otherAsset":
      return <ChartUpIcon />;
    default:
      return <ChartDownIcon />;
  }
}

function Star({ account }: { account: Account }) {
  const setStarred = useSetStarred(account.budget_id, account.id);
  return (
    <button
      type="button"
      className={`acct-star${account.starred ? " is-on" : ""}`}
      aria-label="Toggle Starred"
      aria-pressed={account.starred}
      onClick={() => setStarred.mutate(!account.starred)}
    >
      {account.starred ? <StarFilledIcon /> : <StarOutlineIcon />}
    </button>
  );
}

/** The account page's header. Without an account (still loading) it is empty. */
export function AccountHeader({ account }: { account?: Account }) {
  const [editing, setEditing] = useState(false);
  if (!account) {
    return (
      <header className="acct-head">
        <div className="acct-head-top" />
      </header>
    );
  }
  const badge = ACCOUNT_BADGE[account.type] ?? ACCOUNT_TYPE_LABEL[account.type];
  return (
    <header className="acct-head">
      <div className="acct-head-top">
        <div className="acct-head-left">
          <div className="acct-title">
            <h1 title={account.name}>{account.name}</h1>
            {!account.closed && <Star account={account} />}
          </div>
          <div className="acct-info">
            <span className="acct-info-item">
              {badgeIcon(account.type)}
              {badge}
            </span>
            <span className="acct-info-item">
              <LockIcon />
              Not Yet Reconciled
            </span>
          </div>
        </div>
        <div className="acct-actions">
          <Tooltip content="Edit Account" align="end">
            {(tip) => (
              <button
                type="button"
                className="acct-edit"
                aria-label="Edit Account"
                onClick={() => setEditing(true)}
                {...tip}
              >
                <PencilIcon />
              </button>
            )}
          </Tooltip>
          <Tooltip
            delayed={false}
            align="end"
            content={
              <>
                <span className="acct-tip-label">Reconcile</span>
                <kbd>shift</kbd>
                <kbd>E</kbd>
              </>
            }
          >
            {(tip) => (
              <button type="button" className="acct-reconcile" data-ticket="EXF-533" {...tip}>
                Reconcile
              </button>
            )}
          </Tooltip>
        </div>
      </div>
      <hr className="acct-rule" />
      <BalanceRow
        cleared={account.cleared_balance}
        uncleared={account.uncleared_balance}
        working={account.balance}
      >
        <SelectedTotal />
        {isCredit(account.type) ? (
          <PaymentBalance
            budgetId={account.budget_id}
            accountId={account.id}
            cardName={account.name}
          />
        ) : null}
      </BalanceRow>
      {editing ? (
        <EditAccountDialog
          budgetId={account.budget_id}
          account={account}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </header>
  );
}

/** The All Accounts header: the title and the totals over every open account. */
export function AllAccountsHeader({ budgetId }: { budgetId: string }) {
  const { data } = useAccountSummary(budgetId);
  return (
    <header className="acct-head">
      <div className="acct-head-top is-all">
        <h1>All Accounts</h1>
      </div>
      <hr className="acct-rule" />
      <BalanceRow cleared={data?.cleared} uncleared={data?.uncleared} working={data?.working}>
        <SelectedTotal />
      </BalanceRow>
    </header>
  );
}
