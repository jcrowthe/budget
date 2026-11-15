import { accountGroup } from "@budget/core/account-types";
import { formatMoney } from "@budget/core/money";
import type { Account } from "@budget/schema/accounts";
import { NavLink } from "react-router";
import { SIDEBAR_GROUPS } from "./accountTypeLabels";
import { accountPath } from "./planPaths";

/** A first, plain list of the open accounts by group. EXF-483 replaces it (totals, collapse, reorder). */
export function SidebarAccounts({ budgetId, accounts }: { budgetId: string; accounts: Account[] }) {
  return (
    <section className="nav-accounts" aria-label="Accounts">
      {SIDEBAR_GROUPS.map(([group, label]) => {
        const rows = accounts.filter((a) => accountGroup(a.type) === group);
        if (rows.length === 0) return null;
        return (
          <div key={group} className="nav-account-group">
            <h6>{label}</h6>
            {rows.map((a) => (
              <NavLink
                key={a.id}
                className="nav-account-row"
                to={accountPath(budgetId, a.id)}
                title={a.name}
              >
                <span className="name">{a.name}</span>
                <span className={a.balance < 0 ? "value negative" : "value"}>
                  {formatMoney(a.balance)}
                </span>
              </NavLink>
            ))}
          </div>
        );
      })}
    </section>
  );
}
