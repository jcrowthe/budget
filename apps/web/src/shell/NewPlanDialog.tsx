import { type FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useCreateBudget } from "../api/budgets";
import {
  DEFAULT_FORMAT_VALUES,
  type FormatValues,
  formatsInput,
  PlanFormatFields,
} from "../plan-settings/new-plan-format-fields";

/** New Plan: a name and the plan's currency and formats. Escape and Cancel close it; there is no close X. */
export function NewPlanDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [values, setValues] = useState<FormatValues>(DEFAULT_FORMAT_VALUES);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const create = useCreateBudget();
  const navigate = useNavigate();

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") {
      setNameError("Plan name is required.");
      nameRef.current?.focus();
      return;
    }
    // Errors are shown through create.error, so there is nothing to catch here.
    create.mutate(
      { name: trimmed, ...formatsInput(values) },
      {
        onSuccess: (budget) => {
          onClose();
          navigate(`/${budget.id}/budget`);
        },
      },
    );
  }

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog form plan-settings new-plan"
        role="dialog"
        aria-modal="true"
        aria-label="New Plan"
        noValidate
        onSubmit={submit}
      >
        <div className="dialog-head">
          <h2>New Plan</h2>
        </div>
        <div className="form-body">
          <label htmlFor="new-plan-name">Plan Name</label>
          <input
            id="new-plan-name"
            ref={nameRef}
            className="field"
            maxLength={100}
            autoComplete="off"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "new-plan-name-error" : undefined}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
          />
          {nameError ? (
            <p id="new-plan-name-error" className="error">
              {nameError}
            </p>
          ) : null}
          <PlanFormatFields idPrefix="new-plan" value={values} onChange={setValues} />
          {create.error ? (
            <p className="error" role="alert">
              {create.error.message}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={create.isPending}>
            Create Plan
          </button>
        </div>
      </form>
    </div>
  );
}
