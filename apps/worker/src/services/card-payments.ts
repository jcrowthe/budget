import { CREDIT_ACCOUNT_TYPES } from "@budget/core/account-types";
import type { Month } from "@budget/core/month";
import {
  type CardPaymentRequest,
  type CardPaymentResult,
  NOTHING_TO_PAY_TEXT,
  PAYMENT_SOURCE_TEXT,
  paymentCategoryOf,
} from "@budget/schema/card-payments";
import type { z } from "zod";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import { getPlanMonth } from "./months";
import { todayUtc } from "./targets";
import { CLOSED_NO_NEW, CLOSED_OTHER, createTransfer, TransactionRefused } from "./transactions";

const isCredit = (type: string) => (CREDIT_ACCOUNT_TYPES as readonly string[]).includes(type);
const refuse = (code: string, detail: string) => new TransactionRefused(422, code, detail);

/**
 * Pays a credit card or line of credit from an on-plan cash account: the transfer pair (cash -amount, card
 * +amount), which the credit engine counts against the card's payment category. D1 calls: the plan and one
 * accounts list, then `createTransfer`'s; without `amount` also one plan month read.
 */
export async function payCreditCard(
  env: Env,
  actor: string,
  budgetId: string,
  cardId: string,
  input: z.input<typeof CardPaymentRequest>,
): Promise<CardPaymentResult> {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const all = new Map(
    (await accountsRepo.list(db, budgetId, { includeClosed: true })).map((a) => [a.id, a]),
  );
  const card = all.get(cardId);
  if (!card) throw new NotFound("Account");
  if (!isCredit(card.type)) {
    throw refuse("not_a_credit_account", `${card.name} is not a credit card or line of credit`);
  }
  if (card.closed) throw refuse("account_closed", CLOSED_OTHER);
  const from = all.get(input.from_account_id);
  if (!from || from.id === card.id || !from.onBudget || isCredit(from.type)) {
    throw refuse("invalid_payment_source", PAYMENT_SOURCE_TEXT);
  }
  if (from.closed) throw refuse("account_closed", CLOSED_NO_NEW);
  const date = input.date ?? todayUtc();
  let amount = input.amount;
  if (amount === undefined) {
    const m = await getPlanMonth(env, budgetId, `${date.slice(0, 7)}-01` as Month, date);
    const available = paymentCategoryOf(m, card.id)?.available ?? 0;
    if (available <= 0) throw refuse("nothing_to_pay", NOTHING_TO_PAY_TEXT(card.name));
    amount = available;
  }
  const r = await createTransfer(env, actor, budgetId, {
    from_account_id: from.id,
    to_account_id: card.id,
    amount,
    date,
    memo: input.memo ?? undefined,
  });
  return { amount, from_transaction: r.from_transaction, to_transaction: r.to_transaction };
}
