import type { Budget } from "@budget/schema/budgets";
import { useEffect, useRef } from "react";
import { useDeleteBudget } from "../api/budgets";
import "../account/edit-account.css";
import { CloseIcon } from "../shell/icons";
import "./plans-list.css";

/** "Delete Plan": the only way to delete a plan on the page. Escape, ✕ and Cancel leave the plan alone. */
export function DeletePlanDialog({
  plan,
  onClose,
  onDeleted,
}: {
  plan: Budget;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const del = useDeleteBudget();
  // Nothing closes the dialog while the DELETE is pending: a failure must show its message.
  const closeRef = useRef(() => {});
  closeRef.current = () => {
    if (!del.isPending) onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog form edit-account plans-list-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Delete Plan"
      >
        <div className="dialog-head">
          <h2>Delete Plan</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            title="Close"
            disabled={del.isPending}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="form-body">
          <p className="close-text">Are you sure you want to delete plan {plan.name}?</p>
          {del.error ? (
            <p className="error-bar" role="alert">
              {del.error.message}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="secondary" disabled={del.isPending} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="destructive"
            disabled={del.isPending}
            onClick={() => del.mutate(plan.id, { onSuccess: onDeleted })}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
