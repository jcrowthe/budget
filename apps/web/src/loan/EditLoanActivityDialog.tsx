import { evaluateAmountEntry, formatAmountEntry } from "@budget/schema/amount-entry";
import {
  DELETE_LINE_BODY,
  DELETE_LINE_TITLE,
  DELETE_PAYMENT_BODY,
  DELETE_PAYMENT_TITLE,
  EDIT_ACTIVITY_LABELS,
  EDIT_CREDIT_TITLE,
  EDIT_ESCROW_TITLE,
  EDIT_FEE_TITLE,
  EDIT_INTEREST_TITLE,
  EDIT_PAYMENT_TITLE,
  PAYMENT_FROM_LABEL,
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

/** The recorded line to change: an interest or escrow line (its month shown), a fee, a credit or a payment. `amount` is a magnitude. */
export type EditTarget = {
  kind: "interest" | "escrow" | "fee" | "credit" | "payment";
  transactionId: string;
  amount: number;
  date: string;
  memo: string | null;
  /** interest and escrow: the month the line belongs to, as the page shows it. */
  monthLabel?: string;
  /** payment: the name of the account it came from; the cash side changes with it. */
  fromName?: string;
};

const TITLES = {
  interest: EDIT_INTEREST_TITLE,
  escrow: EDIT_ESCROW_TITLE,
  fee: EDIT_FEE_TITLE,
  credit: EDIT_CREDIT_TITLE,
  payment: EDIT_PAYMENT_TITLE,
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
  const monthLine = target.kind === "interest" || target.kind === "escrow"; // amount only, its month shown
  const [amount, setAmount] = useState(() => formatAmountEntry(target.amount, fmt));
  const [date, setDate] = useState(() => fmt.date(target.date));
  const [memo, setMemo] = useState(target.memo ?? "");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(confirming ? () => setConfirming(false) : onClose);

  const value = evaluateAmountEntry(fmt.typedAmount(amount), fmt.digits);
  const iso = monthLine ? target.date : fmt.parseDate(date, today);
  const busy = update.isPending || remove.isPending;
  const canSave = value !== null && value > 0 && iso !== null && !busy;
  const fail = (fallback: string) => (e: unknown) =>
    setError(e instanceof ApiError ? e.detail : fallback);

  const submit = () => {
    if (!canSave || value === null || iso === null) return;
    setError(null);
    update.mutate(
      monthLine
        ? { amount: value, today }
        : { amount: value, date: iso, memo: memo.trim() || null },
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
  const payment = target.kind === "payment";
  const confirmTitle = payment ? DELETE_PAYMENT_TITLE : DELETE_LINE_TITLE;
  const confirmBody = payment ? DELETE_PAYMENT_BODY(target.fromName ?? "") : DELETE_LINE_BODY;
  const id = `loan-edit-${target.kind}`;
  return (
    <div className="dialog-backdrop">
      {confirming ? (
        <div
          className="dialog form edit-account loan-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-label={confirmTitle}
        >
          <div className="dialog-head">
            <h2>{confirmTitle}</h2>
          </div>
          <div className="form-body">
            <p className="loan-intro">{confirmBody}</p>
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
            {monthLine ? (
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
            {monthLine ? null : (
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
            {payment ? (
              <p className="loan-intro">{PAYMENT_FROM_LABEL(target.fromName ?? "")}</p>
            ) : null}
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
