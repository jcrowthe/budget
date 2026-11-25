import type { Month } from "@budget/core/month";
import type { Account } from "@budget/schema/accounts";
import {
  AVAILABLE_FOR_PAYMENT,
  NO_PAYMENTS_YET,
  OPEN_PAYOFF_SIMULATOR,
  PAIRED_WITH,
  paidThisMonthText,
  RECORD_PAYMENT,
} from "@budget/schema/debt-target";
import type { MonthCategoryDetail } from "@budget/schema/months";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useAccounts } from "../../api/accounts";
import { useLoanActivity } from "../../api/loans";
import { RecordLoanPaymentDialog } from "../../loan/RecordLoanPaymentDialog";
import { usePlanFormatter } from "../../shell/plan-formats-context";
import { accountPath, localCurrentMonth } from "../../shell/planPaths";
import "./loan-paired.css";

/** Mounted only while the dialog is open: reads the loan's activity for the last payment's source. */
function RecordPaymentHost({
  budgetId,
  loan,
  onClose,
}: {
  budgetId: string;
  loan: Account;
  onClose: () => void;
}) {
  const activity = useLoanActivity(budgetId, loan.id, localCurrentMonth());
  return (
    <RecordLoanPaymentDialog
      budgetId={budgetId}
      loan={loan}
      lastSourceId={activity.data?.last_payment_from_account_id ?? null}
      onClose={onClose}
    />
  );
}

/**
 * A loan's paired category in the inspector (EXF-545): the "Paired with" link, the Available for Payment card
 * with Record Payment and Open Payoff Simulator, and the payments made this month.
 */
export function LoanPairedCard({
  budgetId,
  c,
}: {
  budgetId: string;
  month: Month;
  c: MonthCategoryDetail;
}) {
  const fmt = usePlanFormatter();
  const navigate = useNavigate();
  const accounts = useAccounts(budgetId);
  const [recording, setRecording] = useState(false);
  const loan = accounts.data?.find((a) => a.id === c.paired_account_id);
  if (!loan) return null;
  const to = accountPath(budgetId, loan.id);
  return (
    <div className="loan-paired">
      <p className="loan-paired-with">
        {PAIRED_WITH} <Link to={to}>{loan.name}</Link> Account
      </p>
      <section className="panel-card loan-paired-card">
        <div className="loan-paired-body">
          <p className="loan-paired-available">
            <strong>{fmt.money(Math.max(0, c.available))}</strong> {AVAILABLE_FOR_PAYMENT}
          </p>
          <div className="loan-paired-actions">
            <button
              type="button"
              className="loan-paired-record"
              disabled={c.available <= 0}
              onClick={() => setRecording(true)}
            >
              {RECORD_PAYMENT}
            </button>
            <button
              type="button"
              className="loan-paired-simulator"
              onClick={() => navigate(`${to}?simulate=1`)}
            >
              {OPEN_PAYOFF_SIMULATOR}
            </button>
          </div>
          <p className="loan-paired-paid">
            {c.paid_this_month > 0 ? paidThisMonthText(c.paid_this_month, fmt) : NO_PAYMENTS_YET}
          </p>
        </div>
      </section>
      {recording && (
        <RecordPaymentHost budgetId={budgetId} loan={loan} onClose={() => setRecording(false)} />
      )}
    </div>
  );
}
