import { LOAN_ACCOUNT_TYPES } from "@budget/core/account-types";
import {
  LOAN_ESCROW_SYSTEM,
  LOAN_INTEREST_SYSTEM,
  type LoanMonthIn,
  type LoanTerms,
} from "@budget/core/loan-engine";
import { addMonths, type Month } from "@budget/core/month";
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Db } from "../db/client";
import { accounts } from "../db/schema/accounts";
import { payees } from "../db/schema/payees";
import { transactions } from "../db/schema/transactions";

/** One bound parameter for every loan type: `instr(?, ',' || type || ',') > 0` is an IN list without a list. */
export const LOAN_TYPES_BOUND = `,${LOAN_ACCOUNT_TYPES.join(",")},`;
const isLoan = sql`instr(${LOAN_TYPES_BOUND}, ',' || ${accounts.type} || ',') > 0`;

/** A row that counts in a balance (as `countsInBalance`, kept here so the two repositories do not import each other). */
const counts = and(isNull(transactions.deletedAt), isNull(transactions.parentTransactionId));

const other = alias(accounts, "lo_other");
const payee = alias(payees, "lo_payee");

const kindOf = sql<string>`case
  when coalesce(${payee.system}, '') = 'starting_balance' then 'starting'
  when ${payee.system} = ${LOAN_INTEREST_SYSTEM} then 'interest'
  when ${payee.system} = ${LOAN_ESCROW_SYSTEM} then 'escrow'
  when ${transactions.amount} > 0 and coalesce(${other.onBudget}, 0) = 1 then 'payment'
  else 'other' end`;

export type LoanMonthRow = {
  accountId: string;
  ym: string;
  kind: string;
  amount: number;
  allReconciled: number;
  type: string;
  rate: string | null;
  escrow: number | null;
};

/**
 * The loan's rows grouped by account, month and kind (payment, starting, interest, escrow, other): the engine's
 * whole input. Unexecuted; a number of rows that grows with months, never with payments.
 */
export function loanMonthsQuery(
  db: Db,
  budgetId: string,
  accountId?: string,
  opts: { open?: boolean } = {},
) {
  const ym = sql<string>`substr(${transactions.date}, 1, 7)`;
  return db
    .select({
      accountId: transactions.accountId,
      ym,
      kind: kindOf.as("kind"),
      amount: sql<number>`sum(${transactions.amount})`,
      allReconciled: sql<number>`min(${transactions.cleared} = 'reconciled')`,
      type: accounts.type,
      rate: accounts.interestRate,
      escrow: accounts.escrowAmount,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(payee, eq(payee.id, transactions.payeeId))
    .leftJoin(other, eq(other.id, transactions.transferAccountId))
    .where(
      and(
        eq(transactions.budgetId, budgetId),
        counts,
        isNull(accounts.deletedAt),
        isLoan,
        accountId ? eq(transactions.accountId, accountId) : undefined,
        opts.open ? eq(accounts.closed, false) : undefined,
      ),
    )
    .groupBy(transactions.accountId, ym, kindOf);
}

export function loanMonthsFromRows(
  rows: readonly LoanMonthRow[],
): Map<string, { terms: LoanTerms; months: LoanMonthIn[] }> {
  const out = new Map<string, { terms: LoanTerms; months: Map<string, LoanMonthIn> }>();
  for (const r of rows) {
    let loan = out.get(r.accountId);
    if (!loan) {
      loan = {
        terms: {
          type: r.type as LoanTerms["type"],
          interest_rate: r.rate,
          escrow_amount: r.escrow,
        },
        months: new Map(),
      };
      out.set(r.accountId, loan);
    }
    const month = `${r.ym}-01`;
    let m = loan.months.get(month);
    if (!m) {
      m = {
        month,
        payments: 0,
        starting: 0,
        other: 0,
        interest_rows: null,
        escrow_rows: null,
      };
      loan.months.set(month, m);
    }
    const frozen = { amount: r.amount, reconciled: r.allReconciled === 1 };
    if (r.kind === "payment") m.payments += r.amount;
    else if (r.kind === "starting") m.starting += r.amount;
    else if (r.kind === "interest") m.interest_rows = frozen;
    else if (r.kind === "escrow") m.escrow_rows = frozen;
    else m.other += r.amount;
  }
  return new Map(
    [...out].map(([id, l]) => [id, { terms: l.terms, months: [...l.months.values()] }]),
  );
}

/** The month's rows except the frozen interest and escrow rows, with the other side of a transfer. */
export function monthRowsQuery(db: Db, budgetId: string, loanId: string, month: Month) {
  return db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      memo: transactions.memo,
      cleared: transactions.cleared,
      createdAt: transactions.createdAt,
      transferAccountId: transactions.transferAccountId,
      otherName: other.name,
      otherOnBudget: other.onBudget,
      payeeSystem: payee.system,
      payeeName: payee.name,
      rowPayeeName: transactions.payeeName,
    })
    .from(transactions)
    .leftJoin(payee, eq(payee.id, transactions.payeeId))
    .leftJoin(other, eq(other.id, transactions.transferAccountId))
    .where(
      and(
        eq(transactions.budgetId, budgetId),
        eq(transactions.accountId, loanId),
        counts,
        gte(transactions.date, month),
        lt(transactions.date, addMonths(month, 1)),
        sql`coalesce(${payee.system}, '') <> ${LOAN_INTEREST_SYSTEM} and coalesce(${payee.system}, '') <> ${LOAN_ESCROW_SYSTEM}`,
      ),
    )
    .orderBy(asc(transactions.date), asc(transactions.createdAt));
}

/** The source of the loan's latest payment, when it is still an open, live, on-plan cash account. */
export function lastPaymentSourceQuery(db: Db, budgetId: string, loanId: string) {
  return db
    .select({ id: other.id })
    .from(transactions)
    .innerJoin(other, eq(other.id, transactions.transferAccountId))
    .where(
      and(
        eq(transactions.budgetId, budgetId),
        eq(transactions.accountId, loanId),
        counts,
        sql`${transactions.amount} > 0`,
        eq(other.onBudget, true),
        eq(other.closed, false),
        isNull(other.deletedAt),
        sql`${other.type} in ('checking', 'savings', 'cash')`,
      ),
    )
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(1);
}

export type BalanceGroupRow = {
  accountId: string;
  ym: string | null;
  kind: string | null;
  amount: number;
  cleared: number;
  uncleared: number;
  allReconciled: number;
  type: string | null;
  rate: string | null;
  escrow: number | null;
};

/**
 * One statement for the balance readers: the cleared and uncleared sums per account, and for a loan account per
 * month and kind (the engine's input). A non-loan account is one group (`ym` and `kind` null), so the number of
 * rows grows with accounts and loan months, never with transactions. `open` keeps open, non-deleted accounts.
 */
export function balanceGroupsQuery(
  db: Db,
  budgetId: string,
  opts: { accountId?: string; open?: boolean } = {},
) {
  const loan = sql`(${accounts.id} is not null and ${isLoan})`;
  const ym = sql<string | null>`case when ${loan} then substr(${transactions.date}, 1, 7) end`;
  const kind = sql<string | null>`case when ${loan} then ${kindOf} end`;
  return db
    .select({
      accountId: transactions.accountId,
      ym: ym.as("ym"),
      kind: kind.as("kind"),
      amount: sql<number>`sum(${transactions.amount})`,
      cleared: sql<number>`coalesce(sum(case when ${transactions.cleared} = 'uncleared' then 0 else ${transactions.amount} end), 0)`,
      uncleared: sql<number>`coalesce(sum(case when ${transactions.cleared} = 'uncleared' then ${transactions.amount} else 0 end), 0)`,
      allReconciled: sql<number>`min(${transactions.cleared} = 'reconciled')`,
      type: accounts.type,
      rate: accounts.interestRate,
      escrow: accounts.escrowAmount,
    })
    .from(transactions)
    .leftJoin(accounts, and(eq(accounts.id, transactions.accountId), isNull(accounts.deletedAt)))
    .leftJoin(payee, eq(payee.id, transactions.payeeId))
    .leftJoin(other, eq(other.id, transactions.transferAccountId))
    .where(
      and(
        eq(transactions.budgetId, budgetId),
        counts,
        opts.accountId ? eq(transactions.accountId, opts.accountId) : undefined,
        opts.open ? sql`${accounts.id} is not null and ${accounts.closed} = 0` : undefined,
      ),
    )
    .groupBy(transactions.accountId, ym, kind);
}

/** Per account: cleared, uncleared (as stored) and the loan's computed charges (`estimated`, <= 0). */
export function balancesFromGroups(
  rows: readonly BalanceGroupRow[],
  estimatedOf: (terms: LoanTerms, months: LoanMonthIn[]) => number,
): Map<string, { cleared: number; uncleared: number; estimated: number }> {
  const sums = new Map<string, { cleared: number; uncleared: number; estimated: number }>();
  for (const r of rows) {
    const s = sums.get(r.accountId) ?? { cleared: 0, uncleared: 0, estimated: 0 };
    s.cleared += r.cleared;
    s.uncleared += r.uncleared;
    sums.set(r.accountId, s);
  }
  const loans = loanMonthsFromRows(
    rows.flatMap((r) =>
      r.ym !== null && r.kind !== null && r.type !== null
        ? [{ ...r, ym: r.ym, kind: r.kind, type: r.type }]
        : [],
    ),
  );
  for (const [id, l] of loans) {
    const s = sums.get(id);
    if (s) s.estimated = estimatedOf(l.terms, l.months);
  }
  return sums;
}
