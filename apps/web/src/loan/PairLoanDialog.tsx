import { useState } from "react";
import { ApiError } from "../api/client";
import { usePairLoanCategory } from "../api/loans";
import "../account/edit-account.css";
import {
  emptyPair,
  PairCategoryStep,
  pairReady,
  pairRequest,
} from "../shell/add-account-loan-steps";
import { CloseIcon } from "../shell/icons";
import "./loan-page.css";
import { useEscape } from "./useEscape";

/**
 * "Get Started" on an unpaired loan: pair it with an existing category or create a new one (the create flow's
 * pairing step, shared). The select keeps its label "Select a category".
 */
export function PairLoanDialog({
  budgetId,
  loanId,
  onClose,
}: {
  budgetId: string;
  loanId: string;
  onClose: () => void;
}) {
  const save = usePairLoanCategory(budgetId, loanId);
  const [pair, setPair] = useState(emptyPair);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);
  const ready = pairReady(pair) && !save.isPending;
  const submit = () => {
    if (!ready) return;
    setError(null);
    const { paired_category_id, new_category } = pairRequest(pair);
    save.mutate(
      paired_category_id !== undefined ? { category_id: paired_category_id } : { new_category },
      {
        onSuccess: onClose,
        onError: (e) => setError(e instanceof ApiError ? e.detail : "The pairing was not saved."),
      },
    );
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
          <PairCategoryStep budgetId={budgetId} value={pair} onChange={setPair} />
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
          <button type="submit" className="primary" disabled={!ready}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
