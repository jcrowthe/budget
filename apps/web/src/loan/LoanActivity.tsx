import { addMonths, type Month } from "@budget/core/month";
import type { Account } from "@budget/schema/accounts";
import {
  escrowNote,
  interestNote,
  type LoanActivity as LoanActivityData,
  NO_PAYMENTS_TEXT,
  NOT_EDITABLE_TEXT,
  otherLine,
  paymentLine,
} from "@budget/schema/loan-activity";
import type { AddActivityId } from "@budget/schema/loan-add-activity";
import { useState } from "react";
import { useLoanActivity } from "../api/loans";
import { useMonthRange } from "../api/months";
import { localToday } from "../api/today";
import { canNext, canPrev, navLimits } from "../plan/monthNav";
import { ChevronCircleLeftIcon, ChevronCircleRightIcon } from "../plan/monthNavIcons";
import { PencilIcon } from "../shell/icons";
import { usePlanFormatter } from "../shell/plan-formats-context";
import "./loan-activity.css";
import { AddActivityMenu } from "./AddActivityMenu";
import { type AddKind, AddLoanActivityDialog } from "./AddLoanActivityDialog";
import { EditLoanActivityDialog, type EditTarget } from "./EditLoanActivityDialog";
import { RecordLoanPaymentDialog } from "./RecordLoanPaymentDialog";

/** "2026-11-01" -> "November 2026". */
const longMonth = (month: Month) =>
  new Date(`${month}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

/** "2026-11-15" -> "November 15". */
const dayName = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
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

/** The lock on a reconciled line or payment (Update Balance froze it, or a side is reconciled): no Edit button. */
function LockIcon() {
  return (
    <span
      className="loan-row-action loan-lock"
      role="img"
      aria-label={NOT_EDITABLE_TEXT}
      title={NOT_EDITABLE_TEXT}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" fill="currentColor" />
        <path
          d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    </span>
  );
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="loan-row-action loan-edit-button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <PencilIcon width={16} height={16} aria-hidden="true" focusable="false" />
    </button>
  );
}

/** The edited interest line as the dialog edits it; null when the line cannot be edited. */
function interestTarget(line: LoanActivityData["interest"], month: Month): EditTarget | null {
  if (!line?.editable || !line.transaction_id) return null;
  return {
    kind: "interest",
    transactionId: line.transaction_id,
    amount: Math.abs(line.amount),
    date: line.edited_on ?? month,
    memo: null,
    monthLabel: longMonth(month),
  };
}

function escrowTarget(line: LoanActivityData["escrow"], month: Month): EditTarget | null {
  if (!line?.editable || !line.transaction_id) return null;
  return {
    kind: "escrow",
    transactionId: line.transaction_id,
    amount: Math.abs(line.amount),
    date: line.edited_on ?? month,
    memo: null,
    monthLabel: longMonth(month),
  };
}

/** A loan's page: Account Activity for one month in place of the register (EXF-540). */
export function LoanActivity({ budgetId, account }: { budgetId: string; account: Account }) {
  const fmt = usePlanFormatter();
  const current = `${localToday().slice(0, 7)}-01` as Month;
  const [month, setMonth] = useState<Month>(current);
  const [paying, setPaying] = useState(false);
  const [adding, setAdding] = useState<AddKind | null>(null);
  const [editing, setEditing] = useState<EditTarget | null>(null);
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
        <button type="button" className="secondary" onClick={() => setPaying(true)}>
          Record Payment
        </button>
        <AddActivityMenu
          mortgage={account.type === "mortgage"}
          onPick={(id: AddActivityId) => (id === "payment" ? setPaying(true) : setAdding(id))}
        />
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
                    {p.editable ? (
                      <EditButton
                        label={`Edit payment on ${dayName(p.date)}`}
                        onClick={() =>
                          setEditing({
                            kind: "payment",
                            transactionId: p.transaction_id,
                            amount: p.amount,
                            date: p.date,
                            memo: p.memo,
                            fromName: p.from_account_name ?? "",
                          })
                        }
                      />
                    ) : p.reconciled ? (
                      <LockIcon />
                    ) : null}
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
                  {interestTarget(a.interest, month) ? (
                    <EditButton
                      label="Edit interest"
                      onClick={() => setEditing(interestTarget(a.interest, month))}
                    />
                  ) : a.interest.state === "reconciled" ? (
                    <LockIcon />
                  ) : null}
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
                  <span className="loan-row-text">{escrowNote(a.escrow)}</span>
                  {escrowTarget(a.escrow, month) ? (
                    <EditButton
                      label="Edit escrow"
                      onClick={() => setEditing(escrowTarget(a.escrow, month))}
                    />
                  ) : a.escrow.state === "reconciled" ? (
                    <LockIcon />
                  ) : null}
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
                    {o.editable ? (
                      <EditButton
                        label={`Edit ${o.label} on ${dayName(o.date)}`}
                        onClick={() =>
                          setEditing({
                            kind: o.amount < 0 ? "fee" : "credit",
                            transactionId: o.transaction_id,
                            amount: Math.abs(o.amount),
                            date: o.date,
                            memo: o.memo,
                          })
                        }
                      />
                    ) : o.reconciled ? (
                      <LockIcon />
                    ) : null}
                    <span className="loan-row-amount">{fmt.money(o.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
      {adding ? (
        <AddLoanActivityDialog
          budgetId={budgetId}
          loanId={account.id}
          kind={adding}
          onClose={() => setAdding(null)}
        />
      ) : null}
      {editing ? (
        <EditLoanActivityDialog
          key={editing.transactionId}
          budgetId={budgetId}
          loanId={account.id}
          target={editing}
          onClose={() => setEditing(null)}
        />
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
