import { isLoanType } from "@budget/core/account-types";
import {
  LOAN_INTEREST_SYSTEM,
  type LoanMonthIn,
  type LoanTerms,
  loanAt,
  runLoan,
} from "@budget/core/loan-engine";
import { NOT_A_LOAN_TEXT } from "@budget/schema/loan-activity";
import {
  FUTURE_MONTH_TEXT,
  type LoanAddActivityRequest as LoanAddActivityInput,
  LoanAddActivityRequest,
  type LoanAddActivityResult,
} from "@budget/schema/loan-add-activity";
import { LOAN_INTEREST_PAYEE } from "@budget/schema/loan-balance-update";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as loanRepo from "../repositories/loan-activity";
import * as balanceRepo from "../repositories/loan-balance-update";
import * as payeesRepo from "../repositories/payees";
import * as txRepo from "../repositories/transactions";
import { type BatchItem, systemPayee } from "./accounts";
import { frozenLoanRow, frozenRowDate, monthOf, utcToday } from "./loan-frozen-rows";
import { TransactionRefused, transactionToApi } from "./transactions";

/**
 * Adds activity to a loan: recorded interest (a stored, cleared `loan_interest` row, which the engine reads as an
 * edited line and Update Balance freezes), a fee (-amount) or a credit (+amount). D1 calls: the plan, the account,
 * one read batch and one write batch, whatever the history. docs/loan-add-activity-design.md.
 */
export async function addLoanActivity(
  env: Env,
  actor: string,
  budgetId: string,
  loanId: string,
  input: LoanAddActivityInput,
): Promise<LoanAddActivityResult> {
  const v = LoanAddActivityRequest.parse(input);
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const before = await accountsRepo.findActive(db, budgetId, loanId);
  if (!before) throw new NotFound("Account");
  if (!isLoanType(before.type)) {
    throw new TransactionRefused(422, "not_a_loan_account", NOT_A_LOAN_TEXT(before.name));
  }
  if (before.closed) {
    throw new TransactionRefused(422, "account_closed", "A closed account cannot take activity");
  }
  const today = v.today ?? utcToday();
  const month = v.month ?? monthOf(today);
  if (v.kind === "interest" && month > monthOf(today)) {
    throw new TransactionRefused(422, "future_month", FUTURE_MONTH_TEXT);
  }

  const [grouped, systemRows] = await db.batch([
    loanRepo.balanceGroupsQuery(db, budgetId, { accountId: loanId }),
    balanceRepo.systemPayeesQuery(db, budgetId),
  ]);
  const loanRows = grouped.flatMap((r) =>
    r.ym !== null && r.kind !== null && r.type !== null
      ? [{ ...r, ym: r.ym, kind: r.kind, type: r.type }]
      : [],
  );
  const months = loanRepo.loanMonthsFromRows(loanRows).get(loanId)?.months ?? [];
  const terms: LoanTerms = {
    type: before.type,
    interest_rate: before.interestRate,
    escrow_amount: before.escrowAmount,
  };
  const stored = grouped.reduce((n, r) => n + r.amount, 0);
  const run = runLoan(terms, months);
  const now = new Date().toISOString();

  const interest = v.kind === "interest";
  let tx: txRepo.TransactionRow;
  let payeeStmts: BatchItem[] = [];
  let delta: number;
  if (interest) {
    // D1: an estimated line is replaced by the stored rows' sum, so the estimate goes into the row.
    const line = loanAt(run, month).interest;
    const amount = line && line.state === "estimated" ? line.amount - v.amount : -v.amount;
    const made = systemPayee(
      db,
      actor,
      budgetId,
      systemRows.find((p) => p.system === LOAN_INTEREST_SYSTEM),
      LOAN_INTEREST_SYSTEM,
      LOAN_INTEREST_PAYEE,
      now,
    );
    payeeStmts = made.stmts;
    tx = frozenLoanRow({
      budgetId,
      accountId: loanId,
      payeeId: made.sys.id,
      system: LOAN_INTEREST_SYSTEM,
      date: frozenRowDate(month, today),
      amount,
      cleared: "cleared",
      now,
    });
    delta = amount;
  } else {
    const amount = v.kind === "fee" ? -v.amount : v.amount;
    tx = {
      id: crypto.randomUUID(),
      budgetId,
      accountId: loanId,
      date: v.date ?? today,
      payeeId: null,
      payeeName: null,
      categoryId: null,
      inflowToReadyToAssign: false,
      memo: v.memo ?? null,
      amount,
      cleared: "uncleared",
      approved: true,
      createdAt: now,
      deletedAt: null,
      updatedAt: now,
    };
    delta = amount;
  }

  const results = await db.batch([
    ...payeeStmts,
    txRepo.insertIfStmt(
      db,
      tx,
      accountsRepo.accountHolds(db, before, accountsRepo.accountSumIs(loanId, stored)),
      interest ? payeesRepo.systemIdSql(budgetId, LOAN_INTEREST_SYSTEM) : undefined,
    ),
    changeLogInsertIf(
      db,
      {
        budgetId,
        actor,
        action: "create",
        entityType: "transaction",
        entityId: tx.id,
        before: null,
        after: transactionToApi(tx),
      },
      accountsRepo.transactionExistsStmt(db, tx.id),
    ),
  ] as unknown as [BatchItem, ...BatchItem[]]);
  if ((results[payeeStmts.length]?.meta.changes ?? 0) === 0) {
    const now2 = (await txRepo.balancesByAccount(db, budgetId, loanId)).get(loanId);
    throw new TransactionRefused(
      409,
      "balance_changed",
      `The balance changed: it is now ${(now2?.cleared ?? 0) + (now2?.uncleared ?? 0)} milliunits. Review it and try again`,
    );
  }

  return {
    kind: v.kind,
    transaction: transactionToApi(tx),
    balance:
      runLoan(terms, withRow(months, monthOf(tx.date), interest, delta)).at(-1)?.closing ?? 0,
  };
}

/** `months` with the written row counted in its month (a new month when missing). */
function withRow(
  months: readonly LoanMonthIn[],
  month: string,
  interest: boolean,
  amount: number,
): LoanMonthIn[] {
  const base: LoanMonthIn[] = months.some((m) => m.month === month)
    ? [...months]
    : [
        ...months,
        { month, payments: 0, starting: 0, other: 0, interest_rows: null, escrow_rows: null },
      ];
  return base.map((m) => {
    if (m.month !== month) return m;
    if (!interest) return { ...m, other: m.other + amount };
    return {
      ...m,
      interest_rows: { amount: (m.interest_rows?.amount ?? 0) + amount, reconciled: false },
    };
  });
}
