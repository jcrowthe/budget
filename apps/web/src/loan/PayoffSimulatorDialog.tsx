import type { LoanSummary } from "@budget/schema/loan-summary";
import { DASH, durationText, payoffLabel } from "@budget/schema/loan-summary";
import "../account/edit-account.css";
import { CloseIcon } from "../shell/icons";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { LoanProgressChart } from "./LoanProgressChart";
import { useEscape } from "./useEscape";
import "./loan-page.css";

export const SIMULATOR_TITLE = "Loan Payoff Simulator";

/** The as-is view of the payoff simulator (EXF-544 adds the inputs, the Simulation line and Copy to plan). */
export function PayoffSimulatorDialog({
  summary: s,
  onClose,
}: {
  summary: LoanSummary;
  onClose: () => void;
}) {
  const fmt = usePlanFormatter();
  useEscape(onClose);
  const n = s.payments_remaining;
  const money = (v: number | null) => (v === null ? DASH : fmt.abs(v));
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog form edit-account loan-sim"
        role="dialog"
        aria-modal="true"
        aria-label={SIMULATOR_TITLE}
      >
        <div className="dialog-head">
          <h2>{SIMULATOR_TITLE}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="form-body">
          <dl className="loan-sim-rows">
            <div>
              <dt>Required Minimum Payment</dt>
              <dd>{money(s.minimum_payment)}</dd>
            </div>
            <div>
              <dt>Monthly Payment</dt>
              <dd>{money(s.payment_used)}</dd>
            </div>
            <div>
              <dt>Payoff Date</dt>
              <dd>{payoffLabel(s.payoff_month)}</dd>
            </div>
            <div>
              <dt>Interest Remaining</dt>
              <dd>{fmt.abs(s.interest_remaining)}</dd>
            </div>
            <div>
              <dt>Time Remaining</dt>
              <dd>{n === null ? DASH : durationText(n)}</dd>
            </div>
          </dl>
          {n !== null ? (
            <p>
              You have <strong>{n}</strong> payments remaining on your loan.
            </p>
          ) : null}
          <LoanProgressChart
            past={s.history}
            current={s.schedule}
            label="Simulated loan balance by month"
          />
        </div>
        <div className="dialog-footer">
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
