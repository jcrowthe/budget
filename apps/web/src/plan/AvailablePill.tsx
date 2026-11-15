import { money, pillTitle } from "./format";

/** No click action yet: the move and cover popovers come with their own tickets. */
export function AvailablePill({
  amount,
  interactive = true,
}: {
  amount: number;
  interactive?: boolean;
}) {
  const kind = amount === 0 ? "zero" : amount > 0 ? "positive" : "negative";
  return (
    <button
      type="button"
      className={`available-pill ${kind}`}
      disabled={amount === 0 || !interactive}
      title={interactive ? pillTitle(amount) || undefined : undefined}
    >
      {money(amount)}
    </button>
  );
}
