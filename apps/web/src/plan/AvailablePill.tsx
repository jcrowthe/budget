import type { Ref } from "react";
import { money, pillTitle } from "./format";

/** A positive pill opens Move and a negative one Cover (`onOpen`); zero pills are disabled. */
export function AvailablePill({
  amount,
  interactive = true,
  onOpen,
  ref,
}: {
  amount: number;
  interactive?: boolean;
  onOpen?: (anchor: HTMLButtonElement) => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const kind = amount === 0 ? "zero" : amount > 0 ? "positive" : "negative";
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
