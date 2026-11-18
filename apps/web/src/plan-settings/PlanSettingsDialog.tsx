import type { BudgetUpdate } from "@budget/schema/budgets";
import { DEFAULT_PLAN_FORMATS } from "@budget/schema/plan-formats";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useUpdateBudget } from "../api/budgets";
import { CloseIcon } from "../shell/icons";
import { useCurrentPlan } from "../shell/useCurrentPlan";
import { formatValuesOf, PlanFormatFields } from "./new-plan-format-fields";
import "./plan-settings.css";

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
  const savedFormats = formatValuesOf(plan ?? DEFAULT_PLAN_FORMATS);
  const savedName = plan?.name ?? "";
  const [name, setName] = useState(savedName);
  const [values, setValues] = useState(savedFormats);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

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
    if (trimmed !== savedName) patch.name = trimmed;
    if (
      values.code !== savedFormats.code ||
      values.numberFormat !== savedFormats.numberFormat ||
      values.placement !== savedFormats.placement
    ) {
      patch.currency_format = {
        iso_code: values.code,
        example_format: values.numberFormat,
        symbol_placement: values.placement,
      };
    }
    if (values.dateFormat !== savedFormats.dateFormat)
      patch.date_format = { format: values.dateFormat };
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
          <PlanFormatFields idPrefix="plan-settings" value={values} onChange={setValues} />
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
