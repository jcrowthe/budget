import { isLoanType } from "@budget/core/account-types";
import type { Month } from "@budget/core/month";
import type { CardPaymentRequest, CardPaymentResult } from "@budget/schema/card-payments";
import {
  AMOUNT_REQUIRED_TEXT,
  LOAN_PAYMENT_SOURCE_TEXT,
  NOT_A_LOAN_TEXT,
} from "@budget/schema/loan-activity";
import type { z } from "zod";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as categoriesRepo from "../repositories/categories";
import { payCreditCard } from "./card-payments";
import { getPlanMonth } from "./months";
import { todayUtc } from "./targets";
import { CLOSED_NO_NEW, CLOSED_OTHER, createTransfer, TransactionRefused } from "./transactions";

const refuse = (code: string, detail: string) => new TransactionRefused(422, code, detail);
const CASH_TYPES: readonly string[] = ["checking", "savings", "cash"];

/**
 * Records a payment to a loan: the transfer pair (cash -amount, loan +amount), the cash side categorized to the
 * loan's paired category when that category is live. The engine reads the interest, escrow and principal from
 * the rows, so nothing else is written. D1 calls: the plan, one accounts list, the paired category, without
 * `amount` one plan month read, then `createTransfer`'s.
 */
export async function recordLoanPayment(
  env: Env,
  actor: string,
  budgetId: string,
  loanId: string,
  input: z.input<typeof CardPaymentRequest>,
): Promise<CardPaymentResult> {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const all = new Map(
    (await accountsRepo.list(db, budgetId, { includeClosed: true })).map((a) => [a.id, a]),
  );
  const loan = all.get(loanId);
  if (!loan) throw new NotFound("Account");
  if (!isLoanType(loan.type)) throw refuse("not_a_loan_account", NOT_A_LOAN_TEXT(loan.name));
  if (loan.closed) throw refuse("account_closed", CLOSED_OTHER);
  const from = all.get(input.from_account_id);
  if (!from || from.id === loan.id || !from.onBudget || !CASH_TYPES.includes(from.type)) {
    throw refuse("invalid_payment_source", LOAN_PAYMENT_SOURCE_TEXT);
  }
  if (from.closed) throw refuse("account_closed", CLOSED_NO_NEW);
  const paired = loan.pairedCategoryId
    ? await categoriesRepo.findActive(db, budgetId, loan.pairedCategoryId)
    : undefined;
  const date = input.date ?? todayUtc();
  let amount = input.amount;
  if (amount === undefined) {
    let available = 0;
    if (paired) {
      const m = await getPlanMonth(env, budgetId, `${date.slice(0, 7)}-01` as Month, date);
      available =
        m.groups.flatMap((g) => g.categories).find((c) => c.id === paired.id)?.available ?? 0;
    }
    if (available <= 0) throw refuse("amount_required", AMOUNT_REQUIRED_TEXT(loan.name));
    amount = available;
  }
  const r = await createTransfer(env, actor, budgetId, {
    from_account_id: from.id,
    to_account_id: loan.id,
    amount,
    date,
    memo: input.memo ?? undefined,
    category_id: paired?.id ?? null,
  });
  return { amount, from_transaction: r.from_transaction, to_transaction: r.to_transaction };
}

/** POST …/payments: a loan goes to `recordLoanPayment`, anything else to `payCreditCard` (unchanged). */
export async function payAccount(
  env: Env,
  actor: string,
  budgetId: string,
  accountId: string,
  input: z.input<typeof CardPaymentRequest>,
): Promise<CardPaymentResult> {
  const db = getDb(env);
  const account = await accountsRepo.findActive(db, budgetId, accountId);
  if (account && isLoanType(account.type)) {
    return recordLoanPayment(env, actor, budgetId, accountId, input);
  }
  return payCreditCard(env, actor, budgetId, accountId, input);
}
