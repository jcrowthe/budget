import type { MonthGroupDetail } from "@budget/schema/months";
import { useState } from "react";
import { ApiError } from "../api/client";
import { usePairLoanCategory } from "../api/loans";
import { useMonth } from "../api/months";
import { localToday } from "../api/today";
import "../account/edit-account.css";
import { CloseIcon } from "../shell/icons";
import "./loan-page.css";
import { useEscape } from "./useEscape";

const usable = (g: MonthGroupDetail) => !g.hidden && g.kind === null;

/** "Get Started" on an unpaired loan: pair it with an existing category (the EXF-482 pairing step's select). */
export function PairLoanDialog({
  budgetId,
  loanId,
  onClose,
}: {
  budgetId: string;
  loanId: string;
  onClose: () => void;
}) {
  const month = useMonth(budgetId, `${localToday().slice(0, 7)}-01`);
  const groups = (month.data?.groups ?? []).filter(usable);
  const save = usePairLoanCategory(budgetId, loanId);
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);
  const submit = () => {
    if (categoryId === "" || save.isPending) return;
    setError(null);
    save.mutate(categoryId, {
      onSuccess: onClose,
      onError: (e) => setError(e instanceof ApiError ? e.detail : "The pairing was not saved."),
    });
  };
  return (
    <div className="dialog-backdrop">
      <form
        className="dialog form edit-account loan-pair"
        role="dialog"
        aria-modal="true"
        aria-label="Pair a Category"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="dialog-head">
          <h2>Pair a Category</h2>
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
          <h3 className="loan-step-heading">Pair your loan with a plan category</h3>
          <p className="loan-intro">
            Pairing with a plan category helps better show how your payments will affect your debt.
            Pairing works best when there is a one-to-one relationship between your loan account and
            a plan category.
          </p>
          <label htmlFor="pair-loan-category">Select a category</label>
          <select
            id="pair-loan-category"
            className="field"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="" />
            {groups.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.categories
                  .filter((c) => !c.hidden && c.kind === null)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          {error ? (
            <p className="error-bar" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={categoryId === "" || save.isPending}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
