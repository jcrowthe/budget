import { paymentTone } from "@budget/schema/card-payments";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { ExclamationCircleIcon, QuestionRingIcon } from "./icons";
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
  const fmt = usePlanFormatter();
  const { available } = usePaymentAvailable(budgetId, accountId, true);
  const tone = typeof available === "number" ? paymentTone(available) : null;
  return (
    <div className="acct-balance acct-payment" data-balance="payment">
      <div className="acct-payment-row">
        <span
          className={`acct-payment-pill${tone ? ` is-${tone}` : ""}`}
          data-tone={tone ?? undefined}
        >
          {tone === "negative" ? <ExclamationCircleIcon /> : null}
          {typeof available === "number" ? fmt.money(available) : ""}
        </span>
      </div>
      <Tooltip content={`Available in Credit Card Payments: ${cardName} this month`}>
        {(tip) => (
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable to show its tooltip, like the balances
          <span className="acct-label" tabIndex={0} {...tip}>
            <QuestionRingIcon />
            Payment
          </span>
        )}
      </Tooltip>
    </div>
  );
}
