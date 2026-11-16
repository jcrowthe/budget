import { evaluateAmountEntry, formatAmountEntry } from "@budget/schema/amount-entry";
import { useState } from "react";
import { CalculatorIcon } from "./icons";

/** Outflow or Inflow: arithmetic on blur, two decimals; a calculator icon while focused. */
export function AmountField({
  label,
  value,
  onChange,
}: {
  label: "Outflow" | "Inflow";
  value: string;
  onChange: (text: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className={`entry-input entry-amount${focused ? " is-focused" : ""}`}>
      <CalculatorIcon className="entry-calculator" width={16} height={16} />
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        placeholder={label.toLowerCase()}
        autoComplete="off"
        value={value}
        onFocus={() => setFocused(true)}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          setFocused(false);
          const v = evaluateAmountEntry(value);
          onChange(v === null ? "" : formatAmountEntry(v));
        }}
      />
    </div>
  );
}
