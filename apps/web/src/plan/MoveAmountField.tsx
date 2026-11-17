import { evaluateAssigned, formatAssignedInput } from "@budget/schema/assigned-edit";
import { useEffect, useRef, useState } from "react";
import { usePlanFormatter } from "../shell/plan-formats-context";

/**
 * The amount field of the Assign and Move popovers: it takes the same maths as the Assigned cell
 * (`evaluateAssigned`, relative to `base`), starts selected, and reformats on blur.
 * `onAmount` reports the evaluated milliunits on every edit.
 */
export function MoveAmountField({
  base,
  onAmount,
  onEnter,
}: {
  base: number;
  onAmount: (amount: number) => void;
  onEnter: () => void;
}) {
  const fmt = usePlanFormatter();
  const [text, setText] = useState(() => formatAssignedInput(base, fmt));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="move-amount"
      type="text"
      inputMode="decimal"
      aria-label="Amount"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onAmount(evaluateAssigned(fmt.typedAmount(e.target.value), base, fmt.digits));
      }}
      onBlur={() =>
        setText(formatAssignedInput(evaluateAssigned(fmt.typedAmount(text), base, fmt.digits), fmt))
      }
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}
