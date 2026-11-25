import type { Month } from "@budget/core/month";
import { CREATE_DEBT_TARGET, debtTargetHeading } from "@budget/schema/debt-target";
import type { LoanSummary } from "@budget/schema/loan-summary";
import {
  UNPAIR_BODY,
  UNPAIR_LABEL,
  UNPAIR_TITLE,
  UNPAIRED_BODY,
  UNPAIRED_TITLE,
} from "@budget/schema/loan-summary";
import type { PlanFormatter } from "@budget/schema/plan-formats";
import { useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../api/client";
import { usePairLoanCategory } from "../api/loans";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { planPath } from "../shell/planPaths";
import { PairLoanDialog } from "./PairLoanDialog";
import { useEscape } from "./useEscape";

type Target = NonNullable<NonNullable<LoanSummary["paired_category"]>["target"]>;

const CADENCE: Record<Target["cadence"], string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
  custom: "Custom",
};

/** Target, Frequency and Due in the plan's own wording (EXF-545's debt wording, else the target's heading). */
function targetRows(
  t: Target,
  fmt: PlanFormatter,
): { target: string; frequency: string; due: string } {
  if (t.type === "debt_payment") {
    const h = debtTargetHeading(t, fmt);
    return { target: h.heading, frequency: h.label, due: h.by.replace(/^By/, "by") };
  }
  return {
    target: fmt.abs(t.amount),
    frequency: CADENCE[t.cadence],
    due: t.due_date ? fmt.date(t.due_date) : "—",
  };
}

/** "Unpair this loan?": the category stays in the plan; only the loan's pairing is cleared. */
function UnpairDialog({
  budgetId,
  loanId,
  onClose,
}: {
  budgetId: string;
  loanId: string;
  onClose: () => void;
}) {
  const save = usePairLoanCategory(budgetId, loanId);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog form edit-account loan-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={UNPAIR_TITLE}
      >
        <div className="dialog-head">
          <h2>{UNPAIR_TITLE}</h2>
        </div>
        <div className="form-body">
          <p className="loan-intro">{UNPAIR_BODY}</p>
          {error ? (
            <p className="error-bar" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="destructive"
            disabled={save.isPending}
            onClick={() => {
              setError(null);
              save.mutate(
                { category_id: null },
                {
                  onSuccess: onClose,
                  onError: (e) =>
                    setError(e instanceof ApiError ? e.detail : "The loan was not unpaired."),
                },
              );
            }}
          >
            {UNPAIR_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Paired Plan Category": the paired category's Available and target, or the pairing prompt. */
export function PairedCategoryPanel({
  budgetId,
  loanId,
  month,
  paired,
}: {
  budgetId: string;
  loanId: string;
  month: Month;
  paired: LoanSummary["paired_category"];
}) {
  const fmt = usePlanFormatter();
  const [pairing, setPairing] = useState(false);
  const [unpairing, setUnpairing] = useState(false);
  const tone =
    !paired || paired.available === 0 ? "zero" : paired.available > 0 ? "positive" : "negative";
  const rows = paired?.target ? targetRows(paired.target, fmt) : null;
  return (
    <section className="loan-card loan-paired" aria-label="Paired Plan Category">
      {paired ? (
        <>
          <div className="loan-paired-head">
            <h2>Paired Plan Category</h2>
            <button type="button" className="secondary" onClick={() => setUnpairing(true)}>
              {UNPAIR_LABEL}
            </button>
          </div>
          <dl className="loan-paired-rows">
            <div>
              <dt>Category</dt>
              <dd>
                <Link to={planPath(budgetId, month)}>{`${paired.group_name}: ${paired.name}`}</Link>
              </dd>
            </div>
            <div>
              <dt>Available to spend</dt>
              <dd>
                <span className={`loan-pill ${tone}`} data-testid="loan-available">
                  {fmt.money(paired.available)}
                </span>
              </dd>
            </div>
            {rows ? (
              <>
                <div>
                  <dt>Target</dt>
                  <dd>{rows.target}</dd>
                </div>
                <div>
                  <dt>Frequency</dt>
                  <dd>{rows.frequency}</dd>
                </div>
                <div>
                  <dt>Due</dt>
                  <dd>{rows.due}</dd>
                </div>
              </>
            ) : (
              <div>
                <dt>Target</dt>
                <dd>
                  <Link to={planPath(budgetId, month)} state={{ selectCategory: paired.id }}>
                    (+) {CREATE_DEBT_TARGET}
                  </Link>
                </dd>
              </div>
            )}
          </dl>
        </>
      ) : (
        <div className="loan-unpaired">
          <div>
            <h2>{UNPAIRED_TITLE}</h2>
            <p>{UNPAIRED_BODY}</p>
          </div>
          <button type="button" className="primary" onClick={() => setPairing(true)}>
            Get Started
          </button>
        </div>
      )}
      {unpairing ? (
        <UnpairDialog budgetId={budgetId} loanId={loanId} onClose={() => setUnpairing(false)} />
      ) : null}
      {pairing ? (
        <PairLoanDialog budgetId={budgetId} loanId={loanId} onClose={() => setPairing(false)} />
      ) : null}
    </section>
  );
}
