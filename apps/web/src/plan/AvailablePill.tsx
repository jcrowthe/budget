import type { Ref } from "react";
import { money, pillTitle } from "./format";

/** A positive pill opens Move and a negative one Cover (`onOpen`); zero pills are disabled. */
export function AvailablePill({
  amount,
  interactive = true,
  display = false,
  onOpen,
  ref,
}: {
  amount: number;
  interactive?: boolean;
  /** A plain span with the pill's look and title, for the inspector. */
  display?: boolean;
  onOpen?: (anchor: HTMLButtonElement) => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const kind = amount === 0 ? "zero" : amount > 0 ? "positive" : "negative";
  if (display) {
    return (
      <span className={`available-pill ${kind}`} title={pillTitle(amount) || undefined}>
        {money(amount)}
      </span>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      className={`available-pill ${kind}`}
      disabled={amount === 0 || !interactive}
      onClick={(e) => onOpen?.(e.currentTarget)}
      title={interactive ? pillTitle(amount) || undefined : undefined}
    >
      {money(amount)}
    </button>
  );
}
