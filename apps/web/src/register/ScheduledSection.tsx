import type { Account } from "@budget/schema/accounts";
import { repeatTooltip } from "@budget/schema/recurrence";
import {
  categoryCell,
  categoryText,
  type PlanSortColumn,
  type SortDir,
  sortTransactions,
} from "@budget/schema/register";
import type { ScheduledTransaction } from "@budget/schema/scheduled-transactions";
import { transferCellText, transferPayeeName } from "@budget/schema/transfers";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Tooltip } from "../account/Tooltip";
import { useScheduledTransactions } from "../api/scheduledTransactions";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { accountPath } from "../shell/planPaths";
import { useAttentionColumn } from "./attention-filter";
import { Box } from "./Box";
import { EntryRow } from "./EntryRow";
import type { Field, Open } from "./entryDraft";
import {
  CalendarIcon,
  CaretDownIcon,
  ChevronRightIcon,
  FlagFilledIcon,
  RepeatIcon,
  TransferIcon,
} from "./icons";
import { useRegisterView } from "./register-view";
import { scheduledRowKey } from "./scheduledKeys";
import { useSelection } from "./selection";

export { scheduledRowKey, seriesIds } from "./scheduledKeys";

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
    // A mirror shares its series' id, so rows are told apart by their key.
    const byKey = new Map(q.data.map((s) => [scheduledRowKey(s), s]));
    // Rows follow the register's sort, with the next date standing for the date.
    return sortTransactions(
      q.data.map((s) => ({ ...s, id: scheduledRowKey(s), date: s.date_next })),
      sort.column,
      sort.dir,
    ).map((r) => byKey.get(r.id) as ScheduledTransaction);
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
  const fmt = usePlanFormatter();
  const { showFlags, showBalance } = useRegisterView();
  const attentionCol = useAttentionColumn();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  useEffect(() => {
    try {
      sessionStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // The state is only remembered while storage works.
    }
  }, [collapsed]);
  const navigate = useNavigate();
  const { scheduled, setScheduled, pick, setScheduledRows, openMenuAt } = useSelection();
  useEffect(() => setScheduledRows(rows), [rows, setScheduledRows]);
  // Keys that left the list (entered, deleted, another plan) drop out of the selection.
  useEffect(() => {
    const live = new Set(rows.map(scheduledRowKey));
    if ([...scheduled].some((k) => !live.has(k))) {
      setScheduled([...scheduled].filter((k) => live.has(k)));
    }
  }, [rows, scheduled, setScheduled]);

  if (rows.length === 0) return null;

  const fieldOf = (e: React.MouseEvent): Field =>
    ((e.target as HTMLElement).closest<HTMLElement>("td[data-field]")?.dataset.field as Field) ??
    "date";
  const isControl = (e: React.MouseEvent) =>
    !!(e.target as HTMLElement).closest("button,input,[role=checkbox]");
  const editAt =
    open?.mode === "editScheduled" ? rows.findIndex((r) => !r.mirror && r.id === open.id) : -1;
  const editRow = editAt >= 0 ? rows[editAt] : undefined;

  const openEdit = (s: ScheduledTransaction, field: Field) => {
    // The derived mirror is read-only: its series is edited in the account that holds it.
    if (s.mirror) return;
    pick("scheduled", s.id, "only");
    onOpen({ mode: "editScheduled", id: s.id, focus: field });
  };
  const onRowClick = (e: React.MouseEvent, s: ScheduledTransaction) => {
    if (isControl(e)) return;
    const key = scheduledRowKey(s);
    if (e.shiftKey) {
      pick("scheduled", key, "rangeOnly");
      if (open) onCloseEntry();
      return;
    }
    if (!s.mirror && scheduled.has(key) && scheduled.size === 1) openEdit(s, fieldOf(e));
    else {
      pick("scheduled", key, "only");
      if (open) onCloseEntry();
    }
  };

  const byAccount = new Map(accounts.map((a) => [a.id, a]));
  const categoryCellOf = (s: ScheduledTransaction) => {
    const rowAccount = byAccount.get(s.account_id);
    const other = s.transfer_account_id ? byAccount.get(s.transfer_account_id) : undefined;
    if (!s.transfer_account_id || !rowAccount) {
      return <>{categoryText({ ...s, date: s.date_next, created_at: s.created_at })}</>;
    }
    const cell = categoryCell(
      { ...s, date: s.date_next, subtransactions: [], payee_system: null },
      rowAccount,
      other ?? null,
    );
    if (cell.kind === "text") return <>{cell.text}</>;
    if (cell.kind === "notNeeded")
      return <span className="category-not-needed">Category not needed</span>;
    if (cell.kind === "needsCategory" && !s.mirror) {
      return (
        <button type="button" className="needs-category" onClick={() => openEdit(s, "category")}>
          This needs a category
        </button>
      );
    }
    return null;
  };
  const payeeCellOf = (s: ScheduledTransaction) => {
    if (!s.transfer_account_id || !s.transfer_account_name) return s.payee_name;
    const jump = s.mirror
      ? `Scheduled in ${s.transfer_account_name}: edit it there`
      : "Click to jump to the other side of this transfer";
    return (
      <span className="transfer-payee">
        <span className="transfer-name">{transferCellText(s.transfer_account_name)}</span>
        <button
          type="button"
          className="transfer-link"
          title={jump}
          aria-label={jump}
          onClick={(e) => {
            e.stopPropagation();
            navigate(accountPath(budgetId, s.transfer_account_id as string), {
              state: s.mirror ? { selectScheduled: s.id } : undefined,
            });
          }}
        >
          <TransferIcon />
        </button>
      </span>
    );
  };

  const dataRow = (s: ScheduledTransaction) => {
    const key = scheduledRowKey(s);
    const checked = scheduled.has(key);
    const tip = repeatTooltip(s.frequency);
    return (
      <Fragment key={key}>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: rows select from their own keyboard-reachable checkbox */}
        <tr
          data-scheduled={key}
          className={`scheduled-row${s.mirror ? " is-mirror" : ""}${checked ? " is-checked" : ""}`}
          title={
            s.mirror && s.transfer_account_name
              ? `Scheduled in ${s.transfer_account_name}: edit it there`
              : undefined
          }
          onClick={(e) => onRowClick(e, s)}
          onMouseDown={(e) => {
            if (e.shiftKey) e.preventDefault();
          }}
          onContextMenu={(e) => {
            if (isControl(e)) return;
            e.preventDefault();
            if (!scheduled.has(key)) {
              pick("scheduled", key, "only");
              if (open) onCloseEntry();
            }
            openMenuAt(e.clientX, e.clientY);
          }}
          onDoubleClick={(e) => {
            if (!isControl(e)) openEdit(s, fieldOf(e));
          }}
        >
          <td className="cell-check">
            <Box
              state={checked}
              label="Select transaction"
              onClick={(e) => pick("scheduled", key, e.shiftKey ? "rangeAdd" : "toggle")}
            />
          </td>
          {attentionCol && <td className="cell-attention" />}
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
            <span className="scheduled-date-text">{fmt.date(s.date_next)}</span>
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
          <td
            data-field="payee"
            title={
              s.transfer_account_name
                ? transferPayeeName(s.transfer_account_name)
                : (s.payee_name ?? undefined)
            }
          >
            {payeeCellOf(s)}
          </td>
          {showCategory && <td data-field="category">{categoryCellOf(s)}</td>}
          <td data-field="memo" title={s.memo ?? undefined}>
            {s.memo}
          </td>
          <td data-field="outflow" className="num">
            {s.amount < 0 ? fmt.abs(s.amount) : null}
          </td>
          <td data-field="inflow" className="num">
            {s.amount > 0 ? fmt.abs(s.amount) : null}
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
