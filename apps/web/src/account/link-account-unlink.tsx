import type { Account } from "@budget/schema/accounts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { invalidateBankLink, unlinkAccount } from "../api/bank-link";
import { CloseIcon } from "../shell/icons";
import "./edit-account.css";

/** "Unlink Account": its transactions stay in the plan, imports stop, the connection is kept. */
export function UnlinkAccountDialog({
  budgetId,
  account,
  onCancel,
  onUnlinked,
}: {
  budgetId: string;
  account: Account;
  onCancel: () => void;
  onUnlinked: () => void;
}) {
  const qc = useQueryClient();
  const unlink = useMutation({
    mutationFn: () => unlinkAccount(budgetId, account.id),
    onSuccess: () => {
      invalidateBankLink(qc, budgetId);
      onUnlinked();
    },
  });
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog form edit-account"
        role="dialog"
        aria-modal="true"
        aria-label="Unlink Account"
      >
        <div className="dialog-head">
          <h2>Unlink Account</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            title="Close"
            onClick={onCancel}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="form-body">
          <p className="close-text">
            Unlink "{account.name}" from its bank account? Its transactions stay in your plan, and
            no new transactions will be imported. You can link it again later.
          </p>
          {unlink.isError ? (
            <p className="error-bar" role="alert">
              {unlink.error.message}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="destructive"
            disabled={unlink.isPending}
            onClick={() => unlink.mutate()}
          >
            Unlink Account
          </button>
        </div>
      </div>
    </div>
  );
}
