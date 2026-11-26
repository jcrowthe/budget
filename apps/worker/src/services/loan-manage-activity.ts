import { isLoanType } from "@budget/core/account-types";
import {
  LOAN_ESCROW_SYSTEM,
  LOAN_INTEREST_SYSTEM,
  type LoanTerms,
  runLoan,
} from "@budget/core/loan-engine";
import { NOT_A_LOAN_TEXT, RECONCILED_LINE_TEXT } from "@budget/schema/loan-activity";
import {
  ESCROW_BELOW_RECONCILED_TEXT,
  INTEREST_BELOW_RECONCILED_TEXT,
  type LoanActivityChangeResult,
  type LoanActivityPatchRequest as LoanActivityPatchInput,
  LoanActivityPatchRequest,
  NOT_EDITABLE_ACTIVITY_TEXT,
  PAYMENT_OTHER_CLOSED_TEXT,
  PAYMENT_RECONCILED_TEXT,
  TODAY_NOT_FOR_PAYMENT_TEXT,
} from "@budget/schema/loan-manage";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as loanRepo from "../repositories/loan-activity";
import * as balanceRepo from "../repositories/loan-balance-update";
import * as manageRepo from "../repositories/loan-manage";
import * as payeesRepo from "../repositories/payees";
import * as txRepo from "../repositories/transactions";
import type { BatchItem } from "./accounts";
import { changeMonth, frozenLoanRow, frozenRowDate, monthOf, utcToday } from "./loan-frozen-rows";
import { planWrites, prepare, TransactionRefused, transactionToApi } from "./transactions";

type Row = txRepo.TransactionRow;
const refuse = (code: string, detail: string) => new TransactionRefused(422, code, detail);
const money = (milliunits: number) => (Math.abs(milliunits) / 1000).toFixed(2);

/** Everything both verbs read: the loan, its rows, and the line or row addressed. */
async function read(env: Env, budgetId: string, loanId: string, txId: string) {
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const before = await accountsRepo.findActive(db, budgetId, loanId);
  if (!before) throw new NotFound("Account");
  if (!isLoanType(before.type)) {
    throw refuse("not_a_loan_account", NOT_A_LOAN_TEXT(before.name));
  }
  if (before.closed) throw refuse("account_closed", "A closed account cannot take activity");
  const [found, frozenRows, grouped, sideRows, otherAccounts] = await db.batch([
    manageRepo.activityRowQuery(db, budgetId, loanId, txId),
    manageRepo.monthFrozenRowsQuery(db, budgetId, loanId, txId),
    loanRepo.balanceGroupsQuery(db, budgetId, { accountId: loanId }),
    manageRepo.paymentSidesQuery(db, budgetId, loanId, txId),
    manageRepo.paymentOtherAccountQuery(db, budgetId, loanId, txId),
  ]);
  const row = found[0];
  if (!row) throw new NotFound("Activity row");
  const loanRows = grouped.flatMap((r) =>
    r.ym !== null && r.kind !== null && r.type !== null
      ? [{ ...r, ym: r.ym, kind: r.kind, type: r.type }]
      : [],
  );
  const terms: LoanTerms = {
    type: before.type,
    interest_rate: before.interestRate,
    escrow_amount: before.escrowAmount,
  };
  return {
    db,
    before,
    row,
    frozenRows: frozenRows.map((r) => r.tx),
    sides: new Map(sideRows.map((r) => [r.t.id, manageRepo.toDetailRow(r)])),
    otherAccount: otherAccounts[0]?.account,
    months: loanRepo.loanMonthsFromRows(loanRows).get(loanId)?.months ?? [],
    terms,
    stored: grouped.reduce((n, r) => n + r.amount, 0),
  };
}
type Read = Awaited<ReturnType<typeof read>>;

const reconciled = () => new TransactionRefused(409, "reconciled_line", RECONCILED_LINE_TEXT);

type FrozenSystem = typeof LOAN_INTEREST_SYSTEM | typeof LOAN_ESCROW_SYSTEM;

/** What the addressed row is: an interest or escrow line (its rows), or a fee or credit; refuses anything else. */
function classify(r: Read):
  | {
      type: "line";
      system: FrozenSystem;
      month: ReturnType<typeof monthOf>;
      open: Row[];
      sum: number;
      any: boolean;
    }
  | { type: "other"; kind: "fee" | "credit"; tx: Row }
  | {
      type: "payment";
      loanRow: txRepo.TransactionDetailRow;
      cash: txRepo.TransactionDetailRow;
      other: accountsRepo.AccountRow;
    } {
  const { tx, system, isSplit } = r.row;
  if (system === LOAN_INTEREST_SYSTEM || system === LOAN_ESCROW_SYSTEM) {
    const open = r.frozenRows.filter((t) => t.cleared !== "reconciled");
    if (tx.cleared === "reconciled" || open.length === 0) throw reconciled();
    const rec = r.frozenRows.filter((t) => t.cleared === "reconciled");
    return {
      type: "line",
      system,
      month: monthOf(tx.date),
      open,
      sum: rec.reduce((n, t) => n + t.amount, 0),
      any: rec.length > 0,
    };
  }
  const other = r.otherAccount;
  if (tx.transferAccountId !== null && tx.amount > 0 && other?.onBudget && !isSplit) {
    const loanRow = r.sides.get(tx.id);
    const cash = tx.transferTransactionId ? r.sides.get(tx.transferTransactionId) : undefined;
    if (!loanRow || !cash) throw refuse("not_editable_activity", NOT_EDITABLE_ACTIVITY_TEXT);
    if (cash.cleared === "reconciled") {
      throw new TransactionRefused(409, "reconciled_line", PAYMENT_RECONCILED_TEXT(other.name));
    }
    if (loanRow.cleared === "reconciled") {
      throw new TransactionRefused(409, "reconciled_line", PAYMENT_RECONCILED_TEXT(r.before.name));
    }
    if (other.closed) throw refuse("account_closed", PAYMENT_OTHER_CLOSED_TEXT);
    return { type: "payment", loanRow, cash, other };
  }
  const reconciledKind = tx.cleared === "reconciled" && system === "reconciliation_adjustment";
  if (tx.payeeId === null && tx.transferAccountId === null && !isSplit) {
    if (tx.cleared === "reconciled") throw reconciled();
    return { type: "other", kind: tx.amount < 0 ? "fee" : "credit", tx };
  }
  if (reconciledKind) throw reconciled();
  throw refuse("not_editable_activity", NOT_EDITABLE_ACTIVITY_TEXT);
}

async function lostRace(r: Read, budgetId: string, loanId: string): Promise<never> {
  const now = (await txRepo.balancesByAccount(r.db, budgetId, loanId)).get(loanId);
  throw new TransactionRefused(
    409,
    "balance_changed",
    `The balance changed: it is now ${(now?.cleared ?? 0) + (now?.uncleared ?? 0)} milliunits. Review it and try again`,
  );
}

/** The loan's balance with `months` as the engine reads them. */
const closing = (r: Read, months: Read["months"]) => runLoan(r.terms, months).at(-1)?.closing ?? 0;

/**
 * Edits or deletes a payment through the register's own builders (`prepare`, `planWrites`): the loan row and its cash
 * side change in one batch, with a change_log row for each, so Undo restores both. `prepare` makes no call: the sides
 * and accounts were read in `read()`. D1 calls here: the one write batch.
 */
async function paymentWrite(
  r: Read,
  what: Extract<ReturnType<typeof classify>, { type: "payment" }>,
  kind: "update" | "delete",
  v: LoanActivityPatchInput | undefined,
  actor: string,
  budgetId: string,
  loanId: string,
): Promise<LoanActivityChangeResult> {
  const { db, before } = r;
  const { loanRow, cash, other } = what;
  const now = new Date().toISOString();
  const patch =
    kind === "update" && v
      ? Object.fromEntries(
          Object.entries({ amount: v.amount, date: v.date, memo: v.memo }).filter(
            ([, x]) => x !== undefined,
          ),
        )
      : undefined;
  const plan = await prepare(db, budgetId, loanRow, before, kind, patch, now, {
    singleUpdate: true,
    reads: {
      lines: new Map(),
      others: new Map([[cash.id, cash]]),
      accounts: new Map([
        [other.id, other],
        [before.id, before],
      ]),
      categories: cash.categoryId
        ? new Map([
            [
              cash.categoryId,
              {
                categoryName: cash.categoryName ?? "",
                groupName: cash.groupName ?? "",
                kind: null,
                accountId: null,
              },
            ],
          ])
        : new Map(),
    },
  });
  const loanHolds = accountsRepo.accountHolds(
    db,
    before,
    accountsRepo.accountSumIs(loanId, r.stored),
  );
  const guard = txRepo.allHold([loanHolds, txRepo.holdsAt(db, loanRow), txRepo.holdsAt(db, cash)]);
  const last = plan.others[plan.others.length - 1];
  const selfGuard = last
    ? txRepo.allHold([loanHolds, txRepo.holdsAt(db, loanRow), txRepo.writtenAt(db, cash.id, now)])
    : guard;
  const w = planWrites(db, { budgetId, actor, id: loanRow.id, kind, plan, now, guard, selfGuard });
  const results = await db.batch([...w.payees, ...w.logs, ...w.rest, w.self] as unknown as [
    BatchItem,
    ...BatchItem[],
  ]);
  if ((results[results.length - 1]?.meta.changes ?? 0) === 0) {
    await lostRace(r, budgetId, loanId);
  }
  const old = r.row.tx;
  const without = changeMonth(r.months, monthOf(old.date), (m) => ({
    ...m,
    payments: m.payments - old.amount,
  }));
  if (kind === "delete") {
    return {
      kind: "payment",
      transaction: null,
      from_transaction: null,
      balance: closing(r, without),
    };
  }
  const after = plan.after;
  const written = plan.others[0]?.row ?? cash;
  return {
    kind: "payment",
    transaction: transactionToApi({ ...after, updatedAt: now }),
    from_transaction: transactionToApi(plan.others[0] ? { ...written, updatedAt: now } : written),
    balance: closing(
      r,
      changeMonth(without, monthOf(after.date), (m) => ({
        ...m,
        payments: m.payments + after.amount,
      })),
    ),
  };
}

const imgs = (rows: Row[]) =>
  JSON.stringify(rows.map((t) => ({ id: t.id, img: transactionToApi(t) })));

/**
 * Edits a recorded interest or escrow line (all its not-reconciled rows become one new cleared row), a fee or a credit
 * (updated in place). D1 calls: the plan, the account, one read batch, one write batch, whatever the history.
 */
export async function updateLoanActivity(
  env: Env,
  actor: string,
  budgetId: string,
  loanId: string,
  txId: string,
  input: LoanActivityPatchInput,
): Promise<LoanActivityChangeResult> {
  const v = LoanActivityPatchRequest.parse(input);
  const r = await read(env, budgetId, loanId, txId);
  const { db, before } = r;
  const what = classify(r);
  if (what.type === "payment") {
    if (v.today !== undefined) throw refuse("unprocessable_entity", TODAY_NOT_FOR_PAYMENT_TEXT);
    return paymentWrite(r, what, "update", v, actor, budgetId, loanId);
  }
  const now = new Date().toISOString();
  const guard = accountsRepo.accountHolds(db, before, accountsRepo.accountSumIs(loanId, r.stored));

  if (what.type === "line") {
    const { system } = what;
    const name = system === LOAN_ESCROW_SYSTEM ? "escrow" : "interest";
    if (v.date !== undefined || v.memo !== undefined) {
      throw refuse("unprocessable_entity", `date and memo do not apply to ${name}`);
    }
    if (v.amount === undefined)
      throw refuse("unprocessable_entity", `amount is required for ${name}`);
    const amount = -v.amount - what.sum;
    if (amount >= 0) {
      throw refuse(
        "unprocessable_entity",
        system === LOAN_ESCROW_SYSTEM
          ? ESCROW_BELOW_RECONCILED_TEXT(money(what.sum))
          : INTEREST_BELOW_RECONCILED_TEXT(money(what.sum)),
      );
    }
    const payeeId = r.row.tx.payeeId as string;
    const tx = frozenLoanRow({
      budgetId,
      accountId: loanId,
      payeeId,
      system,
      date: frozenRowDate(what.month, v.today ?? utcToday()),
      amount,
      cleared: "cleared",
      now,
    });
    const marker = accountsRepo.transactionExistsStmt(db, tx.id);
    const json = imgs(what.open);
    const log = { budgetId, actor, json, now, marker };
    const results = await db.batch([
      txRepo.insertIfStmt(db, tx, guard, payeesRepo.systemIdSql(budgetId, system)),
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
        marker,
      ),
      balanceRepo.editedLogStmt(db, log),
      balanceRepo.editedDeleteStmt(db, { json, now, marker }),
    ] as unknown as [BatchItem, ...BatchItem[]]);
    if ((results[0]?.meta.changes ?? 0) === 0) await lostRace(r, budgetId, loanId);
    const rows = { amount: what.sum + amount, reconciled: false };
    return {
      kind: name,
      transaction: transactionToApi(tx),
      balance: closing(
        r,
        changeMonth(r.months, what.month, (m) =>
          system === LOAN_ESCROW_SYSTEM
            ? { ...m, escrow_rows: rows }
            : { ...m, interest_rows: rows },
        ),
      ),
    };
  }

  const old = what.tx;
  const magnitude = v.amount ?? Math.abs(old.amount);
  const after: Row = {
    ...old,
    amount: what.kind === "fee" ? -magnitude : magnitude,
    date: v.date ?? old.date,
    memo: v.memo !== undefined ? v.memo : old.memo,
    updatedAt: now,
  };
  const results = await db.batch([
    changeLogInsertIf(
      db,
      {
        budgetId,
        actor,
        action: "update",
        entityType: "transaction",
        entityId: old.id,
        before: transactionToApi(old),
        after: transactionToApi(after),
      },
      guard,
    ),
    txRepo.updateIfStmt(
      db,
      old.id,
      { amount: after.amount, date: after.date, memo: after.memo, updatedAt: now },
      guard,
    ),
  ] as unknown as [BatchItem, ...BatchItem[]]);
  if ((results[1]?.meta.changes ?? 0) === 0) await lostRace(r, budgetId, loanId);
  const moved = changeMonth(r.months, monthOf(old.date), (m) => ({
    ...m,
    other: m.other - old.amount,
  }));
  return {
    kind: what.kind,
    transaction: transactionToApi(after),
    balance: closing(
      r,
      changeMonth(moved, monthOf(after.date), (m) => ({ ...m, other: m.other + after.amount })),
    ),
  };
}

/** Deletes a recorded interest or escrow line (its not-reconciled rows), a fee or a credit. Same D1 calls as an edit. */
export async function deleteLoanActivity(
  env: Env,
  actor: string,
  budgetId: string,
  loanId: string,
  txId: string,
): Promise<LoanActivityChangeResult> {
  const r = await read(env, budgetId, loanId, txId);
  const { db, before } = r;
  const what = classify(r);
  if (what.type === "payment")
    return paymentWrite(r, what, "delete", undefined, actor, budgetId, loanId);
  const now = new Date().toISOString();
  const guard = accountsRepo.accountHolds(db, before, accountsRepo.accountSumIs(loanId, r.stored));

  if (what.type === "line") {
    const { system } = what;
    const json = imgs(what.open);
    const results = await db.batch([
      balanceRepo.editedLogStmt(db, { budgetId, actor, json, now, marker: guard }),
      balanceRepo.editedDeleteStmt(db, { json, now, marker: guard }),
    ]);
    if ((results[1]?.meta.changes ?? 0) === 0) await lostRace(r, budgetId, loanId);
    const rows = what.any ? { amount: what.sum, reconciled: true } : null;
    return {
      kind: system === LOAN_ESCROW_SYSTEM ? "escrow" : "interest",
      transaction: null,
      balance: closing(
        r,
        changeMonth(r.months, what.month, (m) =>
          system === LOAN_ESCROW_SYSTEM
            ? { ...m, escrow_rows: rows }
            : { ...m, interest_rows: rows },
        ),
      ),
    };
  }

  const old = what.tx;
  const results = await db.batch([
    changeLogInsertIf(
      db,
      {
        budgetId,
        actor,
        action: "delete",
        entityType: "transaction",
        entityId: old.id,
        before: transactionToApi(old),
        after: null,
      },
      guard,
    ),
    txRepo.softDeleteIfStmt(db, old.id, now, guard),
  ]);
  if ((results[1]?.meta.changes ?? 0) === 0) await lostRace(r, budgetId, loanId);
  return {
    kind: what.kind,
    transaction: null,
    balance: closing(
      r,
      changeMonth(r.months, monthOf(old.date), (m) => ({ ...m, other: m.other - old.amount })),
    ),
  };
}
