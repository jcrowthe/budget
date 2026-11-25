import { type SidebarSection, sidebarSections } from "@budget/core/account-types";

import type { Account } from "@budget/schema/accounts";
import { linkStatus } from "@budget/schema/bank-link";
import { Fragment, useEffect } from "react";
import { NavLink, useMatch } from "react-router";
import { useReorderAccounts } from "../api/accounts";
import { useSaveUiState, useUiState } from "../api/ui-state";
import { SIDEBAR_LABELS } from "./accountTypeLabels";
import { ConnectionStatusMark } from "./connection-status-mark";
import { ChevronDownIcon, ChevronRightIcon, PencilIcon } from "./icons";
import { usePlanFormatter } from "./plan-formats-context";
import { accountPath } from "./planPaths";
import { useSidebarDnd } from "./sidebarDnd";
import "./sidebar-dnd.css";

const sign = (n: number) => (n < 0 ? "negative" : n === 0 ? "zero" : "positive");

/** The plan's accounts under typed groups (closed ones last) with totals; a group header collapses it (saved per plan). */
export function SidebarAccounts({
  budgetId,
  accounts,
  onEdit,
}: {
  budgetId: string;
  accounts: Account[];
  onEdit?: (accountId: string) => void;
}) {
  const fmt = usePlanFormatter();
  const ui = useUiState(budgetId);
  const save = useSaveUiState(budgetId);
  const currentId = useMatch("/:budgetId/accounts/:accountId/*")?.params.accountId;
  const reorder = useReorderAccounts(budgetId);
  const dnd = useSidebarDnd({ onReorder: (ids) => reorder.mutate(ids) });
  const orderKey = accounts.map((a) => a.id).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the order changes, to put focus back on the moved account
  useEffect(() => {
    const id = dnd.takeRefocus();
    if (id) document.querySelector<HTMLElement>(`[data-account-id="${id}"]`)?.focus();
  }, [orderKey]);
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
      <div className="reorder-live" aria-live="polite">
        {dnd.announcement}
      </div>
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
                <span className={`value ${sign(total)}`}>{fmt.money(total)}</span>
              )}
              <span className="slot-right" />
            </button>
            {isCollapsed
              ? null
              : rows.map((a) => {
                  const gapAt = dnd.gap?.section === name ? dnd.gap.at : null;
                  const gap = (
                    <div className="nav-drop-gap" role="presentation" {...dnd.gapProps} />
                  );
                  const drag = dnd.row(a, name, rows);
                  return (
                    <Fragment key={`${name}:${a.id}`}>
                      {gapAt && "before" in gapAt && gapAt.before === a.id ? gap : null}
                      <div
                        className={[
                          "nav-account-row",
                          a.id === currentId ? "is-selected" : "",
                          dnd.dragging?.id === a.id && dnd.dragging.section === name
                            ? "is-drag-source"
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        {...(name === "closed" ? {} : drag)}
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
                        <NavLink
                          className="nav-account-link"
                          draggable={false}
                          data-account-id={a.id}
                          to={accountPath(budgetId, a.id)}
                        >
                          <span className="slot-left">
                            {a.unapproved_count > 0 ? (
                              <span
                                className="nav-unapproved-dot"
                                role="img"
                                title="Unapproved transactions"
                                aria-label="Unapproved transactions"
                              />
                            ) : null}
                          </span>
                          <span className="name" title={a.name}>
                            {a.name}
                          </span>
                          <span className={`value ${sign(a.balance)}`}>{fmt.money(a.balance)}</span>
                          <span className="slot-right" />
                        </NavLink>
                        {linkStatus(a) ? (
                          <ConnectionStatusMark budgetId={budgetId} account={a} />
                        ) : null}
                      </div>
                      {gapAt && "after" in gapAt && gapAt.after === a.id ? gap : null}
                    </Fragment>
                  );
                })}
          </div>
        );
      })}
    </section>
  );
}
