import {
  RECONCILE_ADJUSTMENT_PAYEE,
  RECONCILE_MEMO,
  ReconcileRequest,
  type ReconcileRequest as ReconcileRequestInput,
  type ReconcileResult,
} from "@budget/schema/reconcile";
import { getDb } from "../db/client";
import type { Env } from "../env";
import { changeLogInsertIf } from "../history/change-log";
import { NotFound } from "../middleware/errors";
import * as accountsRepo from "../repositories/accounts";
import * as budgetsRepo from "../repositories/budgets";
import * as payeesRepo from "../repositories/payees";
import {
  clearedSumIs,
  reconciledAtIs,
  reconcileFlagsStmt,
  reconcileLogsStmt,
} from "../repositories/reconcile";
import * as txRepo from "../repositories/transactions";
import { accountFacts, accountToApi, adjustmentRow, type BatchItem, systemPayee } from "./accounts";
import { transactionToApi } from "./transactions";

/** A reconcile was refused: the route answers with this status and code (409s carry the numbers). */
export class ReconcileRefused extends Error {
  constructor(
    readonly status: 409 | 422,
    readonly code: "reconcile_difference" | "reconcile_changed" | "account_closed",
    detail: string,
    readonly difference?: number,
    readonly cleared?: number,
  ) {
    super(detail);
    this.name = "ReconcileRefused";
  }
}

const utcToday = () => new Date().toISOString().slice(0, 10);

function conflictDetail(code: "reconcile_difference" | "reconcile_changed", S: number, C: number) {
  const base = `The cleared balance (${C} milliunits) differs from statement_balance (${S} milliunits) by difference ${S - C} milliunits`;
  return code === "reconcile_changed" ? `The cleared balance changed. ${base}` : base;
}

/**
 * Reconciles an open account: every cleared row becomes reconciled, `last_reconciled_at` is set and, when the
 * bank balance differs, an adjustment row covers the difference. 6 D1 calls (7 with an adjustment), one batch.
 */
export async function reconcileAccount(
  env: Env,
  actor: string,
  budgetId: string,
  accountId: string,
  input: ReconcileRequestInput,
): Promise<ReconcileResult> {
  const v = ReconcileRequest.parse(input);
  const db = getDb(env);
  if (!(await budgetsRepo.findActive(db, budgetId))) throw new NotFound("Plan");
  const before = await accountsRepo.findActive(db, budgetId, accountId);
  if (!before) throw new NotFound("Account");
  if (before.closed) {
    throw new ReconcileRefused(422, "account_closed", "A closed account cannot be reconciled");
  }
  const facts = (await accountFacts(db, budgetId, accountId))(before);
  const C = facts.cleared;
  const S = v.statement_balance;
  const d = S - C;
  if (v.cleared_balance !== undefined && v.cleared_balance !== C) {
    throw new ReconcileRefused(
      409,
      "reconcile_changed",
      conflictDetail("reconcile_changed", S, C),
      d,
      C,
    );
  }
  if (d !== 0 && !v.create_adjustment) {
    throw new ReconcileRefused(
      409,
      "reconcile_difference",
      conflictDetail("reconcile_difference", S, C),
      d,
      C,
    );
  }
  const now = new Date().toISOString();
  let payeeStmts: BatchItem[] = [];
  let tx: txRepo.TransactionRow | null = null;
  let sysId: string | null = null;
  if (d !== 0) {
    const existing = await payeesRepo.findSystem(db, budgetId, "reconciliation_adjustment");
    const { sys, stmts } = systemPayee(
      db,
      actor,
      budgetId,
      existing,
      "reconciliation_adjustment",
      RECONCILE_ADJUSTMENT_PAYEE,
      now,
    );
    payeeStmts = stmts;
    sysId = sys.id;
    tx = adjustmentRow(before, sys, d, v.today ?? utcToday(), RECONCILE_MEMO, now, {
      payeeName: RECONCILE_ADJUSTMENT_PAYEE,
      cleared: "reconciled",
    });
  }
  const guard = accountsRepo.accountHolds(db, before, clearedSumIs(accountId, C));
  const marked = reconciledAtIs(db, accountId, now);
  const after = accountToApi(
    { ...before, lastReconciledAt: now },
    { ...facts, cleared: C + d, canDelete: d !== 0 ? false : facts.canDelete },
  );
  const stmts: BatchItem[] = [
    ...payeeStmts,
    reconcileLogsStmt(db, { budgetId, accountId, actor, now, guard }),
    reconcileFlagsStmt(db, { accountId, now, guard }),
    accountsRepo.markReconciledStmt(db, before, now, clearedSumIs(accountId, C)),
  ];
  const flagsIndex = payeeStmts.length + 1;
  const markIndex = payeeStmts.length + 2;
  if (tx) {
    stmts.push(
      txRepo.insertIfStmt(
        db,
        tx,
        marked,
        payeesRepo.systemIdSql(budgetId, "reconciliation_adjustment"),
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
        entityId: accountId,
        before: accountToApi(before, facts),
        after,
      },
      marked,
    ),
  );
  const results = await db.batch(stmts as unknown as [BatchItem, ...BatchItem[]]);
  if ((results[markIndex]?.meta.changes ?? 0) === 0) {
    const now2 = (await txRepo.balancesByAccount(db, budgetId, accountId)).get(accountId);
    const C2 = now2?.cleared ?? 0;
    throw new ReconcileRefused(
      409,
      "reconcile_changed",
      conflictDetail("reconcile_changed", S, C2),
      S - C2,
      C2,
    );
  }
  return {
    account: after,
    reconciled_count: results[flagsIndex]?.meta.changes ?? 0,
    adjustment: tx && sysId ? transactionToApi({ ...tx, payeeId: sysId }) : null,
  };
}
