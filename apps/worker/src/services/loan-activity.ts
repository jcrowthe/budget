import { isLoanType } from "@budget/core/account-types";
import { LOAN_ESCROW_SYSTEM, loanAt, runLoan } from "@budget/core/loan-engine";
import { currentMonth, type Month } from "@budget/core/month";
import { type LoanActivity, NOT_A_LOAN_TEXT } from "@budget/schema/loan-activity";
import { CREDIT_LABEL, FEE_LABEL } from "@budget/schema/loan-add-activity";
import { BALANCE_ADJUSTMENT_LABEL } from "@budget/schema/loan-balance-update";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as loanRepo from "../repositories/loan-activity";
import { TransactionRefused } from "./transactions";

export const INITIAL_BALANCE_LABEL = "Initial Balance";

/**
 * One month of a loan's Account Activity. D1 calls: the plan, the account, then one batch (the loan's grouped
 * rows, the month's rows, the last payment source, the edited interest and escrow lines' dates): the same for any number of months or payments.
 */
export async function getLoanActivity(
  env: Env,
  budgetId: string,
  loanId: string,
  month?: Month,
): Promise<LoanActivity> {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const loan = await accountsRepo.findActive(db, budgetId, loanId);
  if (!loan) throw new NotFound("Account");
  if (!isLoanType(loan.type)) {
    throw new TransactionRefused(422, "not_a_loan_account", NOT_A_LOAN_TEXT(loan.name));
  }
  const m = month ?? currentMonth();
  const [grouped, rows, last, edited, escrowEdited] = await db.batch([
    loanRepo.loanMonthsQuery(db, budgetId, loanId),
    loanRepo.monthRowsQuery(db, budgetId, loanId, m),
    loanRepo.lastPaymentSourceQuery(db, budgetId, loanId),
    loanRepo.editedOnQuery(db, budgetId, loanId, m),
    loanRepo.editedOnQuery(db, budgetId, loanId, m, LOAN_ESCROW_SYSTEM),
  ]);
  const found = loanRepo.loanMonthsFromRows(grouped).get(loanId);
  const result = loanAt(
    runLoan(
      found?.terms ?? {
        type: loan.type,
        interest_rate: loan.interestRate,
        escrow_amount: loan.escrowAmount,
      },
      found?.months ?? [],
    ),
    m,
  );
  const payments: LoanActivity["payments"] = [];
  const other: LoanActivity["other"] = [];
  for (const r of rows) {
    const isPayment =
      r.payeeSystem !== "starting_balance" && r.amount > 0 && r.otherOnBudget === true;
    if (isPayment) {
      payments.push({
        transaction_id: r.id,
        date: r.date,
        amount: r.amount,
        memo: r.memo,
        cleared: r.cleared,
        from_account_id: r.transferAccountId,
        from_account_name: r.otherName,
      });
    } else {
      other.push({
        transaction_id: r.id,
        date: r.date,
        amount: r.amount,
        label:
          r.payeeSystem === "starting_balance"
            ? INITIAL_BALANCE_LABEL
            : r.payeeSystem === "reconciliation_adjustment" || r.payeeSystem === "manual_adjustment"
              ? BALANCE_ADJUSTMENT_LABEL
              : (r.payeeName ??
                r.rowPayeeName ??
                r.otherName ??
                (r.amount < 0 ? FEE_LABEL : r.amount > 0 ? CREDIT_LABEL : "Transaction")),
        memo: r.memo,
        reconciled: r.cleared === "reconciled",
        editable:
          r.payeeId === null &&
          r.transferAccountId === null &&
          !r.isSplit &&
          r.cleared !== "reconciled",
      });
    }
  }
  return {
    month: m,
    ending_balance: result.closing,
    principal: result.principal,
    payments,
    interest: result.interest
      ? {
          ...result.interest,
          edited_on: result.interest.state === "edited" ? (edited[0]?.editedOn ?? null) : null,
          transaction_id: result.interest.state === "edited" ? (edited[0]?.latestId ?? null) : null,
          editable: result.interest.state === "edited",
        }
      : null,
    escrow: result.escrow
      ? {
          ...result.escrow,
          edited_on: result.escrow.state === "edited" ? (escrowEdited[0]?.editedOn ?? null) : null,
          transaction_id:
            result.escrow.state === "edited" ? (escrowEdited[0]?.latestId ?? null) : null,
          editable: result.escrow.state === "edited",
        }
      : null,
    other,
    last_payment_from_account_id: last[0]?.id ?? null,
  };
}
