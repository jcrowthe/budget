import type { Ref } from "react";
import { money, pillTitle } from "./format";

/** No click action yet: the move and cover popovers come with their own tickets. */
export function AvailablePill({
  amount,
  interactive = true,
  ref,
}: {
  amount: number;
  interactive?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  const kind = amount === 0 ? "zero" : amount > 0 ? "positive" : "negative";
  return (
    <button
      ref={ref}
      type="button"
      className={`available-pill ${kind}`}
      disabled={amount === 0 || !interactive}
      title={interactive ? pillTitle(amount) || undefined : undefined}
    >
      {money(amount)}
    </button>
  );
}
