import type { Month } from "@budget/core/month";
import type { Account } from "@budget/schema/accounts";
import { evaluateAmountEntry, formatAmountEntry } from "@budget/schema/amount-entry";
import {
  RECORD_PAYMENT_AMOUNT_HELP,
  RECORD_PAYMENT_AVAILABLE,
  RECORD_PAYMENT_INTRO_LOAN,
  RECORD_PAYMENT_LABELS,
  RECORD_PAYMENT_TITLE,
} from "@budget/schema/loan-activity";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAccounts } from "../api/accounts";
import { ApiError } from "../api/client";
import { useRecordLoanPayment } from "../api/loans";
import { getMonth } from "../api/months";
import { localToday } from "../api/today";
import "../account/edit-account.css";
import { CloseIcon } from "../shell/icons";
import { usePlanFormatter } from "../shell/plan-formats-context";
import "./loan-activity.css";

const CASH = ["checking", "savings", "cash"];

/** "Record Payment" on a loan's page: a transfer from an open on-plan cash account, to the paired category. */
export function RecordLoanPaymentDialog({
  budgetId,
  loan,
  lastSourceId,
  onClose,
}: {
  budgetId: string;
  loan: Account;
  lastSourceId: string | null;
  onClose: () => void;
}) {
  const fmt = usePlanFormatter();
  const today = localToday();
  const month = `${today.slice(0, 7)}-01` as Month;
  // The month the Plan page loads (same query key), so the dialog adds no request of its own when it is cached.
  const monthQ = useQuery({
    queryKey: ["month", budgetId, month],
    queryFn: () => getMonth(budgetId, month),
    enabled: loan.paired_category_id !== null,
  });
  const paired = monthQ.data?.groups
    .flatMap((g) => g.categories)
    .find((c) => c.id === loan.paired_category_id);
  const available = paired && paired.available > 0 ? paired.available : null;

  const accounts = useAccounts(budgetId).data ?? [];
  const sources = accounts.filter((a) => !a.closed && a.on_budget && CASH.includes(a.type));
  const save = useRecordLoanPayment(budgetId, loan.id);

  const [amount, setAmount] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [date, setDate] = useState(() => fmt.date(today));
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const amountText = amount ?? (available !== null ? formatAmountEntry(available, fmt) : "");
  const source =
    from ?? (lastSourceId && sources.some((s) => s.id === lastSourceId) ? lastSourceId : "");
  const value = evaluateAmountEntry(fmt.typedAmount(amountText), fmt.digits);
  const iso = fmt.parseDate(date, today);
  const canSave = value !== null && value > 0 && source !== "" && iso !== null && !save.isPending;

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
    save.mutate(
      { from_account_id: source, amount: value, date: iso, memo: memo.trim() || undefined },
      {
        onSuccess: onClose,
        onError: (e) => setError(e instanceof ApiError ? e.detail : "The payment was not saved."),
      },
    );
  };

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog form edit-account loan-pay-form"
        role="dialog"
        aria-modal="true"
        aria-label={RECORD_PAYMENT_TITLE}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="dialog-head">
          <h2>{RECORD_PAYMENT_TITLE}</h2>
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
          <p>{RECORD_PAYMENT_INTRO_LOAN}</p>
          {paired && available !== null ? (
            <p className="loan-available">
              {RECORD_PAYMENT_AVAILABLE(fmt.abs(available), paired.name)}
            </p>
          ) : null}
          <label htmlFor="loan-pay-amount">{RECORD_PAYMENT_LABELS.amount}</label>
          <input
            id="loan-pay-amount"
            className="field"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="loan-help">{RECORD_PAYMENT_AMOUNT_HELP}</p>
          <label htmlFor="loan-pay-from">{RECORD_PAYMENT_LABELS.from}</label>
          <select
            id="loan-pay-from"
            className="field"
            value={source}
            onChange={(e) => setFrom(e.target.value)}
          >
            <option value="">Select an account</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label htmlFor="loan-pay-date">{RECORD_PAYMENT_LABELS.date}</label>
          <input
            id="loan-pay-date"
            className="field"
            type="text"
            autoComplete="off"
            placeholder={fmt.dateFormat}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <label htmlFor="loan-pay-memo">{RECORD_PAYMENT_LABELS.memo}</label>
          <input
            id="loan-pay-memo"
            className="field"
            type="text"
            maxLength={500}
            autoComplete="off"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
          {error ? (
            <p className="error-bar" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="secondary" onClick={onClose}>
            {RECORD_PAYMENT_LABELS.cancel}
          </button>
          <button type="submit" className="primary" disabled={!canSave}>
            {RECORD_PAYMENT_LABELS.save}
          </button>
        </div>
      </form>
    </div>
  );
}
