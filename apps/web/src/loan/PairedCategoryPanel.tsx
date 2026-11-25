import type { Month } from "@budget/core/month";
import { CREATE_DEBT_TARGET, debtTargetHeading } from "@budget/schema/debt-target";
import type { LoanSummary } from "@budget/schema/loan-summary";
import { UNPAIRED_BODY, UNPAIRED_TITLE } from "@budget/schema/loan-summary";
import type { PlanFormatter } from "@budget/schema/plan-formats";
import { useState } from "react";
import { Link } from "react-router";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { planPath } from "../shell/planPaths";
import { PairLoanDialog } from "./PairLoanDialog";

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
  const tone =
    !paired || paired.available === 0 ? "zero" : paired.available > 0 ? "positive" : "negative";
  const rows = paired?.target ? targetRows(paired.target, fmt) : null;
  return (
    <section className="loan-card loan-paired" aria-label="Paired Plan Category">
      {paired ? (
        <>
          <h2>Paired Plan Category</h2>
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
      {pairing ? (
        <PairLoanDialog budgetId={budgetId} loanId={loanId} onClose={() => setPairing(false)} />
      ) : null}
    </section>
  );
}
