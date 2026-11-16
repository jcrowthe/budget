import { z } from "@hono/zod-openapi";
import { formatAmountEntry } from "./amount-entry";
import { IsoDate } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import type { MonthDetail } from "./months";
import { REGISTER_CREDIT_TYPES } from "./register";
import { TransactionDetail } from "./transactions";

export const CREDIT_TYPES: readonly string[] = REGISTER_CREDIT_TYPES;
export const CARD_PAYMENTS_GROUP = "Credit Card Payments";
export const isCredit = (type: string): boolean => CREDIT_TYPES.includes(type);

type Acct = { type: string; on_budget: boolean; name: string };

/** D3: null unless both accounts are on-plan and exactly one of them is a credit account. */
export function paymentDisplay(
  side: Acct,
  other: Acct | null,
): null | { payee: string; category: string; cardIsSide: boolean } {
  if (!other || !side.on_budget || !other.on_budget) return null;
  const sideCredit = isCredit(side.type);
  if (sideCredit === isCredit(other.type)) return null;
  const card = sideCredit ? side : other;
  return {
    payee: `Payment: ${other.name}`,
    category: `${CARD_PAYMENTS_GROUP}: ${card.name}`,
    cardIsSide: sideCredit,
  };
}

/** D4: "Payment from <other>" when the current account is a card and the other is an on-plan cash account. */
export function transferEntryLabel(current: Acct | null, other: Acct): string {
  return current && isCredit(current.type) && other.on_budget && !isCredit(other.type)
    ? `Payment from ${other.name}`
    : `To/From ${other.name}`;
}

/** D1/D2: the payment category of a card in a month read, or null. */
export function paymentCategoryOf(
  month: Pick<MonthDetail, "groups">,
  accountId: string,
): null | { id: string; name: string; available: number } {
  for (const g of month.groups) {
    for (const c of g.categories) {
      if (c.kind === "credit_card_payment" && c.account_id === accountId) {
        return { id: c.id, name: c.name, available: c.available };
      }
    }
  }
  return null;
}

export type PaymentTone = "zero" | "positive" | "negative";
export const paymentTone = (available: number): PaymentTone =>
  available === 0 ? "zero" : available > 0 ? "positive" : "negative";

/** D2: the Inflow text for Record Payment: the Available when it is above 0, else nothing. */
export const paymentPrefill = (available: number | null | undefined): string =>
  available != null && available > 0 ? formatAmountEntry(available) : "";

export const CardPaymentRequest = z
  .object({
    from_account_id: z.string().min(1),
    amount: Milliunits.positive().optional(),
    date: IsoDate.optional(),
    memo: z.string().max(500).nullable().optional(),
  })
  .openapi("CardPaymentRequest");

export const CardPaymentResult = z
  .object({
    amount: Milliunits,
    from_transaction: TransactionDetail,
    to_transaction: TransactionDetail,
  })
  .openapi("CardPaymentResult");
export type CardPaymentResult = z.infer<typeof CardPaymentResult>;

export const CardPaymentResponse = dataEnvelope(CardPaymentResult);

export const OWN_PAYMENT_TEXT = (card: string) =>
  `A transaction on ${card} can't use its own payment category. Choose a spending category, or use Record Payment to pay ${card} from a cash account.`;
export const PAYMENT_SOURCE_TEXT =
  "Pay a card from an on-plan cash account (checking, savings or cash)";
export const NOTHING_TO_PAY_TEXT = (card: string) =>
  `${card}'s payment category has nothing available to pay; send an amount`;
