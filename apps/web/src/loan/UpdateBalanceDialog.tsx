import type { Account } from "@budget/schema/accounts";
import { evaluateAmountEntry, formatAmountEntry } from "@budget/schema/amount-entry";
import {
  UPDATE_BALANCE_ASK,
  UPDATE_BALANCE_CHANGES_TEXT,
  UPDATE_BALANCE_DIFFERENCE_TEXT,
  UPDATE_BALANCE_DONE_TEXT,
  UPDATE_BALANCE_DONE_TITLE,
} from "@budget/schema/loan-balance-update";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../api/client";
import { previewLoanBalance, useUpdateLoanBalance } from "../api/loans";
import { localToday } from "../api/today";
import "../account/edit-account.css";
import { CloseIcon } from "../shell/icons";
import { usePlanFormatter } from "../shell/plan-formats-context";
import "./loan-activity.css";
import "./update-balance.css";
import { useEscape } from "./useEscape";

type Step = "ask" | "enter" | "rates" | "changes" | "done";

const RATE = /^\d{1,3}(\.\d{1,3})?$/;

/**
 * "Update Balance" on a loan's header: confirm the balance at the lender (Yes), or enter it, check the rate and
 * escrow and see the balance adjustment (No). One write freezes the month's interest and escrow lines.
 * docs/loan-update-balance-design.md.
 */
export function UpdateBalanceDialog({ loan, onClose }: { loan: Account; onClose: () => void }) {
  const fmt = usePlanFormatter();
  const qc = useQueryClient();
  const budgetId = loan.budget_id;
  const save = useUpdateLoanBalance(budgetId, loan.id);
  const current = loan.balance;
  const mortgage = loan.type === "mortgage";

  const [step, setStep] = useState<Step>("ask");
  const [typed, setTyped] = useState("");
  const [rate, setRate] = useState(loan.interest_rate ?? "0");
  const [keepRate, setKeepRate] = useState(true);
  const [escrow, setEscrow] = useState(() => formatAmountEntry(loan.escrow_amount ?? 0, fmt));
  const [keepEscrow, setKeepEscrow] = useState(true);
  const [adjustment, setAdjustment] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEscape(onClose);

  const entered = evaluateAmountEntry(fmt.typedAmount(typed), fmt.digits);
  // A typed 199,500.00 is what is owed: the account balance is its negative.
  const lender = entered === null ? null : entered === 0 ? 0 : -Math.abs(entered);
  const escrowValue = evaluateAmountEntry(fmt.typedAmount(escrow), fmt.digits);
  const ratesOk = RATE.test(rate) && (!mortgage || (escrowValue !== null && escrowValue >= 0));

  const body = (balance: number) => ({
    balance,
    current_balance: current,
    today: localToday(),
    ...(step === "rates" || step === "changes"
      ? {
          interest_rate: rate,
          keep_rate: keepRate,
          ...(mortgage && escrowValue !== null
            ? { escrow_amount: escrowValue, keep_escrow: keepEscrow }
            : {}),
        }
      : {}),
  });

  const fail = (e: unknown) => {
    setBusy(false);
    if (e instanceof ApiError && e.errorName === "balance_changed") {
      // The balance moved under the dialog: show the new figure and ask again.
      void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(budgetId) });
      setStep("ask");
      setTyped("");
      setError("The balance changed. Check the new balance.");
      return;
    }
    setError(e instanceof ApiError ? e.detail : "The balance was not updated.");
  };

  const write = (balance: number, to: Step | "close") => {
    setError(null);
    setBusy(true);
    save.mutate(body(balance), {
      onSuccess: () => {
        setBusy(false);
        if (to === "close") onClose();
        else setStep(to);
      },
      onError: fail,
    });
  };

  const next = async () => {
    if (lender === null) return;
    setError(null);
    if (step === "enter") {
      if (lender === current) write(lender, "done");
      else setStep("rates");
      return;
    }
    if (step === "rates") {
      setBusy(true);
      try {
        const p = await previewLoanBalance(budgetId, loan.id, body(lender));
        setBusy(false);
        setAdjustment(p.adjustment_amount);
        if (p.adjustment_amount === 0) write(lender, "done");
        else setStep("changes");
      } catch (e) {
        fail(e);
      }
      return;
    }
    if (step === "changes") write(lender, "done");
  };

  const difference = lender === null ? 0 : lender - current;
  const sign = (n: number) => (n < 0 ? fmt.money(n) : `+${fmt.abs(n)}`);

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog form edit-account update-balance"
        role="dialog"
        aria-modal="true"
        aria-label="Update Balance"
      >
        <div className="dialog-head">
          <h2>Update Balance</h2>
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
          {step === "ask" ? (
            <p className="ub-ask">{UPDATE_BALANCE_ASK(fmt.money(current))}</p>
          ) : null}
          {step === "enter" ? (
            <>
              <p className="ub-name">{loan.name}</p>
              <p className="ub-current">
                Current balance in Budget <strong>{fmt.money(current)}</strong>
              </p>
              <label htmlFor="ub-lender">Current balance at your financial institution</label>
              <input
                id="ub-lender"
                className="field"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </>
          ) : null}
          {step === "rates" ? (
            <>
              {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics and its own box */}
              <div className="ub-tile" role="group" aria-label="Difference">
                <span className="ub-tile-value">{fmt.abs(difference)}</span>
                <span className="ub-tile-label">Difference</span>
              </div>
              <p>{UPDATE_BALANCE_DIFFERENCE_TEXT}</p>
              <label htmlFor="ub-rate">Interest rate</label>
              <input
                id="ub-rate"
                className="field"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
              <label className="ub-check">
                <input
                  type="checkbox"
                  checked={keepRate}
                  onChange={(e) => setKeepRate(e.target.checked)}
                />
                Keep this new interest rate going forward
              </label>
              {mortgage ? (
                <>
                  <label htmlFor="ub-escrow">Monthly escrow amount</label>
                  <input
                    id="ub-escrow"
                    className="field"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={escrow}
                    onChange={(e) => setEscrow(e.target.value)}
                  />
                  <label className="ub-check">
                    <input
                      type="checkbox"
                      checked={keepEscrow}
                      onChange={(e) => setKeepEscrow(e.target.checked)}
                    />
                    Keep this new escrow amount going forward
                  </label>
                </>
              ) : null}
            </>
          ) : null}
          {step === "changes" ? (
            <>
              <p>{UPDATE_BALANCE_CHANGES_TEXT}</p>
              <h3 className="ub-changes">Changes</h3>
              <div className="ub-change-row">
                <span>Balance Adjustment</span>
                <strong>{sign(adjustment)}</strong>
              </div>
            </>
          ) : null}
          {step === "done" ? (
            <>
              <p className="ub-done-title">{UPDATE_BALANCE_DONE_TITLE}</p>
              <p>{UPDATE_BALANCE_DONE_TEXT}</p>
            </>
          ) : null}
          {error ? (
            <p className="error-bar" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          {step === "ask" ? (
            <>
              <button type="button" className="secondary" onClick={() => setStep("enter")}>
                No
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => write(current, "close")}
              >
                Yes
              </button>
            </>
          ) : step === "done" ? (
            <button type="button" className="primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || lender === null || (step === "rates" && !ratesOk)}
                onClick={next}
              >
                Next
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
