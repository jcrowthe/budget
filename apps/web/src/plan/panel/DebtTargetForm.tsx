import { loanPayoff, paymentForMonths } from "@budget/core/debt-targets";
import { addMonths, type Month } from "@budget/core/month";
import type { Account } from "@budget/schema/accounts";
import {
  type DebtDraft,
  durationText,
  EVERY_OPTIONS,
  interestLabel,
  MINIMUM_SUMMARY,
  SUMMARY_LABELS,
} from "@budget/schema/debt-target";
import { useState } from "react";
import { usePlanFormatter } from "../../shell/plan-formats-context";
import { TrashIcon } from "../icons";
import { TargetAmountField } from "./TargetForm";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 2056" */
const monthLabel = (m: Month) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
/** The months listed when neither the minimum nor the typed payment pays the loan off. */
const DEFAULT_MONTHS = 360;

/**
 * The Debt Payment Target editor (EXF-545): Monthly Payment and Payoff Date move together (A6), Every picks the
 * day, and the Summary follows the payment (A7). The loan's balance and terms come from its account.
 */
export function DebtTargetForm({
  loan,
  currentMonth,
  draft,
  onDraft,
  error,
  busy,
  failure,
  canDelete,
  onCancel,
  onDelete,
  onSave,
}: {
  loan: Account;
  /** The owner's current month: Payoff Date counts from it. */
  currentMonth: Month;
  draft: DebtDraft;
  onDraft: (patch: Partial<DebtDraft>) => void;
  error?: string;
  busy: boolean;
  failure: string | null;
  canDelete: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onSave: () => void;
}) {
  const fmt = usePlanFormatter();
  const owed = Math.max(0, -loan.balance);
  const minimum = loan.minimum_payment ?? 0;
  const escrow = loan.type === "mortgage" ? (loan.escrow_amount ?? 0) : 0;
  const rate = loan.interest_rate;
  const terms = { owed, rate, escrow };
  // The Payoff Date the owner picked; typing a payment clears it so the date follows the payment.
  const [picked, setPicked] = useState<number | null>(null);

  const atMinimum = loanPayoff({ ...terms, payment: minimum });
  const now = loanPayoff({ ...terms, payment: draft.amount });
  const months = picked ?? now.months;
  const last = Math.max(atMinimum.months ?? 0, now.months ?? 0, picked ?? 0) || DEFAULT_MONTHS;
  const options = Array.from({ length: last }, (_, i) => i + 1);

  const row = (label: string, value: string) => (
    <div key={label} className="panel-row debt-summary-row">
      <span className="panel-row-label">{label}</span>
      <span className="panel-row-value">{value}</span>
    </div>
  );
  return (
    <div className="target-form debt-target-form" aria-busy={busy || undefined}>
      <p className="debt-minimum-line">
        {MINIMUM_SUMMARY}{" "}
        <strong>{atMinimum.months === null ? "—" : fmt.money(atMinimum.interest)}</strong>{" "}
        {SUMMARY_LABELS.interestRemaining} / <strong>{durationText(atMinimum.months)}</strong>{" "}
        {SUMMARY_LABELS.timeRemaining}
      </p>
      <dl className="target-block">
        <dt>Monthly Payment</dt>
        <dd>
          <TargetAmountField
            label="Monthly Payment"
            value={draft.amount}
            onChange={(amount) => {
              setPicked(null);
              onDraft({ amount });
            }}
            disabled={busy}
            invalid={!!error}
          />
        </dd>
      </dl>
      {error && (
        <p className="target-error" role="alert">
          {error}
        </p>
      )}
      <dl className="target-block">
        <dt>Payoff Date</dt>
        <dd>
          <span className="select-wrap">
            <select
              className="target-select"
              aria-label="Payoff Date"
              disabled={busy}
              value={months ?? ""}
              onChange={(e) => {
                const k = Number(e.target.value);
                setPicked(k);
                onDraft({ amount: paymentForMonths(terms, k) });
              }}
            >
              {months === null && (
                <option value="" disabled>
                  —
                </option>
              )}
              {options.map((k) => (
                <option key={k} value={k}>
                  {monthLabel(addMonths(currentMonth, k))}
                </option>
              ))}
            </select>
          </span>
        </dd>
      </dl>
      <dl className="target-block">
        <dt>Every</dt>
        <dd>
          <span className="select-wrap">
            <select
              className="target-select"
              aria-label="Every"
              disabled={busy}
              value={String(draft.day)}
              onChange={(e) =>
                onDraft({ day: e.target.value === "last" ? "last" : Number(e.target.value) })
              }
            >
              {EVERY_OPTIONS.map((o) => (
                <option key={o.value} value={String(o.value)}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
        </dd>
      </dl>
      <div className="debt-summary">
        <h3 className="target-label">Summary</h3>
        {row(SUMMARY_LABELS.minimum, fmt.money(minimum))}
        {row(SUMMARY_LABELS.timeRemaining, durationText(now.months))}
        {row(SUMMARY_LABELS.principal, fmt.money(owed))}
        {row(interestLabel(rate), now.months === null ? "—" : fmt.money(now.interest))}
        {row(SUMMARY_LABELS.remaining, now.months === null ? "—" : fmt.money(now.total))}
      </div>
      {failure && (
        <p className="target-error" role="alert">
          {failure}
        </p>
      )}
      <div className="target-actions">
        {canDelete ? (
          <button type="button" className="target-delete" disabled={busy} onClick={onDelete}>
            <TrashIcon width={16} height={16} />
            Delete
          </button>
        ) : (
          <span />
        )}
        <span className="target-actions-end">
          <button type="button" className="target-cancel" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="target-save" disabled={busy} onClick={onSave}>
            Save Target
          </button>
        </span>
      </div>
    </div>
  );
}
