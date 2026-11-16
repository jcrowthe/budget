import { formatMoney } from "@budget/core/money";
import { paymentTone } from "@budget/schema/card-payments";
import { InfoIcon } from "./icons";
import { Tooltip } from "./Tooltip";
import { usePaymentAvailable } from "./usePaymentAvailable";

/** A credit account's Payment pill: its payment category's Available this month, over "Payment" (D1). */
export function PaymentBalance({
  budgetId,
  accountId,
  cardName,
}: {
  budgetId: string;
  accountId: string;
  cardName: string;
}) {
  const { available } = usePaymentAvailable(budgetId, accountId, true);
  return (
    <div className="acct-balance acct-payment" data-balance="payment">
      <span
        className={`acct-payment-pill${typeof available === "number" ? ` is-${paymentTone(available)}` : ""}`}
        data-tone={typeof available === "number" ? paymentTone(available) : undefined}
      >
        {typeof available === "number" ? formatMoney(available) : ""}
      </span>
      <Tooltip content={`Available in Credit Card Payments: ${cardName} this month`}>
        {(tip) => (
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable to show its tooltip, like the balances
          <span className="acct-label" tabIndex={0} {...tip}>
            <InfoIcon width={12} height={12} />
            Payment
          </span>
        )}
      </Tooltip>
    </div>
  );
}
