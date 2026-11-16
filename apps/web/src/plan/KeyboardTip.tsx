import { SNOOZE_KEYBOARD_TIP } from "@budget/schema/target-wording";
import { useEffect } from "react";
import { hideTip, useTipVisible } from "./snooze";

/** The one-time toast after the first snooze: bottom centre, closed with its ×. */
export function KeyboardTip() {
  const visible = useTipVisible();
  // Leaving the page (or switching plan) drops it.
  useEffect(() => hideTip, []);
  if (!visible) return null;
  return (
    <div className="keyboard-tip" role="status">
      <span>{SNOOZE_KEYBOARD_TIP}</span>
      <button type="button" aria-label="Close" onClick={hideTip}>
        ×
      </button>
    </div>
  );
}
