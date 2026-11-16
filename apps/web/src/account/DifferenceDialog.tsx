import { DIFFERENCE_TEXT } from "@budget/schema/reconcile";
import { screenMoney } from "@budget/schema/screen-money";
import { useState } from "react";
import { Modal } from "../register/BulkDialogs";

/** The modal after "Next" on the bank balance: the signed difference and what to do about it. */
export function DifferenceDialog({
  difference,
  onCancel,
  onNext,
}: {
  difference: number;
  onCancel: () => void;
  onNext: (dontShowAgain: boolean) => void;
}) {
  const [dont, setDont] = useState(false);
  return (
    <Modal
      title="Difference"
      onCancel={onCancel}
      footer={
        <>
          <label className="bulk-dialog-check">
            <input type="checkbox" checked={dont} onChange={(e) => setDont(e.target.checked)} />
            Don't Show Again
          </label>
          <button type="button" className="primary" onClick={() => onNext(dont)}>
            Next
          </button>
        </>
      }
    >
      <p className="reconcile-big">{screenMoney(difference)}</p>
      <p className="reconcile-big-label">Difference</p>
      {DIFFERENCE_TEXT.map((t) => (
        <p key={t} className="bulk-dialog-text">
          {t}
        </p>
      ))}
    </Modal>
  );
}
