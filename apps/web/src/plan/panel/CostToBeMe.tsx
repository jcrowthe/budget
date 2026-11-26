import type { Month } from "@budget/core/month";
import { evaluateAmountEntry, formatAmountEntry } from "@budget/schema/amount-entry";
import { useId, useRef, useState } from "react";
import { useUpdateBudget } from "../../api/budgets";
import { ApiError } from "../../api/client";
import { usePlanFormatter } from "../../shell/plan-formats-context";
import { longMonth } from "../format";
import { CalculatorIcon, PencilIcon } from "../icons";
import { costBars } from "./costToBeMe";
import { PanelTooltip } from "./PanelTooltip";
import "./cost-to-be-me.css";

/**
 * "Cost to Be Me" (EXF-525): this month's targets total, the plan's optional expected income entered inline,
 * two comparison bars, and next month's total when it is higher. The totals come from the month summary.
 */
export function CostToBeMe({
  budgetId,
  month,
  total,
  next,
  income,
}: {
  budgetId: string;
  month: Month;
  total: number;
  next: number;
  /** The plan's expected income in milliunits; null when not set. */
  income: number | null;
}) {
  const fmt = usePlanFormatter();
  const update = useUpdateBudget();
  const here = longMonth(month);
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = () => {
    setText(income ? formatAmountEntry(income, fmt) : "");
    setError(null);
    setEditing(true);
  };
  const close = () => {
    setEditing(false);
    setError(null);
  };
  const save = () => {
    const t = text.trim();
    let value: number | null = null;
    if (t.startsWith("-")) {
      setError("Expected income can't be negative.");
      return;
    }
    // Empty and zero clear the income; anything else must compute.
    if (t !== "" && !/^[0\s.,]*$/.test(t)) {
      value = evaluateAmountEntry(fmt.typedAmount(t), fmt.digits);
      if (value === null) {
        setError("Enter an amount, like 5,000.");
        return;
      }
    }
    update.mutate(
      { id: budgetId, patch: { expected_income: value } },
      {
        onSuccess: close,
        onError: (e) =>
          setError(e instanceof ApiError ? e.detail : "Could not save your expected income."),
      },
    );
  };

  const bars = income ? costBars(total, income) : null;
  return (
    <section className="ctbm" aria-labelledby={`${inputId}-title`}>
      <h4 id={`${inputId}-title`} className="ctbm-title">
        Cost to Be Me
      </h4>
      <PanelTooltip
        text={`The total of every target's amount for ${here}, snoozed targets included.`}
      >
        {(trigger) => (
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the row is focusable so its tooltip is reachable by keyboard
          <div {...trigger} tabIndex={0} className="panel-row" data-testid="ctbm-targets-row">
            <span className="panel-row-label">{here}'s Targets</span>
            <span className="panel-row-value">{fmt.money(total)}</span>
          </div>
        )}
      </PanelTooltip>
      {editing ? (
        <form
          className="ctbm-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="ctbm-label" htmlFor={inputId}>
            Expected Income
          </label>
          <div className="ctbm-input">
            <CalculatorIcon className="ctbm-calculator" width={16} height={16} />
            <input
              id={inputId}
              ref={(el) => {
                inputRef.current = el;
                el?.focus();
              }}
              type="text"
              inputMode="decimal"
              aria-label="Expected Income"
              aria-invalid={error !== null}
              autoComplete="off"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  close();
                }
              }}
            />
          </div>
          {error && (
            <p className="ctbm-error" role="alert">
              {error}
            </p>
          )}
          <div className="ctbm-actions">
            <button type="button" className="ctbm-btn" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="ctbm-btn is-primary" disabled={update.isPending}>
              Save
            </button>
          </div>
        </form>
      ) : income ? (
        <div className="panel-row ctbm-income-row">
          <span className="panel-row-label">Expected Income</span>
          <span className="panel-row-value">{fmt.money(income)}</span>
          <button type="button" className="ctbm-edit" aria-label="Edit your income" onClick={open}>
            <PencilIcon width={14} height={14} />
          </button>
        </div>
      ) : (
        <button type="button" className="ctbm-btn ctbm-enter" onClick={open}>
          Enter your expected income
        </button>
      )}
      {bars && (
        <div className="ctbm-bars">
          <div className="ctbm-track">
            <div
              data-testid="ctbm-targets-bar"
              className={`ctbm-fill is-targets${bars.deficit ? " has-deficit" : ""}`}
              style={{ width: `${bars.targetsPct}%` }}
            />
          </div>
          <div className="ctbm-track">
            <div
              data-testid="ctbm-income-bar"
              className="ctbm-fill is-income"
              style={{ width: `${bars.incomePct}%` }}
            />
          </div>
        </div>
      )}
      {next > total && (
        <p className="ctbm-next">
          Next month's targets could increase your total to <strong>{fmt.money(next)}</strong>
        </p>
      )}
    </section>
  );
}
