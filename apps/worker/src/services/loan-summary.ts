import { isLoanType } from "@budget/core/account-types";
import { isDebtTargetDef } from "@budget/core/debt-targets";
import { runLoan } from "@budget/core/loan-engine";
import { projectLoan } from "@budget/core/loan-projection";
import { currentMonth, type Month } from "@budget/core/month";
import { NOT_A_LOAN_TEXT } from "@budget/schema/loan-activity";
import type { LoanSummary } from "@budget/schema/loan-summary";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as loanRepo from "../repositories/loan-activity";
import { getPlanMonth } from "./months";
import { TransactionRefused } from "./transactions";

const mag = (closing: number) => Math.max(0, -closing);

/** remaining / original x 100, rounded half up to one decimal in integer arithmetic. */
function percentOf(remaining: number, original: number): number {
  const tenths = Math.floor((remaining * 2000 + original) / (original * 2));
  return tenths / 10;
}

/**
 * A loan's summary: balance, terms, the payoff projection and the paired category's figures. D1 calls: the plan,
 * the account, one batch (the loan's grouped rows), and for a paired loan the plan month read: the same for any
 * number of months or payments.
 */
export async function getLoanSummary(
  env: Env,
  budgetId: string,
  loanId: string,
  month?: Month,
): Promise<LoanSummary> {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const loan = await accountsRepo.findActive(db, budgetId, loanId);
  if (!loan) throw new NotFound("Account");
  if (!isLoanType(loan.type)) {
    throw new TransactionRefused(422, "not_a_loan_account", NOT_A_LOAN_TEXT(loan.name));
  }
  const m = month ?? currentMonth();
  const [grouped] = await db.batch([loanRepo.loanMonthsQuery(db, budgetId, loanId)]);
  const found = loanRepo.loanMonthsFromRows(grouped).get(loanId);
  const terms = found?.terms ?? {
    type: loan.type,
    interest_rate: loan.interestRate,
    escrow_amount: loan.escrowAmount,
  };
  const months = found?.months ?? [];
  const results = runLoan(terms, months);
  const remaining = mag(results.at(-1)?.closing ?? 0);
  const startingSum = months.reduce((n, x) => n + x.starting, 0);
  const original = startingSum < 0 ? -startingSum : null;
  const firstStarting = [...months]
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .find((x) => x.starting !== 0);

  let paired: LoanSummary["paired_category"] = null;
  let targetPayment: number | null = null;
  if (loan.pairedCategoryId) {
    const detail = await getPlanMonth(env, budgetId, m);
    for (const g of detail.groups) {
      const c = g.categories.find((x) => x.id === loan.pairedCategoryId);
      if (!c) continue;
      const t = c.target;
      paired = {
        id: c.id,
        name: c.name,
        group_name: g.name,
        available: c.available,
        target: t
          ? {
              type: isDebtTargetDef(t.definition) ? "debt_payment" : null,
              amount: t.definition.amount,
              cadence: t.definition.cadence,
              behavior: t.definition.behavior,
              day_of_month: t.definition.day_of_month,
              due_date: t.period_due_date,
              needed_this_month: t.needed_this_month,
            }
          : null,
      };
      if (t && isDebtTargetDef(t.definition) && t.definition.repeat === null) {
        targetPayment = t.definition.amount;
      }
    }
  }

  const minimum = loan.minimumPayment;
  const paymentUsed = targetPayment ?? minimum;
  const source: LoanSummary["payment_source"] =
    targetPayment !== null ? "target" : minimum !== null ? "minimum" : null;
  const projection =
    paymentUsed === null
      ? null
      : projectLoan(terms, { balance: remaining, payment: paymentUsed, from: m });
  const originalProjection =
    original !== null && minimum !== null && firstStarting
      ? projectLoan(terms, { balance: original, payment: minimum, from: firstStarting.month })
      : null;

  return {
    remaining_balance: remaining,
    original_balance: original,
    percent_remaining: original === null ? null : percentOf(remaining, original),
    interest_rate: loan.interestRate,
    minimum_payment: minimum,
    escrow_amount: loan.type === "mortgage" ? (loan.escrowAmount ?? 0) : null,
    payment_used: paymentUsed,
    payment_source: source,
    payoff_month: projection?.payoff_month ?? null,
    payments_remaining: projection?.payments_remaining ?? null,
    interest_remaining: projection?.interest_total ?? 0,
    schedule: projection?.schedule ?? [],
    history: results
      .filter((r) => r.month <= m)
      .map((r) => ({ month: r.month, balance: mag(r.closing) })),
    original_schedule: originalProjection?.schedule ?? [],
    paired_category: paired,
    balance_updated_at: loan.lastReconciledAt,
  };
}
