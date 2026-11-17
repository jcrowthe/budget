import type { BudgetUpdate } from "@budget/schema/budgets";
import { DEFAULT_PLAN_FORMATS, planFormatter } from "@budget/schema/plan-formats";
import {
  COMMON_CURRENCY_CODES,
  CURRENCIES,
  type Currency,
  currencyByCode,
  DATE_FORMAT_OPTIONS,
  NUMBER_FORMATS,
  type Placement,
  placementOf,
} from "@budget/schema/plan-formats-catalogue";
import type { DateFormat } from "@budget/schema/plan-import-read";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useUpdateBudget } from "../api/budgets";
import { CloseIcon } from "../shell/icons";
import { useCurrentPlan } from "../shell/useCurrentPlan";
import "./plan-settings.css";

const label = (c: Currency) => `${c.name}–${c.code}`;
const common = COMMON_CURRENCY_CODES.map((code) => currencyByCode(code) as Currency);

/** "30 December of this year" in each date format, as the options show it. */
function dateLabel(format: DateFormat): string {
  const f = planFormatter({ ...DEFAULT_PLAN_FORMATS, date_format: { format } });
  return f.date(`${new Date().getFullYear()}-12-30`);
}

function placementLabel(p: Placement, symbol: string, numberFormat: string): string {
  if (p === "before") return `Before amount (${symbol}${numberFormat})`;
  if (p === "after") return `After amount (${numberFormat}${symbol})`;
  return `Don't show (${numberFormat})`;
}

/** Plan Settings: the plan's name, currency, currency placement, number format and date format. */
export function PlanSettingsDialog({
  budgetId,
  onClose,
}: {
  budgetId: string | null;
  onClose: () => void;
}) {
  const { plans } = useCurrentPlan();
  const plan = plans.find((p) => p.id === budgetId);
  const update = useUpdateBudget();
  const saved = {
    name: plan?.name ?? "",
    code: plan?.currency_format.iso_code ?? "USD",
    numberFormat: plan?.currency_format.example_format ?? "123,456.78",
    placement: plan ? placementOf(plan.currency_format) : ("before" as Placement),
    dateFormat: plan?.date_format.format ?? ("MM/DD/YYYY" as DateFormat),
  };
  const [name, setName] = useState(saved.name);
  const [code, setCode] = useState(saved.code);
  const [numberFormat, setNumberFormat] = useState(saved.numberFormat);
  const [placement, setPlacement] = useState<Placement>(saved.placement);
  const [dateFormat, setDateFormat] = useState<DateFormat>(saved.dateFormat);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const currency = currencyByCode(code) ?? (currencyByCode("USD") as Currency);

  const close = () => {
    onClose();
    document.querySelector<HTMLElement>(".plan-button, .rail-logo")?.focus();
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function changeCurrency(next: string) {
    const c = currencyByCode(next);
    if (!c) return;
    setCode(next);
    setNumberFormat(c.number_format);
    setPlacement(c.placement);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!budgetId) return;
    const trimmed = name.trim();
    if (trimmed === "") {
      setNameError("Plan name is required.");
      nameRef.current?.focus();
      return;
    }
    const patch: BudgetUpdate = {};
    if (trimmed !== saved.name) patch.name = trimmed;
    if (
      code !== saved.code ||
      numberFormat !== saved.numberFormat ||
      placement !== saved.placement
    ) {
      patch.currency_format = {
        iso_code: code,
        example_format: numberFormat,
        symbol_placement: placement,
      };
    }
    if (dateFormat !== saved.dateFormat) patch.date_format = { format: dateFormat };
    if (Object.keys(patch).length === 0) {
      close();
      return;
    }
    update.mutate({ id: budgetId, patch }, { onSuccess: close });
  }

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog form plan-settings"
        role="dialog"
        aria-modal="true"
        aria-label="Plan Settings"
        noValidate
        onSubmit={submit}
      >
        <div className="dialog-head">
          <h2>Plan Settings</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            title="Close"
            onClick={close}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="form-body">
          <label htmlFor="plan-settings-name">Plan Name</label>
          <input
            id="plan-settings-name"
            ref={nameRef}
            className="field"
            maxLength={100}
            autoComplete="off"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "plan-settings-name-error" : undefined}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
          />
          {nameError ? (
            <p id="plan-settings-name-error" className="error">
              {nameError}
            </p>
          ) : null}
          <div className="plan-settings-row">
            <div>
              <label htmlFor="plan-settings-currency">Currency</label>
              <select
                id="plan-settings-currency"
                className="field"
                value={code}
                onChange={(e) => changeCurrency(e.target.value)}
              >
                <optgroup label="Common Currencies">
                  {common.map((c) => (
                    <option key={c.code} value={c.code}>
                      {label(c)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="All Currencies">
                  {CURRENCIES.map((c) => (
                    <option key={`${c.code}-${c.name}`} value={c.code}>
                      {label(c)}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div>
              <label htmlFor="plan-settings-placement">Currency Placement</label>
              <select
                id="plan-settings-placement"
                className="field"
                value={placement}
                onChange={(e) => setPlacement(e.target.value as Placement)}
              >
                {(["before", "after", "none"] as const).map((p) => (
                  <option key={p} value={p}>
                    {placementLabel(p, currency.symbol, numberFormat)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label htmlFor="plan-settings-number-format">Number Format</label>
          <select
            id="plan-settings-number-format"
            className="field"
            value={numberFormat}
            onChange={(e) => setNumberFormat(e.target.value)}
          >
            {NUMBER_FORMATS[currency.decimal_digits].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <label htmlFor="plan-settings-date-format">Date Format</label>
          <select
            id="plan-settings-date-format"
            className="field"
            value={dateFormat}
            onChange={(e) => setDateFormat(e.target.value as DateFormat)}
          >
            {DATE_FORMAT_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {dateLabel(f)}
              </option>
            ))}
          </select>
          {update.error ? (
            <p className="error" role="alert">
              {update.error.message}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={update.isPending}>
            Apply Settings
          </button>
        </div>
      </form>
    </div>
  );
}
