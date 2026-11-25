import { countLabel } from "@budget/schema/register-selection";
import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CloseSmallIcon } from "./icons";

/** A modal over the register: Escape and Cancel close it. */
export function Modal({
  title,
  onCancel,
  children,
  footer,
}: {
  title: string;
  onCancel: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onCancel]);
  return createPortal(
    <div className="dialog-backdrop">
      <div className="dialog form bulk-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel}>
            <CloseSmallIcon width={12} height={12} />
          </button>
        </div>
        <div className="form-body">{children}</div>
        <div className="dialog-footer">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

/** "Edit Memo (N Transactions)": Update stays disabled while the input is empty. */
export function MemoDialog({
  count,
  onCancel,
  onUpdate,
}: {
  count: number;
  onCancel: () => void;
  onUpdate: (memo: string) => void;
}) {
  const [text, setText] = useState("");
  const ok = text.trim() !== "";
  return (
    <Modal
      title={`Edit Memo (${countLabel(count)})`}
      onCancel={onCancel}
      footer={
        <>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!ok}
            onClick={() => ok && onUpdate(text)}
          >
            {`Update ${countLabel(count)}`}
          </button>
        </>
      }
    >
      <label>
        Memo
        <input
          className="bulk-input"
          // biome-ignore lint/a11y/noAutofocus: the dialog opens for this one input
          autoFocus
          value={text}
          maxLength={500}
          placeholder="Enter a memo for selected transactions"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ok) onUpdate(text);
          }}
        />
      </label>
    </Modal>
  );
}

export function DeleteDialog({
  title,
  paragraphs,
  onCancel,
  onDelete,
}: {
  title: string;
  paragraphs: string[];
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <Modal
      title={title}
      onCancel={onCancel}
      footer={
        <>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={onDelete}>
            Delete
          </button>
        </>
      }
    >
      {paragraphs.map((p) => (
        <p key={p} className="bulk-dialog-text">
          {p}
        </p>
      ))}
    </Modal>
  );
}

/** Saving an amount, date or account change of a reconciled transaction asks first. */
export function ReconciledSaveDialog({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Modal
      title="Save Changes to Reconciled Transaction"
      onCancel={onCancel}
      footer={
        <>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={onSave}>
            Save
          </button>
        </>
      }
    >
      <p className="bulk-dialog-text">
        Saving your changes to this reconciled transaction may bring your reconciliation out of
        balance.
      </p>
    </Modal>
  );
}

/** `reconciled`: the row is also reconciled, so this one dialog covers both warnings (EXF-981). */
export function ClosedAccountSaveDialog({
  reconciled = false,
  onCancel,
  onSave,
}: {
  reconciled?: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Modal
      title="Warning: Closed Account"
      onCancel={onCancel}
      footer={
        <>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={onSave}>
            Save
          </button>
        </>
      }
    >
      <p className="bulk-dialog-text">
        Editing transactions from closed accounts can result in unexpected changes to your plan.
      </p>
      {reconciled && (
        <p className="bulk-dialog-text">
          This transaction is also reconciled: saving your changes may bring your reconciliation out
          of balance.
        </p>
      )}
    </Modal>
  );
}

export function ExportDialog({
  onCancel,
  onExport,
}: {
  onCancel: () => void;
  onExport: (dontShowAgain: boolean) => void;
}) {
  const [dont, setDont] = useState(false);
  return (
    <Modal
      title="Export Transactions"
      onCancel={onCancel}
      footer={
        <>
          <label className="bulk-dialog-check">
            <input type="checkbox" checked={dont} onChange={(e) => setDont(e.target.checked)} />
            Don't show again
          </label>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => onExport(dont)}>
            Export
          </button>
        </>
      }
    >
      <p className="bulk-dialog-text">
        Your data is just that—yours! All the requested data will be exported in CSV format so it's
        easy to open in other applications.
      </p>
    </Modal>
  );
}
