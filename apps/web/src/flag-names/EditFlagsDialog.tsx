import { FLAG_COLORS, FLAG_NAMES, type FlagColor } from "@budget/schema/transactions";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useFlagNames, useUpdateBudget } from "../api/budgets";
import { FlagFilledIcon } from "../register/icons";
import { CloseIcon } from "../shell/icons";
import "../register/register.css";
import "./edit-flags.css";

const MAX_NAME = 50;

/**
 * Edit Flags (EXF-480): a name for each of the six flag colours of the plan. Done saves, Cancel, the close
 * button and Escape discard.
 */
export function EditFlagsDialog({
  budgetId,
  onClose,
}: {
  budgetId: string | null;
  onClose: () => void;
}) {
  const { names } = useFlagNames(budgetId ?? undefined);
  const update = useUpdateBudget();
  const [values, setValues] = useState<Record<FlagColor, string>>(
    () =>
      Object.fromEntries(FLAG_COLORS.map((c) => [c, names[c] ?? FLAG_NAMES[c]])) as Record<
        FlagColor,
        string
      >,
  );
  const first = useRef<HTMLInputElement>(null);
  const close = () => onClose();
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    first.current?.focus();
    first.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!budgetId) return;
    // A field that is empty, or shows (or was set back to) its colour's own name, means the default: null.
    // So an untouched dialog never stores "Red". Only the keys that changed are sent.
    const patch: Partial<Record<FlagColor, string | null>> = {};
    for (const c of FLAG_COLORS) {
      const t = values[c].trim();
      const wanted = t === "" || t === FLAG_NAMES[c] ? null : t;
      if (wanted !== names[c]) patch[c] = wanted;
    }
    if (Object.keys(patch).length === 0) {
      close();
      return;
    }
    update.mutate({ id: budgetId, patch: { flag_names: patch } }, { onSuccess: close });
  }

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog form edit-flags-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-flags-title"
        noValidate
        onSubmit={submit}
      >
        <div className="dialog-head">
          <h2 id="edit-flags-title">Edit Flags</h2>
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
          {FLAG_COLORS.map((c, i) => (
            <div key={c} className="edit-flags-row">
              <FlagFilledIcon className={`flag-${c}`} />
              <input
                ref={i === 0 ? first : undefined}
                type="text"
                className="field"
                maxLength={MAX_NAME}
                autoComplete="off"
                placeholder={FLAG_NAMES[c]}
                aria-label={FLAG_NAMES[c]}
                value={values[c]}
                onChange={(e) => setValues((v) => ({ ...v, [c]: e.target.value }))}
              />
            </div>
          ))}
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
            Done
          </button>
        </div>
      </form>
    </div>
  );
}
