import { addMonths, type Month } from "@budget/core/month";
import type { Account } from "@budget/schema/accounts";
import {
  ESCROW_NOTE,
  escrowNote,
  interestNote,
  NO_PAYMENTS_TEXT,
  otherLine,
  paymentLine,
} from "@budget/schema/loan-activity";
import { useState } from "react";
import { useLoanActivity } from "../api/loans";
import { useMonthRange } from "../api/months";
import { localToday } from "../api/today";
import { canNext, canPrev, navLimits } from "../plan/monthNav";
import { ChevronCircleLeftIcon, ChevronCircleRightIcon } from "../plan/monthNavIcons";
import { usePlanFormatter } from "../shell/plan-formats-context";
import "./loan-activity.css";
import { RecordLoanPaymentDialog } from "./RecordLoanPaymentDialog";

/** "2026-11-01" -> "November 2026". */
const longMonth = (month: Month) =>
  new Date(`${month}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

function CheckIcon() {
  return (
    <svg
      className="loan-check"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

/** A loan's page: Account Activity for one month in place of the register (EXF-540). */
export function LoanActivity({ budgetId, account }: { budgetId: string; account: Account }) {
  const fmt = usePlanFormatter();
  const current = `${localToday().slice(0, 7)}-01` as Month;
  const [month, setMonth] = useState<Month>(current);
  const [paying, setPaying] = useState(false);
  const limits = navLimits(useMonthRange(budgetId).data, current);
  const { data: a, isError } = useLoanActivity(budgetId, account.id, month);
  const mag = (n: number) => fmt.abs(n);

  return (
    <div className="loan-activity">
      <div className="loan-activity-head">
        <h2>Account Activity</h2>
        <div className="loan-month-switch">
          <button
            type="button"
            className="loan-month-arrow"
            aria-label="Previous month"
            disabled={!canPrev(month, limits)}
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronCircleLeftIcon size={24} />
          </button>
          <span className="loan-month-label" aria-live="polite">
            {longMonth(month)}
          </span>
          <button
            type="button"
            className="loan-month-arrow"
            aria-label="Next month"
            disabled={!canNext(month, limits)}
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <ChevronCircleRightIcon size={24} />
          </button>
        </div>
        <button type="button" className="primary" onClick={() => setPaying(true)}>
          Record Payment
        </button>
      </div>
      {isError ? (
        <p className="error-bar" role="alert">
          Account Activity could not be loaded.
        </p>
      ) : null}
      {a ? (
        <>
          <p className="loan-ending">
            <span className="loan-ending-label">Balance at the end of {longMonth(month)}</span>{" "}
            <span className="loan-ending-amount" data-testid="loan-ending-balance">
              {fmt.money(a.ending_balance)}
            </span>
          </p>
          <section aria-labelledby="loan-payments" className="loan-section">
            <h3 id="loan-payments">Payments</h3>
            {a.payments.length === 0 ? (
              <p className="loan-empty">{NO_PAYMENTS_TEXT}</p>
            ) : (
              <ul>
                {a.payments.map((p) => (
                  <li key={p.transaction_id}>
                    <span className="loan-row-text">{paymentLine(p, mag)}</span>
                    <span className="loan-row-amount">{fmt.signed(p.amount)}</span>
                    <CheckIcon />
                  </li>
                ))}
              </ul>
            )}
          </section>
          {a.interest ? (
            <section aria-labelledby="loan-interest" className="loan-section">
              <h3 id="loan-interest">Interest Charges This Month</h3>
              <ul>
                <li>
                  <span className="loan-row-text">{interestNote(a.interest, mag)}</span>
                  <span className="loan-row-amount">{fmt.money(a.interest.amount)}</span>
                </li>
              </ul>
            </section>
          ) : null}
          {a.escrow ? (
            <section aria-labelledby="loan-escrow" className="loan-section">
              <h3 id="loan-escrow">Escrow Held</h3>
              <ul>
                <li>
                  <span className="loan-row-text">
                    {a.escrow.state === "estimated" ? ESCROW_NOTE : escrowNote(a.escrow)}
                  </span>
                  <span className="loan-row-amount">{fmt.money(a.escrow.amount)}</span>
                </li>
              </ul>
            </section>
          ) : null}
          {a.other.length > 0 ? (
            <section aria-labelledby="loan-other" className="loan-section">
              <h3 id="loan-other">
                Other Activity <span className="loan-badge">{a.other.length}</span>
              </h3>
              <ul>
                {a.other.map((o) => (
                  <li key={o.transaction_id}>
                    <span className="loan-row-text">{otherLine(o, mag)}</span>
                    <span className="loan-row-amount">{fmt.money(o.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
      {paying ? (
        <RecordLoanPaymentDialog
          budgetId={budgetId}
          loan={account}
          lastSourceId={a?.last_payment_from_account_id ?? null}
          onClose={() => setPaying(false)}
        />
      ) : null}
    </div>
  );
}
