import type { Account } from "@budget/schema/accounts";
import { repeatTooltip } from "@budget/schema/recurrence";
import {
  categoryText,
  type PlanSortColumn,
  type SortDir,
  sortTransactions,
} from "@budget/schema/register";
import type { ScheduledTransaction } from "@budget/schema/scheduled-transactions";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Tooltip } from "../account/Tooltip";
import { useScheduledTransactions } from "../api/scheduledTransactions";
import { Box } from "./Box";
import { EntryRow } from "./EntryRow";
import type { Field, Open } from "./entryDraft";
import { registerDate, registerMoney } from "./format";
import { CalendarIcon, CaretDownIcon, ChevronRightIcon, FlagFilledIcon, RepeatIcon } from "./icons";
import { useRegisterView } from "./register-view";
import { useSelection } from "./selection";

const COLLAPSED_KEY = "register.scheduled-collapsed";
const readCollapsed = () => {
  try {
    return sessionStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
};

/** The scheduled rows of the register as the table sorts them: by their next date. */
export function useScheduledRows(
  budgetId: string,
  accountId: string | undefined,
  sort: { column: PlanSortColumn; dir: SortDir },
) {
  const q = useScheduledTransactions(budgetId, accountId);
  const rows = useMemo(() => {
    if (!q.data) return [];
    const byId = new Map(q.data.map((s) => [s.id, s]));
    // Rows follow the register's sort, with the next date standing for the date.
    return sortTransactions(
      q.data.map((s) => ({ ...s, date: s.date_next })),
      sort.column,
      sort.dir,
    ).map((r) => byId.get(r.id) as ScheduledTransaction);
  }, [q.data, sort]);
  return rows;
}

/**
 * The "Scheduled Transactions" section at the top of the grid: a header that collapses it, one muted row per
 * series at its next date, and a spacer. Absent when there are no schedules.
 */
export function ScheduledSection({
  budgetId,
  account,
  plan,
  showCategory,
  colCount,
  rows,
  open,
  onOpen,
  onCloseEntry,
  onSaved,
  accounts,
}: {
  budgetId: string;
  account?: Account;
  plan: boolean;
  showCategory: boolean;
  colCount: number;
  rows: ScheduledTransaction[];
  open: Open;
  onOpen: (next: Open) => void;
  onCloseEntry: () => void;
  onSaved: (next: "close" | "again", date: string) => void;
  accounts: Account[];
}) {
  const { showFlags, showBalance } = useRegisterView();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  useEffect(() => {
    try {
      sessionStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // The state is only remembered while storage works.
    }
  }, [collapsed]);
  const { scheduled, setScheduled, pick, setScheduledRows } = useSelection();
  useEffect(() => setScheduledRows(rows), [rows, setScheduledRows]);
  // Ids that left the list (entered, deleted, another plan) drop out of the selection.
  useEffect(() => {
    if ([...scheduled].some((id) => !rows.some((r) => r.id === id))) {
      setScheduled([...scheduled].filter((id) => rows.some((r) => r.id === id)));
    }
  }, [rows, scheduled, setScheduled]);

  if (rows.length === 0) return null;

  const fieldOf = (e: React.MouseEvent): Field =>
    ((e.target as HTMLElement).closest<HTMLElement>("td[data-field]")?.dataset.field as Field) ??
    "date";
  const isControl = (e: React.MouseEvent) =>
    !!(e.target as HTMLElement).closest("button,input,[role=checkbox]");
  const editAt = open?.mode === "editScheduled" ? rows.findIndex((r) => r.id === open.id) : -1;
  const editRow = editAt >= 0 ? rows[editAt] : undefined;

  const openEdit = (s: ScheduledTransaction, field: Field) => {
    pick("scheduled", s.id, "only");
    onOpen({ mode: "editScheduled", id: s.id, focus: field });
  };
  const onRowClick = (e: React.MouseEvent, s: ScheduledTransaction) => {
    if (isControl(e)) return;
    if (e.shiftKey) {
      pick("scheduled", s.id, "rangeOnly");
      if (open) onCloseEntry();
      return;
    }
    if (scheduled.has(s.id) && scheduled.size === 1) openEdit(s, fieldOf(e));
    else {
      pick("scheduled", s.id, "only");
      if (open) onCloseEntry();
    }
  };

  const dataRow = (s: ScheduledTransaction) => {
    const checked = scheduled.has(s.id);
    const tip = repeatTooltip(s.frequency);
    return (
      <Fragment key={s.id}>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: rows select from their own keyboard-reachable checkbox */}
        <tr
          data-scheduled={s.id}
          className={`scheduled-row${checked ? " is-checked" : ""}`}
          onClick={(e) => onRowClick(e, s)}
          onMouseDown={(e) => {
            if (e.shiftKey) e.preventDefault();
          }}
          onDoubleClick={(e) => {
            if (!isControl(e)) openEdit(s, fieldOf(e));
          }}
        >
          <td className="cell-check">
            <Box
              state={checked}
              label="Select transaction"
              onClick={(e) => pick("scheduled", s.id, e.shiftKey ? "rangeAdd" : "toggle")}
            />
          </td>
          {showFlags && (
            <td className="cell-flag">
              {s.flag_color ? <FlagFilledIcon className={`flag-${s.flag_color}`} /> : null}
            </td>
          )}
          {plan && (
            <td data-field="account" title={s.account_name}>
              {s.account_name}
            </td>
          )}
          <td data-field="date" className="scheduled-date">
            <span className="scheduled-date-text">{registerDate(s.date_next)}</span>
            {tip ? (
              <Tooltip content={tip}>
                {(props) => (
                  <span {...props} className="scheduled-repeat" role="img" aria-label={tip}>
                    <RepeatIcon width={14} height={14} />
                  </span>
                )}
              </Tooltip>
            ) : null}
          </td>
          <td data-field="payee" title={s.payee_name ?? undefined}>
            {s.payee_name}
          </td>
          {showCategory && (
            <td data-field="category">
              {categoryText({ ...s, date: s.date_next, created_at: s.created_at })}
            </td>
          )}
          <td data-field="memo" title={s.memo ?? undefined}>
            {s.memo}
          </td>
          <td data-field="outflow" className="num">
            {s.amount < 0 ? registerMoney(s.amount) : null}
          </td>
          <td data-field="inflow" className="num">
            {s.amount > 0 ? registerMoney(s.amount) : null}
          </td>
          {showBalance && <td className="num cell-balance" />}
          <td className="cell-cleared" />
        </tr>
      </Fragment>
    );
  };

  return (
    <>
      <tbody className="scheduled-head">
        <tr>
          <td colSpan={colCount} className="scheduled-header-cell">
            <button
              type="button"
              className="scheduled-header"
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((c) => !c)}
            >
              <CalendarIcon />
              <span className="scheduled-title">Scheduled Transactions</span>
              <span className="scheduled-chevron" data-chevron={collapsed ? "right" : "down"}>
                {collapsed ? <ChevronRightIcon /> : <CaretDownIcon />}
              </span>
            </button>
          </td>
        </tr>
      </tbody>
      {!collapsed && (
        <>
          <tbody className="scheduled-rows">
            {(editAt < 0 ? rows : rows.slice(0, editAt)).map(dataRow)}
          </tbody>
          {editRow && open?.mode === "editScheduled" && (
            <EntryRow
              key={`edit-scheduled-${editRow.id}`}
              budgetId={budgetId}
              mode="editScheduled"
              scheduled={editRow}
              account={account}
              accounts={accounts}
              plan={plan}
              showCategory={showCategory}
              initialFocus={open.focus}
              onClose={onCloseEntry}
              onSaved={onSaved}
            />
          )}
          {editAt >= 0 && (
            <tbody className="scheduled-rows">{rows.slice(editAt + 1).map(dataRow)}</tbody>
          )}
        </>
      )}
      <tbody className="scheduled-spacer-body">
        <tr className="scheduled-spacer">
          <td colSpan={colCount} />
        </tr>
      </tbody>
    </>
  );
}
