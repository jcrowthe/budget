import { simulatePayoff } from "@budget/core/loan-projection";
import type { Month } from "@budget/core/month";
import type { Account } from "@budget/schema/accounts";
import { evaluateAmountEntry, formatAmountEntry } from "@budget/schema/amount-entry";
import {
  COPY_TO_PLAN,
  changeLines,
  ESCROW_NOTE,
  EXTRA_HINT,
  extraLabel,
  MINIMUM_SUMMARY,
  paymentHint,
  payoffHint,
  RESET_ALL,
  SIMULATION_TIP,
  TARGET_SUMMARY,
} from "@budget/schema/loan-simulator";
import type { LoanSummary } from "@budget/schema/loan-summary";
import {
  CURRENT_TRACK_TARGET_TIP,
  CURRENT_TRACK_TIP,
  DASH,
  durationText,
  PAST_BALANCE_TIP,
  payoffLabel,
} from "@budget/schema/loan-summary";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../api/client";
import { useSaveTarget } from "../api/targets";
import "../account/edit-account.css";
import { CloseIcon } from "../shell/icons";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { planPath } from "../shell/planPaths";
import { Legend, Tile } from "./LoanParts";
import { LoanProgressChart } from "./LoanProgressChart";
import { useEscape } from "./useEscape";
import "./loan-page.css";

export const SIMULATOR_TITLE = "Loan Payoff Simulator";

/**
 * The Loan Payoff Simulator: a calculator over the loan summary's terms (projectLoan runs in the browser, so
 * nothing is written until "Copy and go to my plan" sets the paired category's Debt Payment Target).
 * docs/loan-simulator-design.md.
 */
export function PayoffSimulatorDialog({
  budgetId,
  account,
  month,
  summary: s,
  onClose,
}: {
  budgetId: string;
  account: Account;
  month: Month;
  summary: LoanSummary;
  onClose: () => void;
}) {
  const fmt = usePlanFormatter();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const save = useSaveTarget(budgetId);
  useEscape(onClose);

  const initialPayment = s.payment_used === null ? "" : formatAmountEntry(s.payment_used, fmt);
  const [paymentText, setPaymentText] = useState(initialPayment);
  const [extraText, setExtraText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const parse = (t: string) => evaluateAmountEntry(fmt.typedAmount(t), fmt.digits);
  const payment = parse(paymentText);
  const extra = Math.max(0, parse(extraText) ?? 0);
  const changed = (payment !== null && payment !== s.payment_used) || extra > 0;

  const sim = useMemo(
    () =>
      payment === null
        ? null
        : simulatePayoff(
            {
              type: account.type,
              interest_rate: s.interest_rate,
              escrow_amount: s.escrow_amount,
            },
            { balance: s.remaining_balance, payment: s.payment_used ?? 0, from: month },
            { payment, extra_once: extra },
          ),
    [
      payment,
      extra,
      account.type,
      s.interest_rate,
      s.escrow_amount,
      s.remaining_balance,
      s.payment_used,
      month,
    ],
  );

  const money = (v: number | null) => (v === null ? DASH : fmt.abs(v));
  const showSim = changed && sim !== null;
  const n = showSim ? sim.projection.payments_remaining : s.payments_remaining;
  const payoff = showSim ? sim.projection.payoff_month : s.payoff_month;
  const interest = showSim ? sim.projection.interest_total : s.interest_remaining;
  const principal = showSim ? sim.principal : s.remaining_balance;
  const remainingToPay = showSim
    ? sim.remaining_to_pay
    : s.remaining_balance + s.interest_remaining;
  const paired = s.paired_category;
  const canCopy = showSim && paired !== null && payment !== null && payment > 0;
  const canReset = changed || (payment === null && paymentText !== initialPayment);

  const resetAll = () => {
    setPaymentText(initialPayment);
    setExtraText("");
    setError(null);
  };

  const copyToPlan = async () => {
    if (!paired || payment === null || payment <= 0) return;
    setError(null);
    const day =
      paired.target?.type === "debt_payment" ? (paired.target.day_of_month ?? "last") : "last";
    try {
      await save.mutateAsync({
        categoryId: paired.id,
        body: { type: "debt_payment", amount: payment, day },
      });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(budgetId) });
      navigate(planPath(budgetId, month));
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "The target was not saved.");
    }
  };

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
        <div className="form-body loan-sim-body">
          <div className="loan-sim-left">
            <div className="loan-sim-min">
              <strong>{money(s.minimum_payment)}</strong> Required Minimum Payment
            </div>
            <label htmlFor="sim-payment">Monthly Payment</label>
            <input
              id="sim-payment"
              className="field"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={paymentText}
              onChange={(e) => setPaymentText(e.target.value)}
            />
            {s.payment_used !== null && s.payment_source !== null ? (
              <p className="loan-sim-hint">
                {paymentHint(s.payment_source, s.payment_used, fmt.abs)}
              </p>
            ) : null}
            <div className="loan-sim-payoff">
              <span className="loan-sim-label">Payoff Date</span>
              <strong>{payoffLabel(payoff)}</strong>
            </div>
            <p className="loan-sim-hint">
              {showSim && n === null
                ? "This payment won't pay off this loan"
                : payoffHint({
                    changed: showSim,
                    n: s.payments_remaining,
                    originalPayoff: s.payoff_month,
                  })}
            </p>
            <label htmlFor="sim-extra">{extraLabel(month)}</label>
            <input
              id="sim-extra"
              className="field"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={extraText}
              onChange={(e) => setExtraText(e.target.value)}
            />
            <p className="loan-sim-hint">{EXTRA_HINT}</p>
          </div>
          <div className="loan-sim-right">
            <LoanProgressChart
              past={s.history}
              current={s.schedule}
              simulation={showSim ? sim.projection.schedule : []}
              label="Simulated loan balance by month"
            />
            <ul className="loan-legend">
              <Legend cls="past" label="Past Balance" tip={PAST_BALANCE_TIP} />
              <Legend
                cls="current"
                label="Current Track"
                tip={s.payment_source === "target" ? CURRENT_TRACK_TARGET_TIP : CURRENT_TRACK_TIP}
              />
              {showSim ? <Legend cls="simulation" label="Simulation" tip={SIMULATION_TIP} /> : null}
            </ul>
            <section className="loan-sim-summary" aria-label="Simulation summary">
              {showSim ? (
                <>
                  {changeLines(
                    { deltaMonthly: (payment ?? 0) - (s.payment_used ?? 0), extra },
                    fmt.abs,
                  ).map((l) => (
                    <p key={l} className="loan-sim-change">
                      {l}
                    </p>
                  ))}
                  <div className="loan-sim-figures">
                    <Tile label="Interest Savings" value={money(sim.interest_savings)} />
                    <Tile
                      label="Time Savings"
                      value={sim.months_saved === null ? DASH : durationText(sim.months_saved)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <p className="loan-sim-change">
                    {s.payment_source === "target" ? TARGET_SUMMARY : MINIMUM_SUMMARY}
                  </p>
                  <div className="loan-sim-figures">
                    <Tile label="Interest Remaining" value={fmt.abs(s.interest_remaining)} />
                    <Tile
                      label="Time Remaining"
                      value={
                        s.payments_remaining === null ? DASH : durationText(s.payments_remaining)
                      }
                    />
                  </div>
                </>
              )}
              <div className="loan-sim-figures">
                <Tile label="Remaining to Pay" value={fmt.abs(remainingToPay)} />
                <Tile label="Principal" value={fmt.abs(principal)} />
                <Tile label="Interest" value={fmt.abs(interest)} />
              </div>
              <p className="loan-sim-hint">{ESCROW_NOTE}</p>
            </section>
          </div>
        </div>
        {error ? (
          <p className="loan-sim-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog-footer">
          {canCopy ? (
            <button
              type="button"
              className="secondary"
              disabled={save.isPending}
              onClick={() => void copyToPlan()}
            >
              {COPY_TO_PLAN}
            </button>
          ) : null}
          {canReset ? (
            <button type="button" className="secondary" onClick={resetAll}>
              {RESET_ALL}
            </button>
          ) : null}
          <button type="button" className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
