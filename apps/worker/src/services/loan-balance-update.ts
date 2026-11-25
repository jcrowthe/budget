import { isLoanType } from "@budget/core/account-types";
import {
  estimatedTotal,
  LOAN_ESCROW_SYSTEM,
  LOAN_INTEREST_SYSTEM,
  type LoanMonthIn,
  type LoanMonthOut,
  type LoanTerms,
  runLoan,
} from "@budget/core/loan-engine";
import { addMonths, type Month } from "@budget/core/month";
import { canonicalInterestRate } from "@budget/schema/accounts";
import { NOT_A_LOAN_TEXT } from "@budget/schema/loan-activity";
import {
  LOAN_ESCROW_PAYEE,
  LOAN_INTEREST_PAYEE,
  type LoanBalanceUpdateRequest as LoanBalanceUpdateInput,
  LoanBalanceUpdateRequest,
  type LoanBalanceUpdateResult,
} from "@budget/schema/loan-balance-update";
import type { PayeeSystem } from "@budget/schema/payees";
import { RECONCILE_ADJUSTMENT_PAYEE, RECONCILE_MEMO } from "@budget/schema/reconcile";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as loanRepo from "../repositories/loan-activity";
import * as repo from "../repositories/loan-balance-update";
import * as payeesRepo from "../repositories/payees";
import * as txRepo from "../repositories/transactions";
import { accountToApi, adjustmentRow, type BatchItem, systemPayee } from "./accounts";
import { frozenLoanRow, frozenRowDate, monthOf, utcToday } from "./loan-frozen-rows";
import { TransactionRefused, transactionToApi } from "./transactions";

const refused = (balance: number) =>
  new TransactionRefused(
    409,
    "balance_changed",
    `The balance changed: it is now ${balance} milliunits. Review it and try again`,
  );

type Line = { amount: number; state: string } | null;

/** `months` with each month up to `upTo` frozen at the lines of `results`; later months as they are. */
function freezeUpTo(
  months: readonly LoanMonthIn[],
  results: readonly LoanMonthOut[],
  upTo: Month,
  from: Month | null,
): LoanMonthIn[] {
  return months.map((m) => {
    if (m.month > upTo || (from !== null && m.month < from)) return m;
    const r = results.find((x) => x.month === m.month);
    return {
      ...m,
      interest_rows: r?.interest ? { amount: r.interest.amount, reconciled: true } : null,
      escrow_rows: r?.escrow ? { amount: r.escrow.amount, reconciled: true } : null,
    };
  });
}

function withAdjustment(
  months: readonly LoanMonthIn[],
  month: Month,
  amount: number,
): LoanMonthIn[] {
  if (amount === 0) return [...months];
  const has = months.some((m) => m.month === month);
  const base = has
    ? [...months]
    : [
        ...months,
        { month, payments: 0, starting: 0, other: 0, interest_rows: null, escrow_rows: null },
      ];
  return base.map((m) => (m.month === month ? { ...m, other: m.other + amount } : m));
}

/**
 * Updates a loan's balance: freezes its interest and escrow lines as Reconciled up to the month of `today`, adds a
 * balance adjustment for what remains and stamps `last_reconciled_at`. D1 calls: the plan, the account, one read
 * batch and (not in a preview) one write batch, whatever the history. docs/loan-update-balance-design.md.
 */
export async function updateLoanBalance(
  env: Env,
  actor: string,
  budgetId: string,
  loanId: string,
  input: LoanBalanceUpdateInput,
): Promise<LoanBalanceUpdateResult> {
  const v = LoanBalanceUpdateRequest.parse(input);
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const before = await accountsRepo.findActive(db, budgetId, loanId);
  if (!before) throw new NotFound("Account");
  if (!isLoanType(before.type)) {
    throw new TransactionRefused(422, "not_a_loan_account", NOT_A_LOAN_TEXT(before.name));
  }
  if (before.closed) {
    throw new TransactionRefused(
      422,
      "account_closed",
      "A closed account's balance cannot be updated",
    );
  }
  if (v.escrow_amount !== undefined && before.type !== "mortgage") {
    throw new TransactionRefused(
      422,
      "unprocessable_entity",
      "escrow_amount applies to a mortgage only",
    );
  }
  const today = v.today ?? utcToday();
  const M = monthOf(today);

  const [grouped, editedRows, systemRows] = await db.batch([
    loanRepo.balanceGroupsQuery(db, budgetId, { accountId: loanId }),
    repo.editedRowsQuery(db, budgetId, loanId, addMonths(M, 1)),
    repo.systemPayeesQuery(db, budgetId),
  ]);

  // The read state.
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
  const storedCleared = grouped.reduce((n, r) => n + r.cleared, 0);
  const storedUncleared = grouped.reduce((n, r) => n + r.uncleared, 0);
  const run1 = runLoan(terms, months);
  const previous = run1.at(-1)?.closing ?? 0;
  if (v.current_balance !== undefined && v.current_balance !== previous) throw refused(previous);

  // The frozen state: earlier months at their estimates, the update month at the new terms (C3).
  const rate =
    v.interest_rate === undefined ? before.interestRate : canonicalInterestRate(v.interest_rate);
  const escrow = v.escrow_amount ?? before.escrowAmount;
  const runA = runLoan(
    { ...terms, interest_rate: rate, escrow_amount: escrow },
    freezeUpTo(months, run1, addMonths(M, -1), null),
  );
  const frozenMonths = freezeUpTo(freezeUpTo(months, run1, addMonths(M, -1), null), runA, M, M);
  const keptRate = v.keep_rate ? rate : before.interestRate;
  const keptEscrow = (v.keep_escrow ? escrow : before.escrowAmount) ?? 0;
  const termsKept: LoanTerms = { ...terms, interest_rate: keptRate, escrow_amount: keptEscrow };
  let adjustment = 0;
  let final = runLoan(termsKept, frozenMonths);
  for (let i = 0; i < 4; i++) {
    const gap = v.balance - (final.at(-1)?.closing ?? 0);
    if (gap === 0) break;
    adjustment += gap;
    final = runLoan(termsKept, withAdjustment(frozenMonths, M, adjustment));
  }
  const closing = final.at(-1)?.closing ?? 0;

  // The edited rows by month and line, and the rows to write.
  type Edited = { rows: typeof editedRows; sum: number; date: string };
  const edited = new Map<string, Edited>();
  for (const e of editedRows) {
    const key = `${monthOf(e.tx.date)}|${e.system}`;
    const cur = edited.get(key) ?? { rows: [], sum: 0, date: e.tx.date };
    cur.rows.push(e);
    cur.sum += e.tx.amount;
    if (e.tx.date < cur.date) cur.date = e.tx.date;
    edited.set(key, cur);
  }
  const now = new Date().toISOString();
  const existing = new Map<string, payeesRepo.PayeeRow>();
  for (const p of systemRows) if (p.system) existing.set(p.system, p);
  const payeeStmts: BatchItem[] = [];
  const sysOf = (system: PayeeSystem, name: string) => {
    const made = systemPayee(db, actor, budgetId, existing.get(system), system, name, now);
    existing.set(system, made.sys);
    payeeStmts.push(...made.stmts);
    return made.sys;
  };
  const frozen: repo.FrozenJson[] = [];
  const addFrozen = (month: Month, system: PayeeSystem, name: string, line: Line) => {
    if (!line || line.state === "reconciled") return;
    const e = edited.get(`${month}|${system}`);
    const amount = line.state === "edited" ? (e?.sum ?? line.amount) : line.amount;
    const date = e?.date ?? frozenRowDate(month, today);
    const sys = sysOf(system, name);
    const id = crypto.randomUUID();
    frozen.push({
      id,
      system,
      name,
      date,
      amount,
      img: transactionToApi(
        frozenLoanRow({
          id,
          budgetId,
          accountId: loanId,
          payeeId: sys.id,
          system: system as typeof LOAN_INTEREST_SYSTEM | typeof LOAN_ESCROW_SYSTEM,
          date,
          amount,
          cleared: "reconciled",
          now,
        }),
      ),
    });
  };
  for (const m of months) {
    if (m.month > M) continue;
    const r = (m.month < M ? run1 : runA).find((x) => x.month === m.month);
    addFrozen(m.month, LOAN_INTEREST_SYSTEM, LOAN_INTEREST_PAYEE, r?.interest ?? null);
    addFrozen(m.month, LOAN_ESCROW_SYSTEM, LOAN_ESCROW_PAYEE, r?.escrow ?? null);
  }
  const removedCleared = editedRows.reduce(
    (n, e) => n + (e.tx.cleared === "uncleared" ? 0 : e.tx.amount),
    0,
  );
  const removedUncleared = editedRows.reduce(
    (n, e) => n + (e.tx.cleared === "uncleared" ? e.tx.amount : 0),
    0,
  );
  const frozenSum = frozen.reduce((n, f) => n + f.amount, 0);
  const clearedAfter =
    storedCleared - removedCleared + frozenSum + adjustment + estimatedTotal(final);
  const unclearedAfter = storedUncleared - removedUncleared;
  const keptRow = { ...before, interestRate: keptRate, escrowAmount: keptEscrow };

  if (v.preview) {
    return {
      adjustment_amount: adjustment,
      previous_balance: previous,
      balance: closing,
      balance_updated_at: before.lastReconciledAt,
      account: accountToApi(before, {
        cleared: storedCleared + estimatedTotal(run1),
        uncleared: storedUncleared,
        canDelete: false,
      }),
      adjustment: null,
    };
  }

  let adjTx: txRepo.TransactionRow | null = null;
  if (adjustment !== 0) {
    const sys = sysOf("reconciliation_adjustment", RECONCILE_ADJUSTMENT_PAYEE);
    adjTx = adjustmentRow(before, sys, adjustment, today, RECONCILE_MEMO, now, {
      payeeName: RECONCILE_ADJUSTMENT_PAYEE,
      cleared: "reconciled",
    });
  }
  const facts = {
    cleared: storedCleared + estimatedTotal(run1),
    uncleared: storedUncleared,
    canDelete: false,
  };
  const marker = repo.markedBy(db, loanId, now);
  const frozenJson = JSON.stringify(frozen);
  const editedJson = JSON.stringify(
    editedRows.map((e) => ({ id: e.tx.id, img: transactionToApi(e.tx) })),
  );
  const log = { budgetId, actor, json: "", now, marker };
  const stmts: BatchItem[] = [
    ...payeeStmts,
    repo.markUpdatedStmt(db, before, {
      now,
      stored,
      rate: keptRate,
      escrow: keptEscrow,
    }),
  ];
  const markIndex = payeeStmts.length;
  if (frozen.length > 0) {
    stmts.push(
      repo.frozenInsertStmt(db, { budgetId, accountId: loanId, json: frozenJson, now, marker }),
      repo.frozenLogStmt(db, { ...log, json: frozenJson }),
    );
  }
  if (editedRows.length > 0) {
    stmts.push(
      repo.editedLogStmt(db, { ...log, json: editedJson }),
      repo.editedDeleteStmt(db, { json: editedJson, now, marker }),
    );
  }
  if (adjTx) {
    stmts.push(
      txRepo.insertIfStmt(
        db,
        adjTx,
        marker,
        payeesRepo.systemIdSql(budgetId, "reconciliation_adjustment"),
      ),
      changeLogInsertIf(
        db,
        {
          budgetId,
          actor,
          action: "create",
          entityType: "transaction",
          entityId: adjTx.id,
          before: null,
          after: transactionToApi(adjTx),
        },
        accountsRepo.transactionExistsStmt(db, adjTx.id),
      ),
    );
  }
  stmts.push(
    changeLogInsertIf(
      db,
      {
        budgetId,
        actor,
        action: "update",
        entityType: "account",
        entityId: loanId,
        before: accountToApi(before, facts),
        after: accountToApi({ ...keptRow, lastReconciledAt: now }, facts),
      },
      marker,
    ),
  );
  const results = await db.batch(stmts as unknown as [BatchItem, ...BatchItem[]]);
  if ((results[markIndex]?.meta.changes ?? 0) === 0) {
    const now2 = (await txRepo.balancesByAccount(db, budgetId, loanId)).get(loanId);
    throw refused((now2?.cleared ?? 0) + (now2?.uncleared ?? 0));
  }
  return {
    adjustment_amount: adjustment,
    previous_balance: previous,
    balance: closing,
    balance_updated_at: now,
    account: accountToApi(
      { ...keptRow, lastReconciledAt: now },
      { cleared: clearedAfter, uncleared: unclearedAfter, canDelete: false },
    ),
    adjustment:
      adjTx && existing.get("reconciliation_adjustment")
        ? transactionToApi({
            ...adjTx,
            payeeId: (existing.get("reconciliation_adjustment") as { id: string }).id,
          })
        : null,
  };
}
