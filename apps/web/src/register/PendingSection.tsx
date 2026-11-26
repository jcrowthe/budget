import type { Account } from "@budget/schema/accounts";
import type { PlanTransaction } from "@budget/schema/transactions";
import { useEffect, useState } from "react";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { PendingAttentionCell } from "./AttentionMenu";
import { EntryRow } from "./EntryRow";
import type { Field, Open } from "./entryDraft";
import { CaretDownIcon, ChevronRightIcon, ClockOutlineIcon } from "./icons";
import { useRegisterView } from "./register-view";

const COLLAPSED_KEY = "register.pending-collapsed";
const readCollapsed = () => {
  try {
    return sessionStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * EXF-466: the "Pending Transactions" section at the top of a linked account's register: the bank's pending items,
 * muted, in no balance. A header collapses it (the state is kept for the tab); the circled "i" of a row offers
 * Enter Now, and any edit of a row enters it.
 */
export function PendingSection({
  budgetId,
  account,
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
  account: Account;
  showCategory: boolean;
  colCount: number;
  rows: PlanTransaction[];
  open: Open;
  onOpen: (next: Open) => void;
  onCloseEntry: () => void;
  onSaved: (next: "close" | "again", date: string) => void;
  accounts: Account[];
}) {
  const fmt = usePlanFormatter();
  const { showFlags, showBalance } = useRegisterView();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  useEffect(() => {
    try {
      sessionStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // The state is only remembered while storage works.
    }
  }, [collapsed]);
  if (rows.length === 0) return null;

  const fieldOf = (e: React.MouseEvent): Field =>
    ((e.target as HTMLElement).closest<HTMLElement>("td[data-field]")?.dataset.field as Field) ??
    "date";
  const isControl = (e: React.MouseEvent) =>
    !!(e.target as HTMLElement).closest("button,input,[role=checkbox]");
  const editAt = open?.mode === "editPending" ? rows.findIndex((r) => r.id === open.id) : -1;
  const editRow = editAt >= 0 ? rows[editAt] : undefined;
  const openEdit = (tx: PlanTransaction, field: Field) =>
    onOpen({ mode: "editPending", id: tx.id, focus: field });

  const dataRow = (tx: PlanTransaction) => (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a row opens from its own keyboard-reachable circled "i" menu
    <tr
      key={tx.id}
      data-pending={tx.id}
      className="pending-row"
      onClick={(e) => {
        if (!isControl(e)) openEdit(tx, fieldOf(e));
      }}
    >
      <td className="cell-check" />
      <td className="cell-attention">
        <PendingAttentionCell budgetId={budgetId} tx={tx} />
      </td>
      {showFlags && <td className="cell-flag" />}
      <td data-field="date">{fmt.date(tx.date)}</td>
      <td data-field="payee" title={tx.payee_name ?? undefined}>
        {tx.payee_name}
      </td>
      {showCategory && <td data-field="category" />}
      <td data-field="memo" />
      <td data-field="outflow" className="num">
        {tx.amount < 0 ? fmt.abs(tx.amount) : null}
      </td>
      <td data-field="inflow" className="num">
        {tx.amount > 0 ? fmt.abs(tx.amount) : null}
      </td>
      {showBalance && <td className="num cell-balance" />}
      <td className="cell-cleared" />
    </tr>
  );

  return (
    <>
      <tbody className="pending-head" aria-label="Pending Transactions">
        <tr>
          <td colSpan={colCount} className="pending-header-cell">
            <button
              type="button"
              className="pending-header"
              aria-expanded={!collapsed}
              onClick={() => setCollapsed((c) => !c)}
            >
              <ClockOutlineIcon />
              <span className="pending-title">Pending Transactions</span>
              <span className="pending-count">{rows.length}</span>
              <span className="pending-chevron" data-chevron={collapsed ? "right" : "down"}>
                {collapsed ? <ChevronRightIcon /> : <CaretDownIcon />}
              </span>
            </button>
          </td>
        </tr>
      </tbody>
      {!collapsed && (
        <>
          <tbody className="pending-rows">
            {(editAt < 0 ? rows : rows.slice(0, editAt)).map(dataRow)}
          </tbody>
          {editRow && open?.mode === "editPending" && (
            <EntryRow
              key={`edit-pending-${editRow.id}`}
              budgetId={budgetId}
              mode="editPending"
              tx={editRow}
              account={account}
              accounts={accounts}
              plan={false}
              showCategory={showCategory}
              initialFocus={open.focus}
              onClose={onCloseEntry}
              onSaved={onSaved}
            />
          )}
          {editAt >= 0 && (
            <tbody className="pending-rows">{rows.slice(editAt + 1).map(dataRow)}</tbody>
          )}
        </>
      )}
      <tbody className="pending-spacer-body">
        <tr className="pending-spacer">
          <td colSpan={colCount} />
        </tr>
      </tbody>
    </>
  );
}
