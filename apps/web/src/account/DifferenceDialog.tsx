import { DIFFERENCE_TEXT } from "@budget/schema/reconcile";
import { screenMoney } from "@budget/schema/screen-money";
import { useState } from "react";

/** The Difference step: the anchored popover's third step (no title bar, no close button). */
export function DifferenceDialog({
  difference,
  onNext,
}: {
  difference: number;
  onNext: (dontShowAgain: boolean) => void;
}) {
  const [dont, setDont] = useState(false);
  return (
    <div className="reconcile-popover is-difference" role="dialog" aria-label="Reconcile">
      <div className="reconcile-diff-card">
        <p className="reconcile-big">{screenMoney(difference)}</p>
        <p className="reconcile-big-label">Difference</p>
      </div>
      {DIFFERENCE_TEXT.map((t) => (
        <p key={t} className="reconcile-diff-text">
          {t.startsWith("To correct this") ? (
            <>
              <strong>To correct this</strong>
              {t.slice("To correct this".length)}
            </>
          ) : (
            t
          )}
        </p>
      ))}
      <div className="reconcile-diff-foot">
        <label className="bulk-dialog-check">
          <input type="checkbox" checked={dont} onChange={(e) => setDont(e.target.checked)} />
          Don’t Show Again
        </label>
        <button type="button" className="primary" onClick={() => onNext(dont)}>
          Next
        </button>
      </div>
    </div>
  );
}
