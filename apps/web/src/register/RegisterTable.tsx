import type { Account } from "@budget/schema/accounts";
import {
  categoryCell,
  type PlanSortColumn,
  type SortDir,
  sortTransactions,
} from "@budget/schema/register";
import type { TransactionDetail } from "@budget/schema/transactions";
import { useMemo, useState } from "react";
import { useAccounts } from "../api/accounts";
import { useAccountTransactions, usePlanTransactions, useSetCleared } from "../api/transactions";
import { registerDate, registerMoney } from "./format";
import {
  CaretDownIcon,
  CaretUpIcon,
  CheckIcon,
  ClearedFilledIcon,
  ClearedOutlineIcon,
  LockIcon,
  MinusIcon,
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

function Box({
  state,
  label,
  onClick,
}: {
  state: boolean | "mixed";
  label: string;
  onClick: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a custom box with a "mixed" state, drawn as the source does
    <button
      type="button"
      role="checkbox"
      aria-checked={state}
      aria-label={label}
      className={`register-checkbox${state ? " is-on" : ""}`}
      onClick={onClick}
    >
      <span className="box">
        {state === "mixed" ? <MinusIcon /> : state ? <CheckIcon /> : null}
      </span>
    </button>
  );
}

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
export function RegisterTable({ budgetId, account }: { budgetId: string; account?: Account }) {
  const plan = !account;
  const accountQ = useAccountTransactions(budgetId, account?.id ?? "", !plan);
  const planQ = usePlanTransactions(budgetId, plan);
  const q = plan ? planQ : accountQ;
  const accountsQ = useAccounts(plan ? budgetId : undefined);
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
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
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
        <tbody>
          {q.isPending ? (
            <tr>
              <td colSpan={colCount} className="register-message" role="status">
                Loading transactions…
              </td>
            </tr>
          ) : q.isError && !data ? (
            <tr>
              <td colSpan={colCount} className="register-message" role="alert">
                <span>Couldn't load transactions.</span>
                <button type="button" className="toolbar-button" onClick={() => q.refetch()}>
                  Try again
                </button>
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="register-message">
                No transactions
              </td>
            </tr>
          ) : (
            rows.map((tx) => {
              const cell = categoryCell(
                tx,
                account ?? byId.get(tx.account_id) ?? { type: "checking", on_budget: true },
              );
              const checked = selected.has(tx.id);
              return (
                <tr key={tx.id} className={checked ? "is-checked" : undefined}>
                  <td className="cell-check">
                    <Box
                      state={checked}
                      label="Select transaction"
                      onClick={() => toggleRow(tx.id)}
                    />
                  </td>
                  {plan && <td title={tx.account_name}>{tx.account_name}</td>}
                  <td>{registerDate(tx.date)}</td>
                  <td title={tx.payee_name ?? undefined}>{tx.payee_name}</td>
                  {showCategory && (
                    <td title={cell.kind === "text" ? cell.text : undefined}>
                      {cell.kind === "text" ? (
                        cell.text
                      ) : cell.kind === "notNeeded" ? (
                        <span className="category-not-needed">Category not needed</span>
                      ) : (
                        <span className="needs-category">This needs a category</span>
                      )}
                    </td>
                  )}
                  <td title={tx.memo ?? undefined}>{tx.memo}</td>
                  <td className="num">{tx.amount < 0 ? registerMoney(tx.amount) : null}</td>
                  <td className="num">{tx.amount > 0 ? registerMoney(tx.amount) : null}</td>
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
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
