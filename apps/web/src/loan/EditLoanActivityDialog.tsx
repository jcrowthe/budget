import { evaluateAmountEntry, formatAmountEntry } from "@budget/schema/amount-entry";
import {
  DELETE_LINE_BODY,
  DELETE_LINE_TITLE,
  EDIT_ACTIVITY_LABELS,
  EDIT_CREDIT_TITLE,
  EDIT_ESCROW_TITLE,
  EDIT_FEE_TITLE,
  EDIT_INTEREST_TITLE,
} from "@budget/schema/loan-manage";
import { useState } from "react";
import { ApiError } from "../api/client";
import { useManageLoanActivity } from "../api/loans";
import { localToday } from "../api/today";
import "../account/edit-account.css";
import { CloseIcon } from "../shell/icons";
import { usePlanFormatter } from "../shell/plan-formats-context";
import "./loan-activity.css";
import { useEscape } from "./useEscape";

/** The recorded line to change: an interest or escrow line (its month shown), a fee or a credit. `amount` is a magnitude. */
export type EditTarget = {
  kind: "interest" | "escrow" | "fee" | "credit";
  transactionId: string;
  amount: number;
  date: string;
  memo: string | null;
  /** interest and escrow: the month the line belongs to, as the page shows it. */
  monthLabel?: string;
};

const TITLES = {
  interest: EDIT_INTEREST_TITLE,
  escrow: EDIT_ESCROW_TITLE,
  fee: EDIT_FEE_TITLE,
  credit: EDIT_CREDIT_TITLE,
} as const;

/** Edit Interest, Edit Escrow, Edit Fee or Charge and Edit Credit on a loan's Account Activity, with Delete behind a confirm. */
export function EditLoanActivityDialog({
  budgetId,
  loanId,
  target,
  onClose,
}: {
  budgetId: string;
  loanId: string;
  target: EditTarget;
  onClose: () => void;
}) {
  const fmt = usePlanFormatter();
  const today = localToday();
  const { update, remove } = useManageLoanActivity(budgetId, loanId, target.transactionId);
  const interest = target.kind === "interest" || target.kind === "escrow"; // a month line: amount only
  const [amount, setAmount] = useState(() => formatAmountEntry(target.amount, fmt));
  const [date, setDate] = useState(() => fmt.date(target.date));
  const [memo, setMemo] = useState(target.memo ?? "");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(confirming ? () => setConfirming(false) : onClose);

  const value = evaluateAmountEntry(fmt.typedAmount(amount), fmt.digits);
  const iso = interest ? target.date : fmt.parseDate(date, today);
  const busy = update.isPending || remove.isPending;
  const canSave = value !== null && value > 0 && iso !== null && !busy;
  const fail = (fallback: string) => (e: unknown) =>
    setError(e instanceof ApiError ? e.detail : fallback);

  const submit = () => {
    if (!canSave || value === null || iso === null) return;
    setError(null);
    update.mutate(
      interest ? { amount: value, today } : { amount: value, date: iso, memo: memo.trim() || null },
      { onSuccess: onClose, onError: fail("The line was not saved.") },
    );
  };
  const del = () => {
    setError(null);
    remove.mutate(undefined, {
      onSuccess: onClose,
      onError: (e) => {
        setConfirming(false);
        fail("The line was not deleted.")(e);
      },
    });
  };

  const title = TITLES[target.kind];
  const id = `loan-edit-${target.kind}`;
  return (
    <div className="dialog-backdrop">
      {confirming ? (
        <div
          className="dialog form edit-account loan-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-label={DELETE_LINE_TITLE}
        >
          <div className="dialog-head">
            <h2>{DELETE_LINE_TITLE}</h2>
          </div>
          <div className="form-body">
            <p className="loan-intro">{DELETE_LINE_BODY}</p>
          </div>
          <div className="dialog-footer">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              {EDIT_ACTIVITY_LABELS.cancel}
            </button>
            <button type="button" className="destructive" disabled={busy} onClick={del}>
              {EDIT_ACTIVITY_LABELS.delete}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="dialog form edit-account loan-pay-form"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="dialog-head">
            <h2>{title}</h2>
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
            {interest ? (
              <p className="loan-intro">
                {EDIT_ACTIVITY_LABELS.month}: {target.monthLabel}
              </p>
            ) : null}
            <label htmlFor={`${id}-amount`}>{EDIT_ACTIVITY_LABELS.amount}</label>
            <input
              id={`${id}-amount`}
              className="field"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              // biome-ignore lint/a11y/noAutofocus: the dialog's first field
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {interest ? null : (
              <>
                <label htmlFor={`${id}-date`}>{EDIT_ACTIVITY_LABELS.date}</label>
                <input
                  id={`${id}-date`}
                  className="field"
                  type="text"
                  autoComplete="off"
                  placeholder={fmt.dateFormat}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
                <label htmlFor={`${id}-memo`}>{EDIT_ACTIVITY_LABELS.memo}</label>
                <input
                  id={`${id}-memo`}
                  className="field"
                  type="text"
                  maxLength={500}
                  autoComplete="off"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                />
              </>
            )}
            {error ? (
              <p className="error-bar" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <div className="dialog-footer loan-edit-footer">
            <button
              type="button"
              className="destructive loan-delete"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              {EDIT_ACTIVITY_LABELS.delete}
            </button>
            <button type="button" className="secondary" onClick={onClose}>
              {EDIT_ACTIVITY_LABELS.cancel}
            </button>
            <button type="submit" className="primary" disabled={!canSave}>
              {EDIT_ACTIVITY_LABELS.save}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
