import type { Month } from "@budget/core/month";
import type { LoanSummary } from "@budget/schema/loan-summary";
import { UNPAIRED_BODY, UNPAIRED_TITLE } from "@budget/schema/loan-summary";
import { useState } from "react";
import { Link } from "react-router";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { planPath } from "../shell/planPaths";
import { PairLoanDialog } from "./PairLoanDialog";

type Target = NonNullable<NonNullable<LoanSummary["paired_category"]>["target"]>;

const FREQUENCY: Record<Target["cadence"], string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
  custom: "Custom",
};
const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
function dueText(t: Target): string {
  if (t.cadence === "monthly") {
    return t.day_of_month ? `by the ${ordinal(t.day_of_month)}` : "by the End of the Month";
  }
  return t.due_date ?? "—";
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
            {paired.target ? (
              <>
                <div>
                  <dt>Target</dt>
                  <dd>{fmt.abs(paired.target.amount)}</dd>
                </div>
                <div>
                  <dt>Frequency</dt>
                  <dd>{FREQUENCY[paired.target.cadence]}</dd>
                </div>
                <div>
                  <dt>Due</dt>
                  <dd>{dueText(paired.target)}</dd>
                </div>
              </>
            ) : (
              <div>
                <dt>Target</dt>
                <dd>
                  <Link to={planPath(budgetId, month)}>(+) Create Debt Payment Target</Link>
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
