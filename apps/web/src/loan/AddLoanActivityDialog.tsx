import type { Month } from "@budget/core/month";
import { addMonths } from "@budget/core/month";
import { evaluateAmountEntry } from "@budget/schema/amount-entry";
import {
  RECORD_CHARGE,
  RECORD_CREDIT,
  RECORD_ESCROW,
  RECORD_INTEREST,
} from "@budget/schema/loan-add-activity";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { useAddLoanActivity } from "../api/loans";
import { useMonthRange } from "../api/months";
import { localToday } from "../api/today";
import "../account/edit-account.css";
import { monthLabel, navLimits } from "../plan/monthNav";
import { CloseIcon } from "../shell/icons";
import { usePlanFormatter } from "../shell/plan-formats-context";
import "./loan-activity.css";

export type AddKind = "interest" | "escrow" | "fee" | "credit";

/** Months from `earliest` to `current`, newest first. */
function monthChoices(earliest: Month, current: Month): Month[] {
  const out: Month[] = [];
  for (let m = current; m >= earliest && out.length < 600; m = addMonths(m, -1)) out.push(m);
  return out;
}

/** Record Interest, Record Escrow, Record New Charge and Record Credit or Refund on a loan's page (EXF-542). */
export function AddLoanActivityDialog({
  budgetId,
  loanId,
  kind,
  onClose,
}: {
  budgetId: string;
  loanId: string;
  kind: AddKind;
  onClose: () => void;
}) {
  const fmt = usePlanFormatter();
  const today = localToday();
  const current = `${today.slice(0, 7)}-01` as Month;
  const limits = navLimits(useMonthRange(budgetId).data, current);
  const save = useAddLoanActivity(budgetId, loanId);

  const monthly = kind === "interest" || kind === "escrow";
  const copy =
    kind === "interest"
      ? RECORD_INTEREST
      : kind === "escrow"
        ? RECORD_ESCROW
        : kind === "fee"
          ? RECORD_CHARGE
          : RECORD_CREDIT;
  const [amount, setAmount] = useState("");
  const [month, setMonth] = useState<Month>(current);
  const [date, setDate] = useState(() => fmt.date(today));
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const value = evaluateAmountEntry(fmt.typedAmount(amount), fmt.digits);
  const iso = monthly ? today : fmt.parseDate(date, today);
  const canSave = value !== null && value > 0 && iso !== null && !save.isPending;

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const submit = () => {
    if (!canSave || value === null || iso === null) return;
    setError(null);
    const input = monthly
      ? { kind, amount: value, month, today }
      : { kind, amount: value, date: iso, memo: memo.trim() || undefined, today };
    save.mutate(input, {
      onSuccess: onClose,
      onError: (e) => setError(e instanceof ApiError ? e.detail : "The activity was not saved."),
    });
  };

  const texts = "text" in copy ? [copy.text] : copy.texts;
  const id = `loan-add-${kind}`;
  return (
    <div className="dialog-backdrop">
      <form
        className="dialog form edit-account loan-pay-form"
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="dialog-head">
          <h2>{copy.title}</h2>
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
          {texts.map((t) => (
            <p key={t} className="loan-intro">
              {t}
            </p>
          ))}
          <label htmlFor={`${id}-amount`}>{copy.labels.amount}</label>
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
          {monthly ? (
            <>
              <label htmlFor={`${id}-month`}>{RECORD_INTEREST.labels.month}</label>
              <select
                id={`${id}-month`}
                className="field"
                value={month}
                onChange={(e) => setMonth(e.target.value as Month)}
              >
                {monthChoices(limits?.earliest ?? current, current).map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <label htmlFor={`${id}-date`}>{RECORD_CHARGE.labels.date}</label>
              <input
                id={`${id}-date`}
                className="field"
                type="text"
                autoComplete="off"
                placeholder={fmt.dateFormat}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <label htmlFor={`${id}-memo`}>{RECORD_CHARGE.labels.memo}</label>
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
        <div className="dialog-footer">
          <button type="button" className="secondary" onClick={onClose}>
            {copy.labels.cancel}
          </button>
          <button type="submit" className="primary" disabled={!canSave}>
            {copy.labels.save}
          </button>
        </div>
      </form>
    </div>
  );
}
