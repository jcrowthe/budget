import { unbalancedText } from "@budget/schema/split";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { usePlanFormatter } from "../shell/plan-formats-context";

/** "Something Doesn't Add Up": the lines of a split do not add up to its total. */
export function SplitDialog({
  total,
  sum,
  onAutoDistribute,
  onUpdateTotal,
  onAdjust,
}: {
  total: number;
  sum: number;
  onAutoDistribute: () => void;
  onUpdateTotal: () => void;
  onAdjust: () => void;
}) {
  const fmt = usePlanFormatter();
  const titleId = useId();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  // Escape adjusts manually; the row behind never sees it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onAdjust();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onAdjust]);

  return createPortal(
    <div className="split-dialog-backdrop">
      <div className="split-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>Something Doesn't Add Up</h2>
        <p>{unbalancedText(total, sum, fmt)}</p>
        <div className="split-dialog-buttons">
          <button
            ref={first}
            type="button"
            className="entry-button is-primary"
            onClick={onAutoDistribute}
          >
            Auto-Distribute
          </button>
          <button type="button" className="entry-button subtle" onClick={onUpdateTotal}>
            Update Total
          </button>
          <button type="button" className="entry-button subtle" onClick={onAdjust}>
            Adjust Manually
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
