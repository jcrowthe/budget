import type { PayeeTransaction } from "@budget/schema/payees";
import { PAYEE_TRANSACTIONS_LIMIT } from "@budget/schema/payees";
import { useMemo, useRef, useState } from "react";
import { usePayeeTransactions } from "../api/payees";
import { CloseIcon } from "../shell/icons";
import { usePlanFormatter } from "../shell/plan-formats-context";

type Col = "account" | "date" | "category" | "memo" | "amount";
const COLS: { id: Col; label: string }[] = [
  { id: "account", label: "ACCOUNT" },
  { id: "date", label: "DATE" },
  { id: "category", label: "CATEGORY" },
  { id: "memo", label: "MEMO" },
  { id: "amount", label: "AMOUNT" },
];

const categoryOf = (t: PayeeTransaction) =>
  t.is_split ? "Split" : t.inflow_to_ready_to_assign ? "Ready to Assign" : (t.category_name ?? "");

function sortKey(t: PayeeTransaction, col: Col): string | number {
  if (col === "account") return t.account_name.toLowerCase();
  if (col === "date") return t.date;
  if (col === "category") return categoryOf(t).toLowerCase();
  if (col === "memo") return (t.memo ?? "").toLowerCase();
  return t.amount;
}

/** The `Transactions` popover of one payee, laid inside the dialog under the button that opened it. */
export function TransactionsPopover({
  budgetId,
  payeeId,
  anchor,
  container,
  onClose,
}: {
  budgetId: string;
  payeeId: string;
  anchor: HTMLElement;
  container: HTMLElement;
  onClose: () => void;
}) {
  const fmt = usePlanFormatter();
  const q = usePayeeTransactions(budgetId, payeeId);
  const [sort, setSort] = useState<{ col: Col; dir: "asc" | "desc" }>({ col: "date", dir: "desc" });
  const box = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => {
    const list = [...(q.data?.transactions ?? [])];
    const sign = sort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const x = sortKey(a, sort.col);
      const y = sortKey(b, sort.col);
      return x === y ? 0 : x < y ? -sign : sign;
    });
    return list;
  }, [q.data, sort]);

  // Under the button, 16 px inside the dialog's edges.
  const c = container.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const width = Math.min(608, c.width - 32);
  const left = Math.max(16, Math.min(a.left - c.left, c.width - 16 - width));
  const top = a.bottom - c.top + 12;
  const arrow = Math.max(12, Math.min(width - 28, a.left - c.left + a.width / 2 - left - 8));
  const total = q.data?.total_count ?? 0;

  return (
    <div
      ref={box}
      className="mp-popover"
      role="dialog"
      aria-label="Transactions"
      style={{ left, top, width }}
    >
      <span className="mp-popover-arrow" style={{ left: arrow }} aria-hidden="true" />
      <div className="mp-popover-head">
        <h3>Transactions</h3>
        <button type="button" className="mp-x" aria-label="Close transactions" onClick={onClose}>
          <CloseIcon width={16} height={16} />
        </button>
      </div>
      <div className="mp-popover-content">
        <div className="mp-table-body">
          <table className="mp-table">
            <thead>
              <tr>
                {COLS.map((c2) => (
                  <th key={c2.id} className={c2.id === "amount" ? "is-amount" : undefined}>
                    <button
                      type="button"
                      className={sort.col === c2.id ? "is-sorting" : undefined}
                      onClick={() =>
                        setSort((s) =>
                          s.col === c2.id
                            ? { col: c2.id, dir: s.dir === "asc" ? "desc" : "asc" }
                            : {
                                col: c2.id,
                                dir: c2.id === "date" || c2.id === "amount" ? "desc" : "asc",
                              },
                        )
                      }
                    >
                      {c2.label}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={`${t.kind}-${t.id}`}>
                  <td title={t.account_name}>{t.account_name}</td>
                  <td>{fmt.date(t.date)}</td>
                  <td title={categoryOf(t)}>{categoryOf(t)}</td>
                  <td title={t.memo ?? undefined}>{t.memo ?? ""}</td>
                  <td className="is-amount">{fmt.money(t.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {total > PAYEE_TRANSACTIONS_LIMIT ? (
        <p className="mp-popover-note">
          Showing the newest {PAYEE_TRANSACTIONS_LIMIT} of {total}.
        </p>
      ) : null}
      <div className="mp-buttons">
        <button type="button" className="mp-button mp-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
