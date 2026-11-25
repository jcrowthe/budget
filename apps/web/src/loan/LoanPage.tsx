import type { Month } from "@budget/core/month";
import type { Account } from "@budget/schema/accounts";
import {
  CURRENT_TRACK_TARGET_TIP,
  CURRENT_TRACK_TIP,
  DASH,
  ORIGINAL_SCHEDULE_TIP,
  PAST_BALANCE_TIP,
  PROMO_BODY,
  PROMO_TITLE,
  payoffLabel,
  progressLine,
  rateLabel,
  trackSentence,
} from "@budget/schema/loan-summary";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { useLoanSummary } from "../api/loans";
import { localToday } from "../api/today";
import { ChevronDownIcon, ChevronRightIcon, CloseIcon } from "../shell/icons";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { LoanActivity } from "./LoanActivity";
import { Legend, Tile } from "./LoanParts";
import { LoanProgressChart } from "./LoanProgressChart";
import { PairedCategoryPanel } from "./PairedCategoryPanel";
import { PayoffSimulatorDialog } from "./PayoffSimulatorDialog";
import "./loan-page.css";

/** Plans whose promo banner was dismissed this page session (B12: in memory, not persisted). */
const dismissedPlans = new Set<string>();

/** A loan's page: summary tiles, promo banner, progress chart and paired category, above Account Activity. */
export function LoanPage({ budgetId, account }: { budgetId: string; account: Account }) {
  const fmt = usePlanFormatter();
  const month = `${localToday().slice(0, 7)}-01` as Month;
  const { data: s } = useLoanSummary(budgetId, account.id, month);
  // ?simulate=1 opens the simulator (the Plan inspector's Open Payoff Simulator), so it survives a reload.
  const [params, setParams] = useSearchParams();
  const simulator = params.get("simulate") === "1";
  const setSimulator = (open: boolean) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (open) next.set("simulate", "1");
        else next.delete("simulate");
        return next;
      },
      { replace: true },
    );
  const [open, setOpen] = useState(true);
  const [dismissed, setDismissed] = useState(() => dismissedPlans.has(budgetId));

  return (
    <div className="loan-page">
      {s ? (
        <>
          <div className="loan-tiles">
            <Tile label="Remaining Balance" value={fmt.abs(s.remaining_balance)} />
            <Tile label="Interest Rate" value={rateLabel(s.interest_rate)} />
            <Tile
              label="Minimum Payment"
              value={s.minimum_payment === null ? DASH : fmt.abs(s.minimum_payment)}
            />
            {s.escrow_amount !== null ? (
              <Tile label="Escrow" value={fmt.abs(s.escrow_amount)} />
            ) : null}
            <Tile label="Payoff Date" value={payoffLabel(s.payoff_month)} />
          </div>
          {dismissed ? null : (
            <section className="loan-promo" aria-label="Loan payoff simulator">
              <div className="loan-promo-text">
                <strong>{PROMO_TITLE}</strong>
                <span>{PROMO_BODY}</span>
              </div>
              <button type="button" className="primary" onClick={() => setSimulator(true)}>
                Try It Now
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Dismiss"
                title="Dismiss"
                onClick={() => {
                  dismissedPlans.add(budgetId);
                  setDismissed(true);
                }}
              >
                <CloseIcon />
              </button>
            </section>
          )}
          <section className="loan-card loan-progress" aria-label="Your Loan's Progress">
            <div className="loan-progress-head">
              <button
                type="button"
                className="loan-collapse"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
              >
                {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
                <h2>Your Loan's Progress</h2>
              </button>
              {open ? (
                <button type="button" className="secondary" onClick={() => setSimulator(true)}>
                  Open Payoff Simulator
                </button>
              ) : null}
            </div>
            {open ? (
              <>
                <p className="loan-remaining">
                  {progressLine(s.remaining_balance, s.percent_remaining, fmt.whole)}
                </p>
                <LoanProgressChart
                  past={s.history}
                  original={s.original_schedule}
                  current={s.schedule}
                />
                <ul className="loan-legend">
                  <Legend cls="past" label="Past Balance" tip={PAST_BALANCE_TIP} />
                  {s.original_schedule.length > 1 ? (
                    <Legend
                      cls="original"
                      label="Original Payment Schedule"
                      tip={ORIGINAL_SCHEDULE_TIP}
                    />
                  ) : null}
                  {s.schedule.length > 0 ? (
                    <Legend
                      cls="current"
                      label="Current Track"
                      tip={
                        s.payment_source === "target" ? CURRENT_TRACK_TARGET_TIP : CURRENT_TRACK_TIP
                      }
                    />
                  ) : null}
                </ul>
                {s.payment_used !== null && s.payment_source !== null ? (
                  <p className="loan-sentence" data-testid="loan-track-sentence">
                    {trackSentence(
                      {
                        source: s.payment_source,
                        payment: s.payment_used,
                        n: s.payments_remaining,
                      },
                      fmt.abs,
                    ).map((seg) =>
                      seg.bold ? <strong key={seg.text}>{seg.text}</strong> : seg.text,
                    )}
                  </p>
                ) : null}
              </>
            ) : null}
          </section>
          <PairedCategoryPanel
            budgetId={budgetId}
            loanId={account.id}
            month={month}
            paired={s.paired_category}
          />
          {simulator ? (
            <PayoffSimulatorDialog
              budgetId={budgetId}
              account={account}
              month={month}
              summary={s}
              onClose={() => setSimulator(false)}
            />
          ) : null}
        </>
      ) : null}
      <LoanActivity budgetId={budgetId} account={account} />
    </div>
  );
}
