import { type SidebarSection, sidebarSections } from "@budget/core/account-types";
import { formatMoney } from "@budget/core/money";
import type { Account } from "@budget/schema/accounts";
import { NavLink, useMatch } from "react-router";
import { useSaveUiState, useUiState } from "../api/ui-state";
import { SIDEBAR_LABELS } from "./accountTypeLabels";
import { ChevronDownIcon, ChevronRightIcon, PencilIcon } from "./icons";
import { accountPath } from "./planPaths";

const money = (m: number) => formatMoney(m).replace("-", "−");
const sign = (n: number) => (n < 0 ? "negative" : n === 0 ? "zero" : "positive");

/** The open accounts under typed groups with totals; a group header collapses it (saved per plan). */
export function SidebarAccounts({
  budgetId,
  accounts,
  onEdit,
}: {
  budgetId: string;
  accounts: Account[];
  onEdit?: (accountId: string) => void; // EXF-486 wires onEdit
}) {
  const ui = useUiState(budgetId);
  const save = useSaveUiState(budgetId);
  const currentId = useMatch("/:budgetId/accounts/:accountId/*")?.params.accountId;
  if (ui.isPending) return null;
  const collapsed: SidebarSection[] = ui.data?.collapsed_account_groups ?? [];

  const toggle = (name: SidebarSection) => {
    const next = collapsed.includes(name)
      ? collapsed.filter((g) => g !== name)
      : [...collapsed, name];
    save.mutate({ collapsed_account_groups: next });
  };

  return (
    <section className="nav-accounts" aria-label="Accounts">
      {sidebarSections(accounts).map(({ name, rows, total }) => {
        const label = SIDEBAR_LABELS[name];
        const isCollapsed = collapsed.includes(name);
        const Chevron = isCollapsed ? ChevronRightIcon : ChevronDownIcon;
        return (
          <div
            key={name}
            className={name === "loans" ? "nav-account-group loans" : "nav-account-group"}
            data-group={name}
          >
            <button
              type="button"
              className="nav-account-block"
              aria-label={`${isCollapsed ? "open" : "collapse"} ${label}`}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(name)}
            >
              <Chevron className="chevron" />
              <span className="label">{label}</span>
              {total === null ? null : (
                <span className={`value ${sign(total)}`}>{money(total)}</span>
              )}
              <span className="slot-right" />
            </button>
            {isCollapsed
              ? null
              : rows.map((a) => (
                  <div
                    key={`${name}:${a.id}`}
                    className={
                      a.id === currentId ? "nav-account-row is-selected" : "nav-account-row"
                    }
                  >
                    <button
                      type="button"
                      className="edit"
                      title="Edit Account"
                      aria-label="Edit Account"
                      onClick={(e) => {
                        e.preventDefault();
                        onEdit?.(a.id);
                      }}
                    >
                      <PencilIcon />
                    </button>
                    <NavLink className="nav-account-link" to={accountPath(budgetId, a.id)}>
                      <span className="slot-left" />
                      <span className="name" title={a.name}>
                        {a.name}
                      </span>
                      <span className={`value ${sign(a.balance)}`}>{money(a.balance)}</span>
                      <span className="slot-right" />
                    </NavLink>
                  </div>
                ))}
          </div>
        );
      })}
    </section>
  );
}
