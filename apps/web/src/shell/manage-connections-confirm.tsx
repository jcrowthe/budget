import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import "../account/edit-account.css";
import { errorDetail } from "../api/bank-link";
import { CloseIcon } from "./icons";

/** A confirmation (Reset, Remove) swapped in for the Manage Bank Connections modal; modelled on Unlink Account. */
export function ConfirmConnectionDialog({
  title,
  text,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
  onDone,
}: {
  title: string;
  text: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const run = useMutation({ mutationFn: onConfirm, onSuccess: onDone });
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
        className="dialog form edit-account manage-connections-confirm"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog-head">
          <h2>{title}</h2>
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
          <p className="close-text">{text}</p>
          {run.isError ? (
            <p className="error-bar" role="alert">
              {errorDetail(run.error)}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={destructive ? "destructive" : "primary"}
            disabled={run.isPending}
            onClick={() => run.mutate()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
