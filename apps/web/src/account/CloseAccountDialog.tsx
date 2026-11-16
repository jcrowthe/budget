import type { Account } from "@budget/schema/accounts";
import { screenMoney } from "@budget/schema/screen-money";
import { useEffect, useRef } from "react";
import { CloseIcon } from "../shell/icons";
import "./edit-account.css";

/** "Close Account": the confirmation for an account whose balance is not zero. */
export function CloseAccountDialog({
  account,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  account: Account;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
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
        aria-label="Close Account"
      >
        <div className="dialog-head">
          <h2>Close Account</h2>
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
            Before you can close this account, the balance will have to be zeroed out. An adjustment
            transaction will be created for {screenMoney(-account.balance)}.
          </p>
          {account.on_budget ? (
            <div className="info-box">
              The money in this account will be removed from your plan. If you would like to keep it
              in your plan, you can transfer it to another account before closing this one.
            </div>
          ) : null}
          {error ? (
            <p className="error-bar" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={busy} onClick={onConfirm}>
            Adjust Balance & Close
          </button>
        </div>
      </div>
    </div>
  );
}
