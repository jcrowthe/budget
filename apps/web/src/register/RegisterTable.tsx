import { sidebarSections } from "@budget/core/account-types";
import type { Account } from "@budget/schema/accounts";
import { NEEDS_CATEGORY_TIP, needsAttention } from "@budget/schema/attention";
import { paymentDisplay, paymentPrefill } from "@budget/schema/card-payments";
import {
  categoryCell,
  type PlanSortColumn,
  REGISTER_CREDIT_TYPES,
  type SortDir,
  sortTransactions,
} from "@budget/schema/register";
import { registerVisible } from "@budget/schema/register-view";
import type { ScheduledTransaction } from "@budget/schema/scheduled-transactions";
import { lineMatches } from "@budget/schema/transaction-search";
import type { TransactionDetail } from "@budget/schema/transactions";
import { transferCellText } from "@budget/schema/transfers";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useReconcile } from "../account/ReconcileContext";
import { useAccounts } from "../api/accounts";
import { localToday } from "../api/today";
import {
  transactionsKey,
  useAccountTransactions,
  usePlanTransactions,
  useSetCleared,
  useSetFlag,
} from "../api/transactions";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { accountPath } from "../shell/planPaths";
import { AttentionCell } from "./AttentionMenu";
import { AttentionColumnContext, useAttentionFilter } from "./attention-filter";
import { Box } from "./Box";
import { EntryRow } from "./EntryRow";
import type { Field, Open } from "./entryDraft";
import { FlagCell } from "./FlagMenu";
import {
  CaretDownIcon,
  CaretUpIcon,
  ChevronRightIcon,
  ClearedFilledIcon,
  ClearedOutlineIcon,
  FlagFilledIcon,
  InfoCircleFillIcon,
  LockIcon,
  TransferIcon,
} from "./icons";
import { MatchCell } from "./manual-match-details";
import { useOpenAccounts } from "./openAccounts";
import type { RegisterSearchState } from "./RegisterSearch";
import { firstTokenText } from "./register-search";
import { useRegisterView } from "./register-view";
import { BankImportButton, ImportedPayeeName } from "./rename-rules-bank-import";
import { ScheduledSection, useScheduledRows } from "./ScheduledSection";
import { useSelection } from "./selection";

const CLEARED_TIP = "Marking a transaction as 'cleared' means it has posted to your bank account.";

const SPLIT_TEXT = "Split (Multiple Categories)...";

/** What a split line's category cell shows as text; none for the pill. */
function lineCategoryText(l: {
  category_name: string | null;
  category_group_name: string | null;
  inflow_to_ready_to_assign: boolean;
}): string | undefined {
  if (l.category_name) {
    return l.category_group_name ? `${l.category_group_name}: ${l.category_name}` : l.category_name;
  }
  return l.inflow_to_ready_to_assign ? "Inflow: Ready to Assign" : undefined;
}

type Row = TransactionDetail & { account_name?: string; running_balance?: number };

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

// One array for "no scheduled rows": a new `[]` each render would reach the selection's setScheduledRows and
// re-render the page without end (it also stalled navigation while the attention filter was on).
const NO_SCHEDULED: ScheduledTransaction[] = [];

/** One account's rows, or (without `account`) every account's rows with an ACCOUNT column. */
export function RegisterTable({
  budgetId,
  account,
  search,
  open,
  onOpen,
  onCloseEntry,
  onSaved,
}: {
  budgetId: string;
  account?: Account;
  /** EXF-528: the applied search; its rows come from the server, whatever the View options say. */
  search: RegisterSearchState;
  open: Open;
  onOpen: (next: Open) => void;
  onCloseEntry: () => void;
  onSaved: (next: "close" | "again", date: string) => void;
}) {
  const fmt = usePlanFormatter();
  const plan = !account;
  const searching = search.applied !== "";
  const firstText = firstTokenText(search.applied, {
    dateFormat: fmt.dateFormat,
    today: localToday(),
  });
  const accountQ = useAccountTransactions(budgetId, account?.id ?? "", !plan, search.applied);
  const planQ = usePlanTransactions(budgetId, plan, search.applied);
  const q = plan ? planQ : accountQ;
  const accountsQ = useAccounts(budgetId);
  const byId = useMemo(
    () => new Map((accountsQ.data ?? []).map((a) => [a.id, a])),
    [accountsQ.data],
  );
  const listKey = transactionsKey(budgetId, plan ? "all" : account.id, search.applied);
  const setCleared = useSetCleared(budgetId, listKey);
  const setFlag = useSetFlag(budgetId, listKey);
  const [sort, setSort] = useState<{ column: PlanSortColumn; dir: SortDir }>({
    column: "date",
    dir: "desc",
  });
  const { openAccounts } = useOpenAccounts(budgetId);
  const navigate = useNavigate();
  const location = useLocation();
  const { selected, set: setSelected, pick, setRows } = useSelection();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const showCategory = plan || account.on_budget;
  const columns = [...(plan ? [ACCOUNT_HEADER] : []), ...HEADERS].filter(
    (h) => showCategory || h.column !== "category",
  );
  const view = useRegisterView();
  const { showFlags, showBalance } = view;
  const data = q.data;
  const scheduledRows = useScheduledRows(budgetId, account?.id, sort);
  const reconcileMode = useReconcile()?.step === "mode";
  const attention = useAttentionFilter().on;
  const openIds = useMemo(() => new Set(openAccounts.map((a) => a.id)), [openAccounts]);
  const { rows, hidden } = useMemo(() => {
    if (!data) return { rows: [] as Row[], hidden: 0 };
    if (attention) {
      // View: every row that needs attention, whatever the View options hide (the banner's N and these rows agree).
      const need = data.transactions.filter(
        (tx) =>
          (account || openIds.has(tx.account_id)) &&
          needsAttention(
            tx,
            account ?? byId.get(tx.account_id) ?? { on_budget: true },
            tx.transfer_account_id ? (byId.get(tx.transfer_account_id) ?? null) : null,
          ),
      );
      return { rows: sortTransactions<Row>(need, sort.column, sort.dir), hidden: 0 };
    }
    if (searching) {
      // A match is never hidden by the View date range or the reconciled option.
      return { rows: sortTransactions<Row>(data.transactions, sort.column, sort.dir), hidden: 0 };
    }
    const shown = registerVisible<Row>(
      data.transactions,
      view.settings,
      view.today,
      view.firstMonth,
      reconcileMode,
    );
    return { rows: sortTransactions<Row>(shown.rows, sort.column, sort.dir), hidden: shown.hidden };
  }, [
    data,
    sort,
    view.settings,
    view.today,
    view.firstMonth,
    reconcileMode,
    attention,
    searching,
    openIds,
    byId,
    account,
  ]);

  // Source: the attention column is display:none when no listed row needs approval.
  const attentionCol = rows.some((r) => !r.approved || r.matched);
  const colCount =
    columns.length + 2 + (attentionCol ? 1 : 0) + (showFlags ? 1 : 0) + (showBalance ? 1 : 0);

  // The selection and the bar read the rows as shown; ids that left the list drop out of the selection.
  useEffect(() => setRows(rows), [rows, setRows]);
  useEffect(() => {
    if (!data) return;
    const live = new Set(rows.map((r) => r.id));
    if ([...selected].some((id) => !live.has(id))) {
      setSelected([...selected].filter((id) => live.has(id)));
    }
  }, [data, rows, selected, setSelected]);

  const clickHeader = (column: PlanSortColumn) =>
    setSort((s) =>
      s.column === column
        ? { column, dir: s.dir === "desc" ? "asc" : "desc" }
        : { column, dir: "desc" },
    );
  const allState: boolean | "mixed" =
    rows.length > 0 && selected.size === rows.length ? true : selected.size > 0 ? "mixed" : false;
  const toggleAll = () => setSelected(allState === true ? [] : rows.map((r) => r.id));

  const accountOf = (tx: Row) =>
    account ?? byId.get(tx.account_id) ?? { type: "checking", on_budget: true };
  const isLockedStart = (tx: Row) =>
    tx.payee_system === "starting_balance" && REGISTER_CREDIT_TYPES.includes(accountOf(tx).type);
  const editAt = open?.mode === "edit" ? rows.findIndex((r) => r.id === open.id) : -1;
  const editTx = editAt >= 0 ? rows[editAt] : undefined;

  const openEdit = (tx: Row, field: Field, openCategory = false) => {
    pick("real", tx.id, "only");
    onOpen({ mode: "edit", id: tx.id, focus: field, openCategory });
  };

  // The ⇆ icon, and an Undo or Redo, open a register with rows selected and in view: `state.select` is one id or
  // several. Each navigation (`location.key`) applies once, as soon as any of the ids is among the rows.
  const picked = (location.state as { select?: string | string[] } | null)?.select;
  const wanted = picked === undefined ? [] : Array.isArray(picked) ? picked : [picked];
  const present = wanted.filter((id) => rows.some((r) => r.id === id));
  const applied = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per visit, when the rows are there
  useEffect(() => {
    if (present.length === 0 || applied.current === location.key) return;
    applied.current = location.key;
    setSelected(present);
    document.querySelector(`tr[data-tx="${present[0]}"]`)?.scrollIntoView({ block: "center" });
  }, [wanted.join(","), location.key, present.length]);

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
      setSelected([only.id]);
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
    if (e.shiftKey) {
      // EXF-635: Shift+click selects the range from the anchor; it never opens editing.
      pick("real", tx.id, "rangeOnly");
      if (open) onCloseEntry();
      return;
    }
    if (selected.has(tx.id) && selected.size > 1) {
      // Several are selected: a click on one of them selects only that row.
      pick("real", tx.id, "only");
      if (open) onCloseEntry();
    } else if (selected.has(tx.id)) openEdit(tx, fieldOf(e));
    else {
      pick("real", tx.id, "only");
      if (open) onCloseEntry();
    }
  };
  /** Shift+click must not start a text selection. */
  const noShiftSelect = (e: React.MouseEvent) => {
    if (e.shiftKey) e.preventDefault();
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
    // D3: a transfer between a card and an on-plan cash account reads as a payment on both sides.
    const sideAcct = account ?? byId.get(tx.account_id);
    const pay = transferAccount && sideAcct ? paymentDisplay(sideAcct, transferAccount) : null;
    const checked = selected.has(tx.id);
    // A search shows the lines that match; when none does the parent matched on its own, so all show.
    const parentOf = {
      payee_name: tx.payee_name,
      account_name: account?.name ?? byId.get(tx.account_id)?.name,
    };
    const matching = searching
      ? tx.subtransactions.filter((l) => lineMatches(search.tokens, l, parentOf))
      : [];
    const lines = searching && matching.length > 0 ? matching : tx.subtransactions;
    const expanded = !collapsed.has(tx.id);
    const rowProps = {
      onClick: (e: React.MouseEvent) => onRowClick(e, tx),
      onMouseDown: noShiftSelect,
      onDoubleClick: (e: React.MouseEvent) => {
        if (isControl(e)) return;
        openEdit(tx, fieldOf(e));
      },
    };
    return (
      <Fragment key={tx.id}>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: rows open from their own keyboard-reachable buttons and checkboxes */}
        <tr
          data-tx={tx.id}
          className={
            [checked && "is-checked", !tx.approved && "is-unapproved"].filter(Boolean).join(" ") ||
            undefined
          }
          {...rowProps}
        >
          <td className="cell-check">
            <Box
              state={checked}
              label="Select transaction"
              onClick={(e) => pick("real", tx.id, e.shiftKey ? "rangeAdd" : "toggle")}
            />
          </td>
          {attentionCol && (
            <td className="cell-attention">
              {!tx.approved ? (
                <AttentionCell budgetId={budgetId} tx={tx} />
              ) : tx.matched && tx.match_details ? (
                <MatchCell budgetId={budgetId} tx={tx} />
              ) : null}
            </td>
          )}
          {showFlags && (
            <td className="cell-flag">
              <FlagCell
                color={tx.flag_color}
                onPick={(color) => setFlag.mutate({ id: tx.id, color })}
              />
            </td>
          )}
          {plan && (
            <td data-field="account" title={tx.account_name}>
              {tx.account_name}
            </td>
          )}
          <td data-field="date">{fmt.date(tx.date)}</td>
          {tx.transfer_account_id && tx.transfer_account_name ? (
            <td data-field="payee" title={pay?.payee ?? tx.payee_name ?? undefined}>
              <span className="transfer-payee">
                <span className="transfer-name">
                  {pay?.payee ?? transferCellText(tx.transfer_account_name)}
                </span>
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
          ) : tx.source !== null || tx.import_payee_name !== null ? (
            <td data-field="payee">
              <span className="import-payee">
                <ImportedPayeeName tx={tx} />
                <BankImportButton budgetId={budgetId} tx={tx} />
              </span>
            </td>
          ) : (
            <td data-field="payee" title={tx.payee_name ?? undefined}>
              {tx.payee_name}
            </td>
          )}
          {showCategory && (
            <td
              data-field="category"
              title={
                pay?.category ??
                (cell.kind === "text"
                  ? cell.text
                  : cell.kind === "split"
                    ? SPLIT_TEXT
                    : cell.kind === "notNeeded"
                      ? "Category not needed"
                      : undefined)
              }
            >
              {pay ? (
                pay.category
              ) : cell.kind === "split" ? (
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
                  {SPLIT_TEXT}
                </span>
              ) : cell.kind === "text" ? (
                cell.text
              ) : cell.kind === "notNeeded" ? (
                <span className="category-not-needed">Category not needed</span>
              ) : (
                <button
                  type="button"
                  className="needs-category"
                  title={NEEDS_CATEGORY_TIP}
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
            {tx.amount < 0 ? fmt.abs(tx.amount) : null}
          </td>
          <td data-field="inflow" className="num">
            {tx.amount > 0 ? fmt.abs(tx.amount) : null}
          </td>
          {showBalance && (
            <td
              className={`num cell-balance${(tx.running_balance ?? 0) < 0 ? " is-negative" : ""}`}
              data-field="balance"
            >
              {tx.running_balance === undefined ? null : fmt.money(tx.running_balance)}
            </td>
          )}
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
              className={`split-line-row${checked ? " is-checked" : ""}${tx.approved ? "" : " is-unapproved"}`}
              data-line-of={tx.id}
              {...rowProps}
            >
              <td className="cell-check" />
              {attentionCol && <td className="cell-attention" />}
              {showFlags && <td className="cell-flag" />}
              {plan && <td />}
              <td />
              <td data-field="payee" title={l.payee_name ?? undefined}>
                {l.payee_name}
              </td>
              {showCategory && (
                <td data-field="category" title={lineCategoryText(l)}>
                  {l.category_name ? (
                    l.category_group_name ? (
                      `${l.category_group_name}: ${l.category_name}`
                    ) : (
                      l.category_name
                    )
                  ) : l.inflow_to_ready_to_assign ? (
                    "Inflow: Ready to Assign"
                  ) : (
                    <span className="needs-category" title={NEEDS_CATEGORY_TIP}>
                      This needs a category
                    </span>
                  )}
                </td>
              )}
              <td data-field="memo" title={l.memo ?? undefined}>
                {l.memo}
              </td>
              <td data-field="outflow" className="num">
                {l.amount < 0 ? fmt.abs(l.amount) : null}
              </td>
              <td data-field="inflow" className="num">
                {l.amount > 0 ? fmt.abs(l.amount) : null}
              </td>
              {showBalance && <td className="num cell-balance" />}
              <td className="cell-cleared" />
            </tr>
          ))}
      </Fragment>
    );
  };

  return (
    <AttentionColumnContext.Provider value={attentionCol}>
      <div className="register-scroll">
        <table
          className={`register-table${showCategory ? "" : " no-category"}${showBalance ? " has-balance" : ""}${showFlags ? "" : " no-flags"}${scheduledRows.length > 0 ? " has-scheduled" : ""}${plan ? " has-account" : ""}`}
          aria-label={`${account?.name ?? "All Accounts"} transactions`}
          aria-busy={q.isPending || !view.ready}
        >
          <colgroup>
            <col className="col-check" />
            {attentionCol && <col className="col-attention" />}
            {showFlags && <col className="col-flag" />}
            {plan && <col className="col-account" />}
            <col className="col-date" />
            <col className="col-payee" />
            {showCategory && <col className="col-category" />}
            <col className="col-memo" />
            <col className="col-amount" />
            <col className="col-amount" />
            {showBalance && <col className="col-balance" />}
            <col className="col-cleared" />
          </colgroup>
          <thead>
            <tr>
              <th className="cell-check">
                <Box state={allState} label="Select all transactions" onClick={toggleAll} />
              </th>
              {attentionCol && (
                <th className="cell-attention" aria-label="Approval">
                  <InfoCircleFillIcon width={14} height={16} />
                </th>
              )}
              {showFlags && (
                <th className="cell-flag" aria-label="Flag">
                  <FlagFilledIcon />
                </th>
              )}
              {columns.map((h) => {
                const active = sort.column === h.column;
                return (
                  <th
                    key={h.column}
                    className={`sortable${h.numeric ? " num" : ""}${active ? " is-active" : ""}`}
                    aria-sort={
                      active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined
                    }
                  >
                    <button
                      type="button"
                      className="sort-button"
                      title={h.label}
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
              {showBalance && (
                <th className="num cell-balance" title="BALANCE">
                  BALANCE
                </th>
              )}
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
              prefillInflow={open.payment ? paymentPrefill(open.payment.inflow, fmt) : undefined}
              onClose={onCloseEntry}
              onSaved={onSaved}
            />
          )}
          <ScheduledSection
            budgetId={budgetId}
            account={account}
            plan={plan}
            showCategory={showCategory}
            colCount={colCount}
            rows={attention || searching ? NO_SCHEDULED : scheduledRows}
            open={open}
            onOpen={onOpen}
            onCloseEntry={onCloseEntry}
            onSaved={onSaved}
            accounts={openAccounts}
          />
          {q.isPending ||
          !view.ready ||
          (q.isError && !data) ||
          (rows.length === 0 &&
            hidden === 0 &&
            (attention || searching ? 0 : scheduledRows.length) === 0 &&
            !searching &&
            !open) ? (
            <tbody>
              <tr>
                {q.isPending || !view.ready ? (
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
              {searching ? (
                <tbody className="register-footer">
                  <tr>
                    <td colSpan={colCount}>
                      <p>{`Some transactions are hidden by your search for "${firstText}".`}</p>
                      <button type="button" className="secondary" onClick={search.clear}>
                        View All
                      </button>
                    </td>
                  </tr>
                </tbody>
              ) : (
                hidden > 0 && (
                  <tbody className="register-footer">
                    <tr>
                      <td colSpan={colCount}>
                        <p>Some transactions are hidden by filters.</p>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => view.save({ preset: "all_dates", show_reconciled: true })}
                        >
                          View All
                        </button>
                      </td>
                    </tr>
                  </tbody>
                )
              )}
            </>
          )}
        </table>
      </div>
    </AttentionColumnContext.Provider>
  );
}
