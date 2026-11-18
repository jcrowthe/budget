import type { TransactionDetail } from "@budget/schema/transactions";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "../account/Tooltip";
import { ApiError } from "../api/client";
import { useUnmatchTransaction } from "../api/transactions";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { LinkIcon } from "./icons";
import { Popover } from "./Popover";

export const MATCHED_LABEL = "This transaction has a matched transaction";
const UNMATCH_TITLE =
  "Unmatching will create two separate transactions for your manual entry and the imported entry.";

/**
 * A matched row's cell (EXF-464): the link icon with the tooltip `Matched`, and on click, Enter or Space the
 * panel with what the bank said (read from the row, no second fetch) beside the entry, and `Unmatch`.
 */
export function MatchCell({ budgetId, tx }: { budgetId: string; tx: TransactionDetail }) {
  const fmt = usePlanFormatter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const unmatchBtn = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const unmatch = useUnmatchTransaction(budgetId);
  const bank = tx.match_details;
  // The panel lives on document.body, after the register: the key reaches Unmatch by taking the focus.
  useEffect(() => {
    if (open) unmatchBtn.current?.focus();
  }, [open]);
  if (!bank) return null;

  const close = () => {
    setOpen(false);
    setError(null);
    button.current?.focus();
  };
  const doUnmatch = async () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await unmatch.mutateAsync(tx.id);
      setOpen(false);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.detail : e instanceof Error ? e.message : "That did not work",
      );
    } finally {
      busy.current = false;
    }
  };
  const cell = (text: string, key: string) => (
    <td key={key} title={text}>
      {text}
    </td>
  );
  const line = (date: string, payee: string | null, memo: string | null, amount: number) => [
    cell(fmt.date(date), "date"),
    cell(payee || "None", "payee"),
    cell(memo ?? "", "memo"),
    <td key="amount" className="match-amount" title={fmt.money(amount)}>
      {fmt.money(amount)}
    </td>,
  ];

  return (
    <>
      <Tooltip content="Matched" placement="below" align="start">
        {(tip) => (
          <button
            {...tip}
            ref={button}
            type="button"
            className="match-link"
            aria-label={MATCHED_LABEL}
            aria-haspopup="dialog"
            aria-expanded={open}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <LinkIcon />
          </button>
        )}
      </Tooltip>
      {open && button.current && (
        // biome-ignore lint/a11y/noStaticElementInteractions: the panel's controls take the keys; this only keeps portal clicks off the row
        // biome-ignore lint/a11y/useKeyWithClickEvents: the same
        <div onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <Popover
            anchor={button.current}
            placement="below"
            align="start"
            role="dialog"
            label="Matched Transactions"
            width={Math.min(512, window.innerWidth - 16)}
            className="is-match"
            bodyClass="is-match"
            onClose={close}
          >
            <div className="match-panel">
              <h2>Matched Transactions</h2>
              <table className="match-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Payee</th>
                    <th>Memo</th>
                    <th className="match-amount">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>{line(tx.date, tx.payee_name, tx.memo, tx.amount)}</tr>
                  <tr>{line(bank.date, bank.payee_name, null, bank.amount)}</tr>
                </tbody>
              </table>
              <button
                ref={unmatchBtn}
                type="button"
                className="match-unmatch"
                title={UNMATCH_TITLE}
                onClick={() => void doUnmatch()}
              >
                Unmatch
              </button>
              {error && (
                <p role="alert" className="match-error">
                  {error}
                </p>
              )}
            </div>
          </Popover>
        </div>
      )}
    </>
  );
}
