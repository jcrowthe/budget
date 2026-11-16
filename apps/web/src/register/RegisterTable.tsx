import { sidebarSections } from "@budget/core/account-types";
import type { Account } from "@budget/schema/accounts";
import {
  categoryCell,
  type PlanSortColumn,
  REGISTER_CREDIT_TYPES,
  type SortDir,
  sortTransactions,
} from "@budget/schema/register";
import type { TransactionDetail } from "@budget/schema/transactions";
import { transferCellText } from "@budget/schema/transfers";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAccounts } from "../api/accounts";
import { useAccountTransactions, usePlanTransactions, useSetCleared } from "../api/transactions";
import { accountPath } from "../shell/planPaths";
import { Box } from "./Box";
import { EntryRow } from "./EntryRow";
import type { Field, Open } from "./entryDraft";
import { registerDate, registerMoney } from "./format";
import {
  CaretDownIcon,
  CaretUpIcon,
  ChevronRightIcon,
  ClearedFilledIcon,
  ClearedOutlineIcon,
  LockIcon,
  TransferIcon,
} from "./icons";

const CLEARED_TIP = "Marking a transaction as 'cleared' means it has posted to your bank account.";

type Row = TransactionDetail & { account_name?: string };

type Header = { column: PlanSortColumn; label: string; numeric?: boolean };

const ACCOUNT_HEADER: Header = { column: "account", label: "ACCOUNT" };

const HEADERS: Header[] = [
  { column: "date", label: "DATE" },
  { column: "payee", label: "PAYEE" },
  { column: "category", label: "CATEGORY" },
  { column: "memo", label: "MEMO" },
  { column: "outflow", label: "OUTFLOW", numeric: true },
  { column: "inflow", label: "INFLOW", numeric: true },
];

function ClearedCell({ tx, onToggle }: { tx: Row; onToggle: () => void }) {
  const reconciled = tx.cleared === "reconciled";
  return (
    <button
      type="button"
      className={`cleared-button is-${tx.cleared}`}
      aria-label={`This transaction is ${tx.cleared}`}
      title={reconciled ? "This transaction is reconciled" : CLEARED_TIP}
      disabled={reconciled}
      onClick={onToggle}
    >
      {reconciled ? (
        <LockIcon />
      ) : tx.cleared === "cleared" ? (
        <ClearedFilledIcon />
      ) : (
        <ClearedOutlineIcon />
      )}
    </button>
  );
}

/** One account's rows, or (without `account`) every account's rows with an ACCOUNT column. */
export function RegisterTable({
  budgetId,
  account,
  open,
  onOpen,
  onCloseEntry,
  onSaved,
}: {
  budgetId: string;
  account?: Account;
  open: Open;
  onOpen: (next: Open) => void;
  onCloseEntry: () => void;
  onSaved: (next: "close" | "again", date: string) => void;
}) {
  const plan = !account;
  const accountQ = useAccountTransactions(budgetId, account?.id ?? "", !plan);
  const planQ = usePlanTransactions(budgetId, plan);
  const q = plan ? planQ : accountQ;
  const accountsQ = useAccounts(budgetId);
  const byId = useMemo(
    () => new Map((accountsQ.data ?? []).map((a) => [a.id, a])),
    [accountsQ.data],
  );
  const setCleared = useSetCleared(
    budgetId,
    plan ? ["transactions", budgetId, "all"] : ["transactions", budgetId, account.id],
  );
  const [sort, setSort] = useState<{ column: PlanSortColumn; dir: SortDir }>({
    column: "date",
    dir: "desc",
  });
  const openAccounts = useMemo(
    () =>
      sidebarSections(accountsQ.data ?? [])
        .filter((s) => s.name !== "starred" && s.name !== "closed")
        .flatMap((s) => s.rows),
    [accountsQ.data],
  );
  const navigate = useNavigate();
  const location = useLocation();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const showCategory = plan || account.on_budget;
  const columns = [...(plan ? [ACCOUNT_HEADER] : []), ...HEADERS].filter(
    (h) => showCategory || h.column !== "category",
  );
  const colCount = columns.length + 2;
  const data = q.data;
  const rows = useMemo(
    () => (data ? sortTransactions<Row>(data.transactions, sort.column, sort.dir) : []),
    [data, sort],
  );

  const clickHeader = (column: PlanSortColumn) =>
    setSort((s) =>
      s.column === column
        ? { column, dir: s.dir === "desc" ? "asc" : "desc" }
        : { column, dir: "desc" },
    );
  const allState: boolean | "mixed" =
    rows.length > 0 && selected.size === rows.length ? true : selected.size > 0 ? "mixed" : false;
  const toggleAll = () =>
    setSelected(allState === true ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleRow = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  const accountOf = (tx: Row) =>
    account ?? byId.get(tx.account_id) ?? { type: "checking", on_budget: true };
  const isLockedStart = (tx: Row) =>
    tx.payee_system === "starting_balance" && REGISTER_CREDIT_TYPES.includes(accountOf(tx).type);
  const editAt = open?.mode === "edit" ? rows.findIndex((r) => r.id === open.id) : -1;
  const editTx = editAt >= 0 ? rows[editAt] : undefined;

  const openEdit = (tx: Row, field: Field, openCategory = false) => {
    setSelected(new Set([tx.id]));
    onOpen({ mode: "edit", id: tx.id, focus: field, openCategory });
  };

  // The ⇆ icon opens the other account's register with the paired row selected and in view.
  const wanted = (location.state as { select?: string } | null)?.select;
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per visit, when the rows are there
  useEffect(() => {
    if (!wanted || rows.length === 0 || !rows.some((r) => r.id === wanted)) return;
    setSelected(new Set([wanted]));
    document.querySelector(`tr[data-tx="${wanted}"]`)?.scrollIntoView({ block: "center" });
  }, [wanted, location.key, rows.length > 0]);

  // S turns the selected saved row into a split (or opens a split).
  const splittable = (tx: Row) =>
    accountOf(tx).on_budget &&
    tx.cleared !== "reconciled" &&
    !tx.transfer_account_id &&
    !isLockedStart(tx);
  const only = selected.size === 1 ? rows.find((r) => selected.has(r.id)) : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the handler reads the current rows and selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "s" && e.key !== "S") return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || open) return;
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el && (el.closest("input,textarea,select,button") !== null || el.isContentEditable)) {
        return;
      }
      if (document.querySelector('[aria-modal="true"]')) return;
      if (!only || !splittable(only)) return;
      e.preventDefault();
      setSelected(new Set([only.id]));
      onOpen({ mode: "edit", id: only.id, focus: "category", split: true });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [only, open, accountsQ.data]);
  const fieldOf = (e: React.MouseEvent): Field =>
    ((e.target as HTMLElement).closest<HTMLElement>("td[data-field]")?.dataset.field as Field) ??
    "date";
  const isControl = (e: React.MouseEvent) =>
    !!(e.target as HTMLElement).closest("button,input,[role=checkbox]");
  const onRowClick = (e: React.MouseEvent, tx: Row) => {
    if (isControl(e)) return;
    if (tx.cleared === "reconciled") {
      setSelected(new Set([tx.id]));
      return;
    }
    if (selected.has(tx.id)) openEdit(tx, fieldOf(e));
    else {
      setSelected(new Set([tx.id]));
      if (open) onCloseEntry();
    }
  };

  const toggleCollapsed = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  const dataRow = (tx: Row) => {
    const transferAccount = tx.transfer_account_id ? byId.get(tx.transfer_account_id) : undefined;
    const cell = categoryCell(tx, accountOf(tx), transferAccount ?? null);
    const checked = selected.has(tx.id);
    const lines = tx.subtransactions;
    const expanded = !collapsed.has(tx.id);
    const rowProps = {
      onClick: (e: React.MouseEvent) => onRowClick(e, tx),
      onDoubleClick: (e: React.MouseEvent) => {
        if (isControl(e) || tx.cleared === "reconciled") return;
        openEdit(tx, fieldOf(e));
      },
    };
    return (
      <Fragment key={tx.id}>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: rows open from their own keyboard-reachable buttons and checkboxes */}
        <tr data-tx={tx.id} className={checked ? "is-checked" : undefined} {...rowProps}>
          <td className="cell-check">
            <Box state={checked} label="Select transaction" onClick={() => toggleRow(tx.id)} />
          </td>
          {plan && (
            <td data-field="account" title={tx.account_name}>
              {tx.account_name}
            </td>
          )}
          <td data-field="date">{registerDate(tx.date)}</td>
          {tx.transfer_account_id && tx.transfer_account_name ? (
            <td data-field="payee" title={tx.payee_name ?? undefined}>
              <span className="transfer-payee">
                <span className="transfer-name">{transferCellText(tx.transfer_account_name)}</span>
                <button
                  type="button"
                  className="transfer-link"
                  title="Click to jump to the other side of this transfer"
                  aria-label="Click to jump to the other side of this transfer"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(accountPath(budgetId, tx.transfer_account_id as string), {
                      state: { select: tx.transfer_transaction_id },
                    });
                  }}
                >
                  <TransferIcon />
                </button>
              </span>
            </td>
          ) : (
            <td data-field="payee" title={tx.payee_name ?? undefined}>
              {tx.payee_name}
            </td>
          )}
          {showCategory && (
            <td data-field="category" title={cell.kind === "text" ? cell.text : undefined}>
              {cell.kind === "split" ? (
                <span className="split-parent">
                  <button
                    type="button"
                    className="split-chevron"
                    aria-label={expanded ? "Collapse split" : "Expand split"}
                    aria-expanded={expanded}
                    onClick={() => toggleCollapsed(tx.id)}
                  >
                    {expanded ? <CaretDownIcon /> : <ChevronRightIcon />}
                  </button>
                  Split (Multiple Categories)...
                </span>
              ) : cell.kind === "text" ? (
                cell.text
              ) : cell.kind === "notNeeded" ? (
                <span className="category-not-needed">Category not needed</span>
              ) : tx.cleared === "reconciled" ? (
                <span className="needs-category">This needs a category</span>
              ) : (
                <button
                  type="button"
                  className="needs-category"
                  onClick={() => openEdit(tx, "category", true)}
                >
                  This needs a category
                </button>
              )}
            </td>
          )}
          <td data-field="memo" title={tx.memo ?? undefined}>
            {tx.memo}
          </td>
          <td data-field="outflow" className="num">
            {tx.amount < 0 ? registerMoney(tx.amount) : null}
          </td>
          <td data-field="inflow" className="num">
            {tx.amount > 0 ? registerMoney(tx.amount) : null}
          </td>
          <td className="cell-cleared">
            <ClearedCell
              tx={tx}
              onToggle={() =>
                setCleared.mutate({
                  id: tx.id,
                  cleared: tx.cleared === "cleared" ? "uncleared" : "cleared",
                })
              }
            />
          </td>
        </tr>
        {lines.length > 0 &&
          expanded &&
          lines.map((l) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: a line acts on its parent like the parent row
            <tr
              key={l.id}
              className={`split-line-row${checked ? " is-checked" : ""}`}
              data-line-of={tx.id}
              {...rowProps}
            >
              <td className="cell-check" />
              {plan && <td />}
              <td />
              <td data-field="payee" title={l.payee_name ?? undefined}>
                {l.payee_name}
              </td>
              {showCategory && (
                <td data-field="category">
                  {l.category_name ? (
                    l.category_group_name ? (
                      `${l.category_group_name}: ${l.category_name}`
                    ) : (
                      l.category_name
                    )
                  ) : l.inflow_to_ready_to_assign ? (
                    "Inflow: Ready to Assign"
                  ) : (
                    <span className="needs-category">This needs a category</span>
                  )}
                </td>
              )}
              <td data-field="memo" title={l.memo ?? undefined}>
                {l.memo}
              </td>
              <td data-field="outflow" className="num">
                {l.amount < 0 ? registerMoney(l.amount) : null}
              </td>
              <td data-field="inflow" className="num">
                {l.amount > 0 ? registerMoney(l.amount) : null}
              </td>
              <td className="cell-cleared" />
            </tr>
          ))}
      </Fragment>
    );
  };

  return (
    <div className="register-scroll">
      <table
        className={`register-table${showCategory ? "" : " no-category"}`}
        aria-label={`${account?.name ?? "All Accounts"} transactions`}
        aria-busy={q.isPending}
      >
        <colgroup>
          <col className="col-check" />
          {plan && <col className="col-account" />}
          <col className="col-date" />
          <col className="col-payee" />
          {showCategory && <col className="col-category" />}
          <col className="col-memo" />
          <col className="col-amount" />
          <col className="col-amount" />
          <col className="col-cleared" />
        </colgroup>
        <thead>
          <tr>
            <th className="cell-check">
              <Box state={allState} label="Select all transactions" onClick={toggleAll} />
            </th>
            {columns.map((h) => {
              const active = sort.column === h.column;
              return (
                <th
                  key={h.column}
                  className={`sortable${h.numeric ? " num" : ""}${active ? " is-active" : ""}`}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                >
                  <button
                    type="button"
                    className="sort-button"
                    onClick={() => clickHeader(h.column)}
                  >
                    {h.label}
                  </button>
                  {active &&
                    (sort.dir === "asc" ? (
                      <CaretUpIcon className="sort-icon" />
                    ) : (
                      <CaretDownIcon className="sort-icon" />
                    ))}
                </th>
              );
            })}
            <th className="cell-cleared" title={CLEARED_TIP} aria-label="Cleared">
              <ClearedFilledIcon width={14} height={16} />
            </th>
          </tr>
        </thead>
        {open?.mode === "add" && (
          <EntryRow
            key={`add-${open.key}`}
            budgetId={budgetId}
            mode="add"
            account={account}
            accounts={openAccounts}
            plan={plan}
            showCategory={showCategory}
            date={open.date}
            initialFocus={plan ? "account" : "date"}
            onClose={onCloseEntry}
            onSaved={onSaved}
          />
        )}
        {q.isPending || (q.isError && !data) || (rows.length === 0 && !open) ? (
          <tbody>
            <tr>
              {q.isPending ? (
                <td colSpan={colCount} className="register-message" role="status">
                  Loading transactions…
                </td>
              ) : q.isError && !data ? (
                <td colSpan={colCount} className="register-message" role="alert">
                  <span>Couldn't load transactions.</span>
                  <button type="button" className="toolbar-button" onClick={() => q.refetch()}>
                    Try again
                  </button>
                </td>
              ) : (
                <td colSpan={colCount} className="register-message">
                  No transactions
                </td>
              )}
            </tr>
          </tbody>
        ) : (
          <>
            <tbody>{(editAt < 0 ? rows : rows.slice(0, editAt)).map(dataRow)}</tbody>
            {editTx && open?.mode === "edit" && (
              <EntryRow
                key={`edit-${editTx.id}`}
                budgetId={budgetId}
                mode="edit"
                tx={editTx}
                account={account}
                accounts={openAccounts}
                plan={plan}
                showCategory={showCategory}
                lockStart={isLockedStart(editTx)}
                initialFocus={open.focus}
                openCategory={open.openCategory}
                startSplit={open.split}
                onClose={onCloseEntry}
                onSaved={onSaved}
              />
            )}
            {editAt >= 0 && <tbody>{rows.slice(editAt + 1).map(dataRow)}</tbody>}
          </>
        )}
      </table>
    </div>
  );
}
